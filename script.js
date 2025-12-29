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

// --- Core Logic ---
// --- Core Logic ---
function updateGoldUI(price, date) {
    // Legacy element (if exists)
    const elPrice = document.getElementById('goldPrice');
    if (elPrice) elPrice.textContent = `R$ ${price.toFixed(2)}`;

    // New Widget: Gold Price
    const elWidgetGold = document.getElementById('widgetGoldPrice');
    if (elWidgetGold) elWidgetGold.textContent = `R$ ${price.toFixed(2)}`;

    // Update Timestamp
    const elLastUpdate = document.getElementById('goldLastUpdate');
    if (elLastUpdate) {
        // Format Current Date
        const now = new Date();
        const formattedDate = now.toLocaleString('pt-BR');
        elLastUpdate.innerHTML = `Atualizado: ${formattedDate} <i class="fa-solid fa-rotate" onclick="fetchLiveGoldPrice()" style="cursor:pointer" title="Atualizar Agora"></i>`;
    }

    // New Widget: Avg Plating Cost (1g * 1mil * Price * Factor)
    const elWidgetPlating = document.getElementById('widgetAvgPlating');
    if (elWidgetPlating) {
        const factor = state.platingFactor || 0.02;
        const avgCost = 1 * 1 * price * factor;
        elWidgetPlating.textContent = `R$ ${avgCost.toFixed(2)}`;
    }
}

// Auto-Refresh every 60 seconds
setInterval(fetchLiveGoldPrice, 60000);

if (ui.btnRefreshGold) ui.btnRefreshGold.addEventListener('click', fetchLiveGoldPrice);


