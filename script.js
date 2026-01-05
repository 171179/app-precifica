// --- Configuration & State ---
const APIS = {
    GOLD: 'https://economia.awesomeapi.com.br/last/XAU-BRL', // Gold to BRL
};

const state = {
    products: [],
    goldPrice: 0,
    platingFactor: 0.02, // Aproximadamente 2% do valor do ouro (R$ 470 * 0.02 = R$ 9.40/milésimo)
    searchTerm: "", // Search filter
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

    // Sidebar Toggle
    const btnToggle = document.getElementById('sidebarToggle');
    if (btnToggle) {
        btnToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const app = document.querySelector('.app-container');
            const icon = btnToggle.querySelector('i');
            app.classList.toggle('collapsed');

            // Toggle Icon: << to >>
            if (app.classList.contains('collapsed')) {
                icon.classList.remove('fa-angles-left');
                icon.classList.add('fa-angles-right');
            } else {
                icon.classList.remove('fa-angles-right');
                icon.classList.add('fa-angles-left');
            }
        });
    }

    // Logo Click to Open (when collapsed)
    const logoContainer = document.querySelector('.logo-container');
    if (logoContainer) {
        logoContainer.addEventListener('click', () => {
            const app = document.querySelector('.app-container');
            if (app.classList.contains('collapsed')) {
                app.classList.remove('collapsed');
                // Reset icon state
                const btnIcon = document.querySelector('#sidebarToggle i');
                if (btnIcon) {
                    btnIcon.classList.remove('fa-angles-right');
                    btnIcon.classList.add('fa-angles-left');
                }
            }
        });
    }

    // Initial Data Load (Local first, then GitHub if available)
    const localData = localStorage.getItem('precifica_products');
    if (localData) {
        let loaded = JSON.parse(localData);
        // Sanitize: filter invalid and ensure ID
        state.products = (Array.isArray(loaded) ? loaded : [])
            .filter(p => p && (p.sku || p.name))
            .map((p, index) => ({ ...p, id: p.id || (Date.now() + index) }));
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
            let products = JSON.parse(content);

            // Validation: Ensure array
            if (!Array.isArray(products)) {
                console.warn('GitHub Data is not an array:', products);
                if (products && Array.isArray(products.products)) {
                    products = products.products; // Unwrap { products: [...] }
                } else if (products && Array.isArray(products.data)) {
                    products = products.data; // Unwrap { data: [...] }
                } else {
                    products = []; // Default empty to prevent crash
                    alert('Aviso: O arquivo no GitHub não contém uma lista válida de produtos. Iniciando vazio.');
                }
            }

            // Filter out empty/invalid rows
            products = products.filter(p => p && (p.sku || p.name));

            state.products = products;
            recalcAll(); // Recalc with current local gold price (this also calls renderGrid)

            state.github.sha = data.sha; // Save SHA for updates
            if (ui.ghStatus) {
                ui.ghStatus.textContent = 'Sincronizado (Leitura OK)';
                ui.ghStatus.style.color = 'var(--success)';
            }
        } catch (e) {
            console.error(e);
            alert(`Erro ao conectar no GitHub:\n${e.message}\n\nVerifique:\n1. Token (não expirou?)\n2. Nome do Repositório\n3. Permissões do Token`);
            if (ui.ghStatus) {
                ui.ghStatus.textContent = `Erro: ${e.message}`;
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
// Add new empty row - DEPRECATED in favor of Modal
// Kept for backward combatibility just in case
function addRow() {
    openProductModal();
}

function recalcAll() {
    state.products.forEach(recalcRow);
    renderGrid();
    saveLocalData();
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
    saveLocalData();
}

function deleteRow(id) {
    if (!confirm('Deletar linha?')) return;
    state.products = state.products.filter(p => p.id !== id);
    renderGrid();
    saveLocalData();
}

// --- Bulk Actions ---
function toggleSelectAll(checkbox) {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
    updateDeleteButtonVisibility();
}

function updateDeleteButtonVisibility() {
    const selected = document.querySelectorAll('.row-checkbox:checked').length;
    const btn = document.getElementById('btnDeleteSelected');
    if (btn) {
        if (selected > 0) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    }
}

function deleteSelected() {
    const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
    if (selectedCheckboxes.length === 0) return;

    if (!confirm(`Tem certeza que deseja excluir ${selectedCheckboxes.length} produtos?`)) return;

    const idsToDelete = Array.from(selectedCheckboxes).map(cb => parseFloat(cb.value));
    state.products = state.products.filter(p => !idsToDelete.includes(p.id));

    saveLocalData();
    renderGrid();

    // Uncheck "Select All" if it was checked
    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.checked = false;
    updateDeleteButtonVisibility();
}

function renderGrid() {
    if (!ui.gridBody) return;
    ui.gridBody.innerHTML = '';

    const term = (state.searchTerm || "").toLowerCase().trim();
    const filtered = state.products.filter(p => {
        if (!term) return true;
        return (p.sku || "").toLowerCase().includes(term) ||
            (p.name || "").toLowerCase().includes(term) ||
            (p.provider || "").toLowerCase().includes(term);
    });

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = 'grid-row';
        tr.innerHTML = `
            <td>
                <div class="cell-wrapper">
                     <input type="checkbox" class="row-checkbox" value="${p.id}" onclick="updateDeleteButtonVisibility()">
                </div>
            </td>
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
                    <input type="number" step="0.1" value="${p.weight}" style="width: 100%; text-align: center;" onchange="updateField(${p.id}, 'weight', this.value)">
                </div>
            </td>
            <td>
                <div class="cell-wrapper">
                    <input type="number" step="1" value="${p.thickness}" style="width: 100%; text-align: center;" onchange="updateField(${p.id}, 'thickness', this.value)">
                </div>
            </td>
            
            <td>
                <div class="cell-wrapper">
                    <span>R$</span>
                    <input type="number" step="0.01" value="${p.manualPlating ? p.platingCost : (p.platingCost || 0).toFixed(2)}" 
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
            <td class="readonly highlight-profit">
                <div class="cell-wrapper">
                    <span style="color: var(--accent-green); font-weight: bold;">R$ ${formatCurrency((p.salePrice || 0) - (p.totalCost || 0))}</span>
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

function saveLocalData() {
    localStorage.setItem('precifica_products', JSON.stringify(state.products));
}

// Helpers
function formatCurrency(val) { return (val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

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
} // End initGithubFields

// --- Export Feature ---
function exportToCSV() {
    if (!state.products || state.products.length === 0) {
        alert("Nenhum produto para exportar.");
        return;
    }

    const headers = [
        "SKU",
        "Produto",
        "Fornecedor",
        "Galvanoplastia",
        "Custo Bruto (R$)",
        "Peso (g)",
        "Camada (mil)",
        "Custo Banho (R$)",
        "Custo Total (R$)",
        "Margem (%)",
        "Preço Venda (R$)"
    ];

    const escapeCsv = (txt) => {
        if (!txt) return "";
        return '"' + String(txt).replace(/"/g, '""') + '"';
    };

    const formatNum = (num) => {
        return (parseFloat(num) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const rows = state.products.map(p => [
        escapeCsv(p.sku),
        escapeCsv(p.name),
        escapeCsv(p.provider),
        escapeCsv(p.platingProvider),
        formatNum(p.rawCost),
        formatNum(p.weight),
        formatNum(p.thickness),
        formatNum(p.platingCost), // Uses manual or calculated
        formatNum(p.totalCost),
        formatNum(p.markupPercent),
        formatNum(p.salePrice)
    ]);

    // Add BOM for Excel UTF-8 compatibility
    let csvContent = "\uFEFF";
    csvContent += headers.join(";") + "\n";
    rows.forEach(row => {
        csvContent += row.join(";") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `precificacao_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
window.exportToCSV = exportToCSV;
window.handleSearch = handleSearch; // Explicitly expose
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.handleProductSubmit = handleProductSubmit;

// --- Modal Logic ---
function openProductModal() {
    const overlay = document.getElementById('productModalOverlay');
    if (overlay) overlay.classList.add('active');
    // Focus first input
    setTimeout(() => {
        const first = document.querySelector('#newProductForm input');
        if (first) first.focus();
    }, 100);
}

function closeProductModal() {
    const overlay = document.getElementById('productModalOverlay');
    if (overlay) overlay.classList.remove('active');
    document.getElementById('newProductForm').reset();
}

function handleProductSubmit(e) {
    e.preventDefault();

    // Gather Data
    const formData = new FormData(e.target);
    const sku = formData.get('sku');
    const name = formData.get('name');
    const weight = parseFloat(formData.get('weight')) || 0;
    const rawCost = parseFloat(formData.get('rawCost')) || 0;
    const markup = parseFloat(formData.get('markupPercent')) || 300;

    // Create Product Object
    const newProduct = {
        id: Date.now(),
        sku: sku,
        name: name,
        provider: "",
        platingProvider: "",
        rawCost: rawCost,
        weight: weight,
        thickness: 0, // Default
        markupPercent: markup,
        manualPlating: false, // Default to auto-calc
        platingCost: 0,
        totalCost: 0,
        salePrice: 0
    };

    // Logic: Plating = Weight * Thickness (0) * Price... 
    // Wait, thickness is 0 by default? 
    // If thickness is 0, Plating Cost will be 0.
    // That's fine for now, user can edit in grid.

    state.products.unshift(newProduct);
    recalcRow(newProduct); // Calculate costs
    renderGrid();
    saveLocalData();

    // Close & Success
    closeProductModal();
    // alert('Produto adicionado com sucesso!'); // Optional

    // Update Total Widget
    const elTotal = document.getElementById('widgetTotalProducts');
    if (elTotal) elTotal.textContent = state.products.length;
}

// Close on Escape or Click Outside
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProductModal();
});
document.getElementById('productModalOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeProductModal();
});

