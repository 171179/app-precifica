// --- Configuration & State ---
const APIS = {
    GOLD: 'https://economia.awesomeapi.com.br/last/XAU-BRL', // Gold to BRL
};

const state = {
    products: [],
    goldPrice: 0,
    platingFactor: 0.02, // Aproximadamente 2% do valor do ouro (R$ 470 * 0.02 = R$ 9.40/milésimo)
    github: {
        token: localStorage.getItem('gh_token') || '',
        owner: localStorage.getItem('gh_owner') || '',
        repo: localStorage.getItem('gh_repo') || '',
        path: localStorage.getItem('gh_path') || 'precifica_db.json'
    }
};

// --- DOM Elements ---
const ui = {
    goldPriceDisplay: document.getElementById('goldPriceDisplay'),
    goldLastUpdate: document.getElementById('lastUpdate'),
    btnRefreshGold: document.getElementById('btnRefreshGold'),
    gridBody: document.querySelector('#gridTable tbody'),
    btnSaveGithub: document.getElementById('btnSaveGithub'),
    btnLoadGithub: document.getElementById('btnLoadGithub'),
    ghStatus: document.getElementById('ghStatus'),
    // Settings Inputs
    inputToken: document.getElementById('ghToken'),
    inputRepo: document.getElementById('ghRepo'),
    inputOwner: document.getElementById('ghOwner'),
    inputPath: document.getElementById('ghPath')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    initGithubFields();

    // Initial Data Load (Local first, then GitHub if available)
    const localData = localStorage.getItem('precifica_products');
    if (localData) {
        state.products = JSON.parse(localData);
        renderGrid();
    }

    // Fetch Live Gold
    await fetchLiveGoldPrice();
});

// --- 1. Live Gold API ---
async function fetchLiveGoldPrice() {
    if (ui.btnRefreshGold) ui.btnRefreshGold.classList.add('fa-spin');
    try {
        const response = await fetch(APIS.GOLD);
        const data = await response.json();
        // Fix: API returns XAU (Troy Ounce). Convert to Grams.
        const priceOz = parseFloat(data.XAUBRL.bid);
        const priceGram = priceOz / 31.1035;

        state.goldPrice = priceGram;
        updateGoldUI(priceGram, data.XAUBRL.create_date);

        // Auto-recalculate entire grid on gold update
        recalcAll();
    } catch (error) {
        console.error('Gold API Error:', error);
        // alert('Erro ao buscar cotação online. Verifique conexão.');
    } finally {
        if (ui.btnRefreshGold) ui.btnRefreshGold.classList.remove('fa-spin');
    }
}

function updateGoldUI(price, date) {
    // Price per Gram? The API usually returns ~400+ for gram.
    // Confirm unit. XAU/BRL is typically per gram or oz depending on provider.
    // AwesomeAPI XAUBRL 'bid' is usually 1g price in BRL.
    if (ui.goldPriceDisplay) ui.goldPriceDisplay.textContent = `R$ ${formatCurrency(price)}`;
    if (ui.goldLastUpdate) ui.goldLastUpdate.textContent = `Atualizado às ${date}`;
}

if (ui.btnRefreshGold) ui.btnRefreshGold.addEventListener('click', fetchLiveGoldPrice);


// --- 2. GitHub Integration ---
class GithubAPI {
    static get headers() {
        return {
            'Authorization': `token ${state.github.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };
    }

    static async getFile() {
        if (!validateGithubConfig()) return;

        const url = `https://api.github.com/repos/${state.github.owner}/${state.github.repo}/contents/${state.github.path}`;
        if (ui.ghStatus) ui.ghStatus.textContent = 'Carregando...';

        try {
            const res = await fetch(url, { headers: this.headers });
            if (!res.ok) throw new Error(`GitHub API: ${res.status}`);

            const data = await res.json();
            // Content is base64 encoded
            const content = atob(data.content);
            const products = JSON.parse(content);

            state.products = products;
            renderGrid();
            recalcAll(); // Recalc with current local gold price

            state.github.sha = data.sha; // Save SHA for updates
            if (ui.ghStatus) {
                ui.ghStatus.textContent = 'Sincronizado (Leitura OK)';
                ui.ghStatus.style.color = 'var(--success)';
            }
        } catch (e) {
            console.error(e);
            if (ui.ghStatus) {
                ui.ghStatus.textContent = 'Erro ao ler do Git';
                ui.ghStatus.style.color = 'var(--danger)';
            }
        }
    }

    static async saveFile() {
        if (!validateGithubConfig()) return;

        const url = `https://api.github.com/repos/${state.github.owner}/${state.github.repo}/contents/${state.github.path}`;
        if (ui.ghStatus) ui.ghStatus.textContent = 'Salvando...';

        const content = btoa(JSON.stringify(state.products, null, 2));
        const body = {
            message: `Update Precifica Data - ${new Date().toLocaleString()}`,
            content: content,
            sha: state.github.sha // crucial for updates
        };

        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: this.headers,
                body: JSON.stringify(body)
            });

            if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
            const data = await res.json();
            state.github.sha = data.content.sha;

            if (ui.ghStatus) {
                ui.ghStatus.textContent = 'Salvo no GitHub com Sucesso!';
                ui.ghStatus.style.color = 'var(--success)';
            }
        } catch (e) {
            console.error(e);
            if (ui.ghStatus) {
                ui.ghStatus.textContent = 'Erro ao salvar';
                ui.ghStatus.style.color = 'var(--danger)';
            }
        }
    }
}