// --- Shared Actions ---
async function handleLoadGithub() {
    if (!state.github.token || !state.github.repo) {
        alert('Configure seu GitHub na aba "Configurações" antes de carregar.');
        switchView('settings');
        return;
    }

    if (!confirm('Isso irá substituir os dados atuais pelos do GitHub. Deseja continuar?')) return;

    const btn = event?.currentTarget || document.getElementById('btnLoadGithub');
    const originalText = btn ? btn.innerHTML : '';

    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Carregando...';
        btn.disabled = true;
    }

    try {
        await GithubAPI.getFile();
        alert('Dados carregados com sucesso! 📥');
    } catch (e) {
        console.error(e);
        alert('Erro ao carregar: ' + e.message);
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

async function handleSaveGithub() {
    // Check if token/repo is configured
    if (!state.github.token || !state.github.repo) {
        alert('Configure seu GitHub na aba "Configurações" antes de salvar na nuvem.');
        switchView('settings');
        return;
    }

    const btn = event?.currentTarget || document.getElementById('btnSaveGithub');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    btn.disabled = true;

    try {
        await GithubAPI.saveFile();
        alert('Dados salvos com sucesso no GitHub! ✅');
        if (ui.ghStatus) {
            ui.ghStatus.textContent = "Sincronizado";
            ui.ghStatus.className = "status-text status-success";
        }
    } catch (e) {
        console.error(e);
        alert('Erro ao salvar no GitHub: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}


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
    // Update ONLY if not manually fixed
    if (!product.manualPlating) {
        product.platingCost = product.weight * product.thickness * state.goldPrice * state.platingFactor;
    }

    // Ensure numbers
    const pCost = parseFloat(product.platingCost) || 0;
    const rCost = parseFloat(product.rawCost) || 0;

    product.totalCost = rCost + pCost;

    // Markup
    const multiplier = (parseFloat(product.markupPercent) || 0) / 100;
    product.salePrice = product.totalCost + (product.totalCost * multiplier);
}

function updateField(id, field, value) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;

    // Special logic for manual Plating Cost
    if (field === 'platingCost') {
        if (value === '' || value === null) {
            // User cleared input -> Revert to auto calculation
            product.manualPlating = false;
        } else {
            // User typed value -> specific override
            product.manualPlating = true;
            product.platingCost = parseFloat(value);
        }
    } else if (['rawCost', 'weight', 'thickness', 'markupPercent'].includes(field)) {
        product[field] = parseFloat(value) || 0;
    } else {
        product[field] = value;
    }

    recalcRow(product);
    renderGrid();
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
            <td>
                <div class="cell-wrapper left">
                    <input type="text" value="${p.sku}" style="text-align: left;" onchange="updateField(${p.id}, 'sku', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper left">
                    <input type="text" value="${p.name}" title="${p.name}" style="text-align: left;" onchange="updateField(${p.id}, 'name', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper left">
                    <input type="text" value="${p.provider || ''}" placeholder="" style="text-align: left;" onchange="updateField(${p.id}, 'provider', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper left">
                    <input type="text" value="${p.platingProvider || ''}" placeholder="" style="text-align: left;" onchange="updateField(${p.id}, 'platingProvider', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper">
                    <span>R$</span>
                    <input type="number" step="0.01" value="${p.rawCost}" onchange="updateField(${p.id}, 'rawCost', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper">
                    <input type="number" step="0.1" value="${p.weight}" style="width: 60px" onchange="updateField(${p.id}, 'weight', this.value)">
                    <span>g</span>
                </div>
            </td>
            <td>
                <div class="cell-wrapper">
                    <input type="number" step="1" value="${p.thickness}" style="width: 50px" onchange="updateField(${p.id}, 'thickness', this.value)">
                    <span>mil</span>
                </div>
            </td>
            
            <td>
                <div class="cell-wrapper">
                    <span>R$</span>
                    <input type="number" step="0.01" value="${p.manualPlating ? p.platingCost : p.platingCost.toFixed(2)}" 
                        title="Digite para fixar. Limpe para cálculo automático."
                        onchange="updateField(${p.id}, 'platingCost', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper">
                    <span>R$</span>
                    <input type="number" step="0.01" value="${p.manualPlating ? p.platingCost : p.platingCost.toFixed(2)}" 
                        title="Digite para fixar. Limpe para cálculo automático."
                        onchange="updateField(${p.id}, 'platingCost', this.value)">
                </div>
            </td>
            <td class="readonly">
                <div class="cell-wrapper">
                    <span>R$ ${formatCurrency(p.totalCost)}</span>
                </div>
            </td>
            
            <td>
                <div class="cell-wrapper">
                    <input type="number" step="10" value="${p.markupPercent}" style="width: 60px" onchange="updateField(${p.id}, 'markupPercent', this.value)">
                    <span>%</span>
                </div>
            </td>
            
            <td class="readonly highlight-price">
                <div class="cell-wrapper">
                    <span>R$ ${formatCurrency(p.salePrice)}</span>
                </div>
            </td>
            <td>
                <div class="cell-wrapper">
                    <button class="btn-icon" onclick="deleteRow(${p.id})"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        ui.gridBody.appendChild(tr);
    });

    // Update Widget: Total Products
    const elTotal = document.getElementById('widgetTotalProducts');
    if (elTotal) elTotal.textContent = state.products.length;
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
    // Plating Factor binding is already handled
    const platingFactorInput = document.getElementById('platingFactor');
    if (platingFactorInput) {
        platingFactorInput.value = state.platingFactor;
        platingFactorInput.addEventListener('change', e => {
            state.platingFactor = parseFloat(e.target.value) || 0;
            localStorage.setItem('platingFactor', e.target.value);
            recalcAll();
        });
    }
}

// --- View Switching (SPA) ---
function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));

    // Deactivate all nav links
    document.querySelectorAll('.sidebar nav a').forEach(el => el.classList.remove('active'));

    // Show selected view
    document.getElementById(`view-${viewName}`).classList.remove('hidden');

    // Activate nav link
    document.getElementById(`nav-${viewName}`).classList.add('active');

    // Update Subtitle
    const sub = document.getElementById('pageSubtitle');
    if (sub) {
        if (viewName === 'products') sub.textContent = 'Dashboard Geral';
        else if (viewName === 'settings') sub.textContent = 'Configurações & Conexão';
        else if (viewName === 'help') sub.textContent = 'Tutorial de Uso';
    }
}

window.addRow = addRow;
window.deleteRow = deleteRow;
window.updateField = updateField;
window.GithubAPI = GithubAPI;
window.switchView = switchView;