// --- Import Feature (Excel) ---
async function handleImportExcel(input) {
    const file = input.files[0];
    if (!file) return;

    // Check availability of SheetJS
    if (typeof XLSX === 'undefined') {
        alert("Erro: Biblioteca SheetJS não carregada. Verifique a conexão.");
        return;
    }

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            // Assume first sheet
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Convert to JSON (array of arrays)
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            // Find Header Row (Look for "CODIGO" or "SKU")
            let headerRowIndex = -1;
            for (let i = 0; i < Math.min(20, jsonData.length); i++) {
                const row = jsonData[i];
                if (row && row.some(cell => typeof cell === 'string' && cell.toUpperCase().includes('CODIGO'))) {
                    headerRowIndex = i;
                    break;
                }
            }

            if (headerRowIndex === -1) {
                // If not found, try generic row 0
                headerRowIndex = 0;
                console.warn("Cabeçalho 'CODIGO' não encontrado. Tentando linha 0.");
            }

            const newProducts = [];

            // Iterate from Row after Header
            for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                // Index Mapping based on Image (A=0, B=1, ...)
                // A=CODIGO, E=Produto, F=BRUTO, G=BANHO, I=PERCENTUAL
                const val = (idx) => row[idx] !== undefined ? row[idx] : "";

                const sku = String(val(0)).trim();
                const name = String(val(4)).trim();

                // Skip empty rows
                if (!sku && !name) continue;

                const rawCost = parseFloat(String(val(5)).replace(',', '.')) || 0;
                const platingCost = parseFloat(String(val(6)).replace(',', '.')) || 0;
                // Markup: Excel might export "300%" as 3 (300%) or 300? 
                // Usually percentages in Excel are decimals (3.0 = 300%).
                // If cell is "300%", SheetJS reads as 3. 
                // Wait, if formatted as text "300%", it's string.
                // Let's handle both.
                let markupVal = val(8);
                let markup = 0;
                if (typeof markupVal === 'string') {
                    markup = parseFloat(markupVal.replace('%', '').replace(',', '.'));
                } else if (typeof markupVal === 'number') {
                    // If < 10 (e.g., 3.0), likely 300%? Or 3%? 
                    // Standard Excel: 3 = 300%. 0.5 = 50%.
                    // System expects 300 for 300%.
                    markup = markupVal * 100;
                    // Edge case: if user typed 300 in number cell (not %).
                    // If > 10, likely already percent.
                    // But standard is decimal. Let's assume decimal if < 10?
                    // "300%" usually comes as 3.
                    // If it is > 10, keep it. 
                    if (markup < 100 && markup > 0) {
                        // e.g. 3 -> 300. 
                        // But what if it IS 3%? Unlikely for semijoias markup (usually > 100%).
                        // Safe bet: Logic checks.
                    }
                    if (markupVal > 10) markup = markupVal; // e.g. 300
                    else markup = markupVal * 100; // e.g. 3 -> 300
                }

                // Create Product
                const p = {
                    id: Date.now() + Math.random(),
                    sku: sku,
                    name: name,
                    provider: "", // Not in Excel
                    platingProvider: "", // Not in Excel
                    rawCost: rawCost,
                    weight: 0, // Missing
                    thickness: 0, // Missing
                    manualPlating: true, // IMPORTANT: Lock plating cost
                    platingCost: platingCost,
                    markupPercent: markup,
                    totalCost: 0, // Will be set below
                    salePrice: 0 // Will be set below
                };

                // Calc Logic immediately to ensure state is valid
                p.totalCost = p.rawCost + p.platingCost;
                p.salePrice = p.totalCost * (1 + (p.markupPercent / 100));

                newProducts.push(p);
            }

            if (newProducts.length > 0) {
                // Confirm Overwrite or Append?
                // Append is safer.
                state.products = [...state.products, ...newProducts];
                saveLocalData();
                renderGrid();
                alert(`Sucesso! ${newProducts.length} produtos importados.`);

                // Update Total Count Widget
                const totalWidget = document.getElementById('widgetTotalProducts');
                if (totalWidget) totalWidget.textContent = state.products.length;

            } else {
                alert("Nenhum produto válido encontrado.");
            }

        } catch (ex) {
            console.error(ex);
            alert("Erro ao processar arquivo: " + ex.message);
        }

        // Reset input
        input.value = "";
    };

    reader.readAsArrayBuffer(file);
}