function validateGithubConfig() {
    if (!state.github.token || !state.github.repo) {
        alert('Configure o Token e Repositório do GitHub na aba Configurações.');
        return false;
    }
    return true;
}

// Bind Buttons
ui.btnLoadGithub?.addEventListener('click', () => GithubAPI.getFile());
ui.btnSaveGithub?.addEventListener('click', () => GithubAPI.saveFile());


// --- 3. Grid System (Spreadsheet Logic) ---

// Add new empty row
function addRow() {
    const newProduct = {
        id: Date.now(),
        sku: '',
        name: '',
        rawCost: 0,
        weight: 0,
        thickness: 0,
        markupPercent: 300,
        // Calculated fields
        platingCost: 0,
        totalCost: 0,
        salePrice: 0
    };
    state.products.unshift(newProduct); // Add to top
    recalcRow(newProduct);
    renderGrid();
}

function recalcAll() {
    state.products.forEach(recalcRow);
    renderGrid();
    saveLocal();
}

function recalcRow(product) {
    // Formula: Plating = Weight * Thickness * GoldPrice * Factor
    product.platingCost = product.weight * product.thickness * state.goldPrice * state.platingFactor;
    product.totalCost = product.rawCost + product.platingCost;

    // Markup
    const multiplier = product.markupPercent / 100;
    product.salePrice = product.totalCost + (product.totalCost * multiplier);
}

function updateField(id, field, value) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;

    // Parse numbers for numeric fields
    if (['rawCost', 'weight', 'thickness', 'markupPercent'].includes(field)) {
        product[field] = parseFloat(value) || 0;
    } else {
        product[field] = value;
    }

    recalcRow(product);
    renderGrid(); // Efficient re-render (could be optimized to row-only)
    saveLocal();
}

function deleteRow(id) {
    if (!confirm('Deletar linha?')) return;
    state.products = state.products.filter(p => p.id !== id);
    renderGrid();
    saveLocal();
}

function renderGrid() {
    if (!ui.gridBody) return;
    ui.gridBody.innerHTML = '';

    state.products.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'grid-row';
        tr.innerHTML = `
            <td><input type="text" value="${p.sku}" onchange="updateField(${p.id}, 'sku', this.value)"></td>
            <td><input type="text" value="${p.name}" onchange="updateField(${p.id}, 'name', this.value)"></td>
            <td>R$ <input type="number" step="0.01" value="${p.rawCost}" onchange="updateField(${p.id}, 'rawCost', this.value)"></td>
            <td><input type="number" step="0.1" value="${p.weight}" style="width: 60px" onchange="updateField(${p.id}, 'weight', this.value)"> g</td>
            <td><input type="number" step="1" value="${p.thickness}" style="width: 50px" onchange="updateField(${p.id}, 'thickness', this.value)"> mil</td>
            
            <!-- Calculated Read-only Columns -->
            <td class="readonly">R$ ${formatCurrency(p.platingCost)}</td>
            <td class="readonly">R$ ${formatCurrency(p.totalCost)}</td>
            
            <td><input type="number" step="10" value="${p.markupPercent}" style="width: 60px" onchange="updateField(${p.id}, 'markupPercent', this.value)"> %</td>
            
            <td class="readonly highlight-price">R$ ${formatCurrency(p.salePrice)}</td>
            <td><button class="btn-icon" onclick="deleteRow(${p.id})"><i class="fa-solid fa-trash"></i></button></td>
        `;
        ui.gridBody.appendChild(tr);
    });
}

function saveLocal() {
    localStorage.setItem('precifica_products', JSON.stringify(state.products));
}

// Helpers
function formatCurrency(val) { return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Settings Management
function loadSettings() {
    // Load plating factor
    const savedFactor = localStorage.getItem('platingFactor');
    if (savedFactor) state.platingFactor = parseFloat(savedFactor);
}

function initGithubFields() {
    // Ensure UI elements are available before trying to access them
    if (ui.inputToken) {
        ui.inputToken.value = state.github.token;
        ui.inputToken.addEventListener('change', e => {
            state.github.token = e.target.value;
            localStorage.setItem('gh_token', e.target.value);
        });
    }
    if (ui.inputOwner) {
        ui.inputOwner.value = state.github.owner;
        ui.inputOwner.addEventListener('change', e => {
            state.github.owner = e.target.value;
            localStorage.setItem('gh_owner', e.target.value);
        });
    }
    if (ui.inputRepo) {
        ui.inputRepo.value = state.github.repo;
        ui.inputRepo.addEventListener('change', e => {
            state.github.repo = e.target.value;
            localStorage.setItem('gh_repo', e.target.value);
        });
    }
    // Bind Path Input
    if (ui.inputPath) {
        ui.inputPath.value = state.github.path;
        ui.inputPath.addEventListener('change', e => {
            state.github.path = e.target.value;
            localStorage.setItem('gh_path', e.target.value);
        });
    }
    const platingFactorInput = document.getElementById('platingFactor');
    if (platingFactorInput) {
        platingFactorInput.value = state.platingFactor;
        platingFactorInput.addEventListener('change', e => {
            state.platingFactor = parseFloat(e.target.value) || 0;
            localStorage.setItem('platingFactor', e.target.value);
            recalcAll(); // Recalculate grid if plating factor changes
        });
    }
}

window.addRow = addRow;
window.deleteRow = deleteRow;
window.updateField = updateField;
window.GithubAPI = GithubAPI;