function handleSearch(val) {
    state.searchTerm = val;
    renderGrid();
}

window.handleSearch = handleSearch;

// --- Resizable Columns ---
function initResizableGrid() {
    const table = document.getElementById('gridTable');
    if (!table) return;

    const cols = table.querySelectorAll('th');
    cols.forEach((col) => {
        // Prevent duplicate resizers
        if (col.querySelector('.resizer')) return;

        // Create resizer div
        const resizer = document.createElement('div');
        resizer.classList.add('resizer');
        col.appendChild(resizer);
        createResizableColumn(col, resizer);
    });
}

function createResizableColumn(col, resizer) {
    let x = 0;
    let w = 0;

    const mouseDownHandler = function (e) {
        x = e.clientX;
        const styles = window.getComputedStyle(col);
        w = parseInt(styles.width, 10);

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
        resizer.classList.add('resizing');
    };

    const mouseMoveHandler = function (e) {
        const dx = e.clientX - x;
        col.style.width = `${w + dx}px`;
        col.style.minWidth = `${w + dx}px`; // Override min-width to allow shrinking or growing
    };

    const mouseUpHandler = function () {
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
        resizer.classList.remove('resizing');
    };

    resizer.addEventListener('mousedown', mouseDownHandler);
}

// Ensure init is called
document.addEventListener('DOMContentLoaded', () => {
    // Already calling in main listener? No, I need to call it or add to main.
    // I'll add a setTimeout to ensure DOM is ready? No, DOMContentLoaded is fine.
    // But I am appending this code at the END.
    // I should call it if document is already ready, or just hook it up.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initResizableGrid);
    } else {
        initResizableGrid();
    }
});
window.deleteSelected = deleteSelected;
window.handleImportExcel = handleImportExcel;
