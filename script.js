const firebaseConfig = {
  apiKey: "AIzaSyCE6i1aLAzB2n_AZaNlohwH7ikr_8Z7dhM",
  authDomain: "control-ventas-app-cd82b.firebaseapp.com",
  projectId: "control-ventas-app-cd82b",
  storageBucket: "control-ventas-app-cd82b.firebasestorage.app",
  messagingSenderId: "93145997049",
  appId: "1:93145997049:web:df17391f11f971120c0c28"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let products = [];
let pendingSaleDocId = null;
let pendingDeleteDocId = null;
let pendingEditDocId = null;
let pendingCutCard = null;
let pendingReturnDocId = null;

// Pestaña activa: 'stock', 'history' o 'debts'
let currentView = 'stock';
let currentSubFilter = 'ALL';

let selectedProductIds = new Set();
let currentSortColumn = null;
let currentSortDirection = 'asc';

const form = document.getElementById('product-form');
const inventoryList = document.getElementById('inventory-list');
const monthFilterSelect = document.getElementById('month-filter');
const searchInput = document.getElementById('search-input');
const buyDateInput = document.getElementById('buyDate');
const selectionBanner = document.getElementById('selection-banner');
const selectionCountText = document.getElementById('selection-count-text');

if (buyDateInput) {
  buyDateInput.value = new Date().toISOString().split('T')[0];
}

// Escucha en tiempo real de Firestore con captura de errores
db.collection("productos").onSnapshot(
  (snapshot) => {
    products = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    updateMonthOptions();
    updateTabCounters();
    updateCardCycleAlerts();
    render();
  },
  (error) => {
    showToast('Error al conectar con la base de datos: ' + error.message, 'error');
  }
);

// Notificaciones flotantes tipo Toast
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  let icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  if (type === 'info') icon = 'ℹ️';

  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// Formateador de moneda en Pesos Colombianos (COP)
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount || 0);
}

// Parseo seguro de fecha YYYY-MM-DD en hora local (evita desfase de 1 día por UTC en Colombia)
function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('-');
  if (parts.length < 3) return null;
  const [y, m, d] = parts.map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(y, m - 1, d);
}

// Cálculo de días transcurridos entre dos fechas
function calculateDays(startDateStr, endDateStr) {
  const start = parseLocalDate(startDateStr);
  if (!start) return 0;
  const end = endDateStr ? parseLocalDate(endDateStr) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diff = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  return isNaN(diff) ? 0 : diff;
}

// Plazo de devolución (30 días desde la llegada)
function getReturnRemainingDays(arrivalDateStr) {
  if (!arrivalDateStr) return 999;
  const arrivalDate = parseLocalDate(arrivalDateStr);
  if (!arrivalDate) return 999;
  const today = new Date();
  arrivalDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.floor((today - arrivalDate) / (1000 * 60 * 60 * 24));
  return 30 - daysElapsed;
}

function calculateReturnStatus(arrivalDateStr, status) {
  if (status === 'Vendido') return `<span class="return-badge na">N/A (Vendido)</span>`;
  if (status === 'Devuelto') return `<span class="return-badge na">Devuelto</span>`;
  if (!arrivalDateStr) return `<span class="return-badge transit">🚚 En camino</span>`;

  const daysRemaining = getReturnRemainingDays(arrivalDateStr);
  if (daysRemaining < 0) return `<span class="return-badge expired">🔴 Plazo vencido</span>`;
  if (daysRemaining <= 5) return `<span class="return-badge critical">🚨 ¡Devolver ya! (${daysRemaining} d)</span>`;
  if (daysRemaining <= 10) return `<span class="return-badge warning">🟠 ${daysRemaining} d. restantes</span>`;
  return `<span class="return-badge safe">🟢 ${daysRemaining} d. restantes</span>`;
}

// Cálculo centralizado y consistente de métricas financieras de un producto
function calculateProductMetrics(prod) {
  const cost = parseFloat(prod.cost) || 0;
  const targetPrice = parseFloat(prod.targetPrice) || 0;
  const actualPrice = prod.actualPrice ? parseFloat(prod.actualPrice) : targetPrice;

  let profit = 0;
  let roi = 0;

  if (prod.status === 'Vendido') {
    profit = actualPrice - cost;
    roi = cost > 0 ? (profit / cost) * 100 : 0;
  } else if (prod.status === 'Devuelto') {
    profit = 0;
    roi = 0;
  } else {
    profit = targetPrice - cost;
    roi = cost > 0 ? (profit / cost) * 100 : 0;
  }

  return {
    cost,
    targetPrice,
    actualPrice,
    profit,
    roi: parseFloat(roi.toFixed(1))
  };
}

// Configuración de Fechas de Corte y Límites de Pago de Tarjetas (Nu y Rappi)
const defaultCardSettings = {
  Nu: { cutDay: 18, dueDay: 28 },
  Rappi: { cutDay: 20, dueDay: 30 }
};

function getCardSettings() {
  try {
    const saved = localStorage.getItem('control_card_settings');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return defaultCardSettings;
}

function saveCardSettings(e) {
  e.preventDefault();
  const nuCut = parseInt(document.getElementById('nu-cut-day').value) || 18;
  const nuDue = parseInt(document.getElementById('nu-due-day').value) || 28;
  const rappiCut = parseInt(document.getElementById('rappi-cut-day').value) || 20;
  const rappiDue = parseInt(document.getElementById('rappi-due-day').value) || 30;

  const newSettings = {
    Nu: { cutDay: nuCut, dueDay: nuDue },
    Rappi: { cutDay: rappiCut, dueDay: rappiDue }
  };
  localStorage.setItem('control_card_settings', JSON.stringify(newSettings));
  closeCardSettingsModal();
  showToast('Fechas de tarjeta actualizadas con éxito');
  updateCardCycleAlerts();
}

function openCardSettingsModal() {
  const settings = getCardSettings();
  document.getElementById('nu-cut-day').value = settings.Nu.cutDay;
  document.getElementById('nu-due-day').value = settings.Nu.dueDay;
  document.getElementById('rappi-cut-day').value = settings.Rappi.cutDay;
  document.getElementById('rappi-due-day').value = settings.Rappi.dueDay;
  document.getElementById('cardSettingsModal').style.display = 'flex';
}

function closeCardSettingsModal() {
  document.getElementById('cardSettingsModal').style.display = 'none';
}

function getCardCycleStatus(cardName) {
  const settings = getCardSettings()[cardName];
  if (!settings) return null;
  const today = new Date();
  const currentDay = today.getDate();
  const { cutDay, dueDay } = settings;

  let daysToCut = cutDay - currentDay;
  if (daysToCut < 0) {
    const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    daysToCut = (daysInCurrentMonth - currentDay) + cutDay;
  }

  let daysToDue = dueDay - currentDay;
  if (daysToDue < 0) {
    const daysInCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    daysToDue = (daysInCurrentMonth - currentDay) + dueDay;
  }

  const isPostCut = currentDay >= cutDay;
  return { cutDay, dueDay, daysToCut, daysToDue, isPostCut };
}

function updateCardCycleAlerts() {
  const container = document.getElementById('card-cycle-alerts');
  if (!container) return;

  const nuStatus = getCardCycleStatus('Nu');
  const rappiStatus = getCardCycleStatus('Rappi');

  let html = '';
  if (nuStatus) {
    const advice = nuStatus.daysToCut <= 2 
      ? '⏳ Corte muy cerca' 
      : (nuStatus.isPostCut ? '⭐ Entra al próximo mes' : `${nuStatus.daysToCut}d para corte`);
    html += `<span class="cycle-pill nu">💜 Nu: Corte día ${nuStatus.cutDay} (Pago día ${nuStatus.dueDay}) · <strong>${advice}</strong></span>`;
  }
  if (rappiStatus) {
    const advice = rappiStatus.daysToCut <= 2 
      ? '⏳ Corte muy cerca' 
      : (rappiStatus.isPostCut ? '⭐ Entra al próximo mes' : `${rappiStatus.daysToCut}d para corte`);
    html += `<span class="cycle-pill rappi">🧡 Rappi: Corte día ${rappiStatus.cutDay} (Pago día ${rappiStatus.dueDay}) · <strong>${advice}</strong></span>`;
  }
  container.innerHTML = html;
}

// Badges de Método de Pago
function formatPaymentBadge(method) {
  if (!method) return '<span style="color:#9ca3af;">-</span>';
  switch (method) {
    case 'Nu':
      return '<span class="pay-badge pay-nu">Nu 💜</span>';
    case 'Rappi':
      return '<span class="pay-badge pay-rappi">Rappi 🧡</span>';
    case 'Efectivo':
      return '<span class="pay-badge pay-cash">Efectivo 💵</span>';
    default:
      return `<span class="pay-badge pay-other">${escapeHtml(method)} 💳</span>`;
  }
}

// Badge de Estado de Tarjeta Pagada
function formatCardPaidBadge(prod) {
  const method = prod.paymentMethod || '';
  if (method === 'Efectivo') {
    return `<span class="card-paid-na">N/A 💵</span>`;
  }

  const isPaid = prod.cardPaid === 'Si';

  if (isPaid) {
    return `<button type="button" class="card-paid-btn paid" title="Clic para marcar como pendiente" onclick="toggleCardPaidStatus('${prod.id}', 'No')">✅ Pagada</button>`;
  } else {
    return `<button type="button" class="card-paid-btn pending" title="Clic para marcar como pagada" onclick="toggleCardPaidStatus('${prod.id}', 'Si')">⏳ Pendiente</button>`;
  }
}

function toggleCardPaidStatus(docId, newStatus) {
  db.collection("productos").doc(docId).update({
    cardPaid: newStatus
  }).then(() => {
    showToast(`Tarjeta marcada como ${newStatus === 'Si' ? 'Pagada' : 'Pendiente'}`);
  }).catch(err => {
    showToast('Error al actualizar tarjeta: ' + err.message, 'error');
  });
}

// Manejador común de cambio de método de pago
function handlePaymentMethodChange(val, isEdit = false) {
  const groupId = isEdit ? 'editCardPaidGroup' : 'cardPaidGroup';
  const cardGroup = document.getElementById(groupId);
  if (cardGroup) {
    cardGroup.style.display = val === 'Efectivo' ? 'none' : 'block';
  }
}

function handleEditPaymentMethodChange(val) {
  handlePaymentMethodChange(val, true);
}

function toggleForm() {
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  document.getElementById('toggle-icon').innerText = isHidden ? '▲' : '▼';
}

function toggleSoldPriceInput(status) {
  document.getElementById('soldPriceGroup').style.display = status === 'Vendido' ? 'block' : 'none';
}

// Navegación de Pestañas
function switchView(view) {
  currentView = view;
  currentSubFilter = 'ALL';
  clearSelection();

  document.getElementById('tab-stock').classList.toggle('active', view === 'stock');
  document.getElementById('tab-history').classList.toggle('active', view === 'history');
  document.getElementById('tab-debts').classList.toggle('active', view === 'debts');

  const debtBar = document.getElementById('debt-actions-bar');
  if (debtBar) debtBar.style.display = view === 'debts' ? 'flex' : 'none';

  const formCard = document.getElementById('product-form-card');
  if (formCard) formCard.style.display = view === 'debts' ? 'none' : 'block';

  renderSubFilters();
  renderTableHeader();
  render();
}

function renderTableHeader() {
  const thead = document.getElementById('table-head');
  if (!thead) return;

  if (currentView === 'debts') {
    thead.innerHTML = `
      <tr>
        <th class="th-checkbox">
          <input type="checkbox" id="select-all-checkbox" onchange="toggleSelectAll(this.checked)" title="Seleccionar todos">
        </th>
        <th class="sortable-th" onclick="handleSort('name')">Producto <span class="sort-icon" id="sort-name">↕</span></th>
        <th class="sortable-th" onclick="handleSort('paymentMethod')">Tarjeta <span class="sort-icon" id="sort-paymentMethod">↕</span></th>
        <th class="sortable-th" onclick="handleSort('cost')">Deuda Pendiente ($) <span class="sort-icon" id="sort-cost">↕</span></th>
        <th class="sortable-th" onclick="handleSort('debtStatus')">Semáforo de Respaldo <span class="sort-icon" id="sort-debtStatus">↕</span></th>
        <th class="sortable-th" onclick="handleSort('platform')">Plataforma <span class="sort-icon" id="sort-platform">↕</span></th>
        <th class="sortable-th" onclick="handleSort('buyDate')">Fecha Compra <span class="sort-icon" id="sort-buyDate">↕</span></th>
        <th>Estado del Producto</th>
        <th>Acción Rápida</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th class="th-checkbox">
          <input type="checkbox" id="select-all-checkbox" onchange="toggleSelectAll(this.checked)" title="Seleccionar todos">
        </th>
        <th class="sortable-th" onclick="handleSort('name')">Producto <span class="sort-icon" id="sort-name">↕</span></th>
        <th class="sortable-th" onclick="handleSort('paymentMethod')">Pago <span class="sort-icon" id="sort-paymentMethod">↕</span></th>
        <th class="sortable-th" onclick="handleSort('cardPaid')">Tarjeta Pagada <span class="sort-icon" id="sort-cardPaid">↕</span></th>
        <th class="sortable-th" onclick="handleSort('platform')">Plataforma <span class="sort-icon" id="sort-platform">↕</span></th>
        <th class="sortable-th" onclick="handleSort('cost')">Costo <span class="sort-icon" id="sort-cost">↕</span></th>
        <th class="sortable-th" onclick="handleSort('targetPrice')">Venta Obj. / Real <span class="sort-icon" id="sort-targetPrice">↕</span></th>
        <th class="sortable-th" onclick="handleSort('profit')">Ganancia / ROI <span class="sort-icon" id="sort-profit">↕</span></th>
        <th class="sortable-th" onclick="handleSort('buyDate')">Fecha Compra <span class="sort-icon" id="sort-buyDate">↕</span></th>
        <th class="sortable-th" onclick="handleSort('daysInStock')">Tiempo Stock <span class="sort-icon" id="sort-daysInStock">↕</span></th>
        <th class="sortable-th" onclick="handleSort('daysRemaining')">Plazo Devolución <span class="sort-icon" id="sort-daysRemaining">↕</span></th>
        <th>Link</th>
        <th class="sortable-th" onclick="handleSort('status')">Estado <span class="sort-icon" id="sort-status">↕</span></th>
        <th>Acciones</th>
      </tr>
    `;
  }
}

function renderSubFilters() {
  const container = document.getElementById('subfilter-container');
  if (!container) return;

  if (currentView === 'stock') {
    const transitCount = products.filter(p => p.status === 'Disponible' && !p.arrivalDate).length;
    const warehouseCount = products.filter(p => p.status === 'Disponible' && p.arrivalDate).length;
    const allStock = transitCount + warehouseCount;

    container.innerHTML = `
      <label>Filtrar Stock:</label>
      <div class="status-chips">
        <button type="button" class="chip ${currentSubFilter === 'ALL' ? 'active' : ''}" onclick="setSubFilter('ALL')">Todos (${allStock})</button>
        <button type="button" class="chip ${currentSubFilter === 'TRANSIT' ? 'active' : ''}" onclick="setSubFilter('TRANSIT')">🚚 En camino (${transitCount})</button>
        <button type="button" class="chip ${currentSubFilter === 'WAREHOUSE' ? 'active' : ''}" onclick="setSubFilter('WAREHOUSE')">📦 En bodega (${warehouseCount})</button>
      </div>
    `;
  } else if (currentView === 'history') {
    const soldCount = products.filter(p => p.status === 'Vendido').length;
    const retCount = products.filter(p => p.status === 'Devuelto').length;
    const allHistory = soldCount + retCount;

    container.innerHTML = `
      <label>Filtrar Historial:</label>
      <div class="status-chips">
        <button type="button" class="chip ${currentSubFilter === 'ALL' ? 'active' : ''}" onclick="setSubFilter('ALL')">Todo el Historial (${allHistory})</button>
        <button type="button" class="chip ${currentSubFilter === 'Vendido' ? 'active' : ''}" onclick="setSubFilter('Vendido')">🔵 Vendidos (${soldCount})</button>
        <button type="button" class="chip ${currentSubFilter === 'Devuelto' ? 'active' : ''}" onclick="setSubFilter('Devuelto')">⚪ Devueltos (${retCount})</button>
      </div>
    `;
  } else if (currentView === 'debts') {
    const pendingDebts = products.filter(p => p.paymentMethod !== 'Efectivo' && p.cardPaid === 'No');
    const nuCount = pendingDebts.filter(p => p.paymentMethod === 'Nu').length;
    const rappiCount = pendingDebts.filter(p => p.paymentMethod === 'Rappi').length;

    container.innerHTML = `
      <label>Filtrar Deudas:</label>
      <div class="status-chips">
        <button type="button" class="chip ${currentSubFilter === 'ALL' ? 'active' : ''}" onclick="setSubFilter('ALL')">Todas las Deudas (${pendingDebts.length})</button>
        <button type="button" class="chip ${currentSubFilter === 'Nu' ? 'active' : ''}" onclick="setSubFilter('Nu')">💜 Nu (${nuCount})</button>
        <button type="button" class="chip ${currentSubFilter === 'Rappi' ? 'active' : ''}" onclick="setSubFilter('Rappi')">🧡 Rappi (${rappiCount})</button>
      </div>
    `;
  }
}

function setSubFilter(filter) {
  currentSubFilter = filter;
  renderSubFilters();
  render();
}

function updateTabCounters() {
  const stockCount = products.filter(p => p.status === 'Disponible').length;
  const historyCount = products.filter(p => p.status === 'Vendido' || p.status === 'Devuelto').length;
  const pendingDebts = products.filter(p => p.paymentMethod !== 'Efectivo' && p.cardPaid === 'No');

  const stockBadge = document.getElementById('badge-stock-count');
  const historyBadge = document.getElementById('badge-history-count');
  const debtBadge = document.getElementById('badge-debt-count');

  if (stockBadge) stockBadge.innerText = stockCount;
  if (historyBadge) historyBadge.innerText = historyCount;
  if (debtBadge) debtBadge.innerText = pendingDebts.length;

  const nuPending = pendingDebts.filter(p => p.paymentMethod === 'Nu').length;
  const rappiPending = pendingDebts.filter(p => p.paymentMethod === 'Rappi').length;

  const countNuElem = document.getElementById('count-pending-nu');
  const countRappiElem = document.getElementById('count-pending-rappi');
  if (countNuElem) countNuElem.innerText = nuPending;
  if (countRappiElem) countRappiElem.innerText = rappiPending;

  renderSubFilters();
}

function resetFilters() {
  monthFilterSelect.value = 'ALL';
  searchInput.value = '';
  currentSubFilter = 'ALL';
  renderSubFilters();
  clearSelection();
}

function updateMonthOptions() {
  const selectedMonth = monthFilterSelect.value;
  const months = new Set();

  products.forEach(p => {
    if (p.buyDate) months.add(p.buyDate.substring(0, 7));
  });

  monthFilterSelect.innerHTML = '<option value="ALL">Todos los Meses</option>';
  Array.from(months).sort().reverse().forEach(m => {
    const [year, month] = m.split('-');
    const dateObj = new Date(year, month - 1, 1);
    const monthName = dateObj.toLocaleString('es-ES', { month: 'long', year: 'numeric' });

    const option = document.createElement('option');
    option.value = m;
    option.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    if (m === selectedMonth) option.selected = true;
    monthFilterSelect.appendChild(option);
  });
}

// Selección Múltiple con Checkbox
function toggleProductSelection(docId, event) {
  if (event && (event.target.closest('button') || event.target.closest('select') || event.target.closest('a'))) {
    return;
  }

  if (selectedProductIds.has(docId)) {
    selectedProductIds.delete(docId);
  } else {
    selectedProductIds.add(docId);
  }
  render();
}

function toggleSelectAll(isChecked) {
  const visibleRows = inventoryList.querySelectorAll('tr[data-id]');
  visibleRows.forEach(row => {
    const id = row.getAttribute('data-id');
    if (isChecked) {
      selectedProductIds.add(id);
    } else {
      selectedProductIds.delete(id);
    }
  });
  render();
}

function clearSelection() {
  selectedProductIds.clear();
  const selectAll = document.getElementById('select-all-checkbox');
  if (selectAll) selectAll.checked = false;
  render();
}

function bulkMarkAsSold() {
  if (selectedProductIds.size === 0) return;

  const today = new Date().toISOString().split('T')[0];
  const batch = db.batch();
  let count = 0;

  selectedProductIds.forEach(id => {
    const prod = products.find(p => p.id === id);
    if (prod && prod.status === 'Disponible') {
      const docRef = db.collection("productos").doc(id);
      batch.update(docRef, {
        status: 'Vendido',
        actualPrice: prod.actualPrice || prod.targetPrice,
        sellDate: today
      });
      count++;
    }
  });

  if (count === 0) {
    return showToast('No hay productos disponibles seleccionados para vender.', 'warning');
  }

  batch.commit().then(() => {
    showToast(`🎉 ¡${count} producto${count !== 1 ? 's' : ''} marcado${count !== 1 ? 's' : ''} como vendido${count !== 1 ? 's' : ''}!`);
    clearSelection();
  }).catch(err => {
    showToast('Error al marcar lote como vendido: ' + err.message, 'error');
  });
}

function openBulkDeleteModal() {
  if (selectedProductIds.size === 0) return;
  document.getElementById('bulkDeleteMessage').innerText = `¿Estás seguro de que deseas eliminar los ${selectedProductIds.size} productos seleccionados? Esta acción no se puede deshacer.`;
  document.getElementById('bulkDeleteModal').style.display = 'flex';
}

function closeBulkDeleteModal() {
  document.getElementById('bulkDeleteModal').style.display = 'none';
}

function confirmBulkDelete() {
  const batch = db.batch();
  selectedProductIds.forEach(id => {
    const docRef = db.collection("productos").doc(id);
    batch.delete(docRef);
  });

  batch.commit().then(() => {
    showToast(`🗑️ Lote de ${selectedProductIds.size} productos eliminado`);
    clearSelection();
    closeBulkDeleteModal();
  }).catch(err => {
    showToast('Error al eliminar lote: ' + err.message, 'error');
  });
}

// Modal de Pago de Corte Completo
function openCutPaymentModal(cardName) {
  const pendingForCard = products.filter(p => p.paymentMethod === cardName && p.cardPaid === 'No');
  if (pendingForCard.length === 0) {
    return showToast(`No tienes compras pendientes en Tarjeta ${cardName}.`, 'info');
  }

  const totalAmount = pendingForCard.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
  pendingCutCard = cardName;

  document.getElementById('cutPaymentMessage').innerText = `¿Confirmas que pagaste el corte de Tarjeta ${cardName}? Se marcarán como pagadas ${pendingForCard.length} compras por un total de ${formatCurrency(totalAmount)}.`;
  document.getElementById('cutPaymentModal').style.display = 'flex';
}

function closeCutPaymentModal() {
  document.getElementById('cutPaymentModal').style.display = 'none';
  pendingCutCard = null;
}

function confirmCutPayment() {
  if (!pendingCutCard) return;

  const batch = db.batch();
  const pendingForCard = products.filter(p => p.paymentMethod === pendingCutCard && p.cardPaid === 'No');

  pendingForCard.forEach(prod => {
    const docRef = db.collection("productos").doc(prod.id);
    batch.update(docRef, { cardPaid: 'Si' });
  });

  batch.commit().then(() => {
    showToast(`✅ Corte de Tarjeta ${pendingCutCard} saldado exitosamente`);
    closeCutPaymentModal();
  }).catch(err => {
    showToast('Error al confirmar pago de corte: ' + err.message, 'error');
  });
}

// Ordenamiento Robusto
function handleSort(columnKey) {
  if (currentSortColumn === columnKey) {
    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    currentSortColumn = columnKey;
    currentSortDirection = 'asc';
  }
  updateSortIcons();
  render();
}

function updateSortIcons() {
  const headers = ['name', 'paymentMethod', 'cardPaid', 'platform', 'cost', 'targetPrice', 'profit', 'buyDate', 'daysInStock', 'daysRemaining', 'status', 'debtStatus'];
  headers.forEach(h => {
    const icon = document.getElementById(`sort-${h}`);
    if (!icon) return;
    if (h === currentSortColumn) {
      icon.innerText = currentSortDirection === 'asc' ? '▲' : '▼';
      icon.style.color = '#2563eb';
    } else {
      icon.innerText = '↕';
      icon.style.color = '#9ca3af';
    }
  });
}

// Renderizado Principal de la Tabla y Métricas
function render() {
  if (currentView === 'analytics') return;

  inventoryList.innerHTML = '';

  const filterMonth = monthFilterSelect.value;
  const query = (searchInput.value || '').toLowerCase().trim();

  // 1. Filtrado
  let filteredProducts = products.filter(prod => {
    if (currentView === 'stock') {
      if (prod.status !== 'Disponible') return false;
      if (currentSubFilter === 'TRANSIT' && prod.arrivalDate) return false;
      if (currentSubFilter === 'WAREHOUSE' && !prod.arrivalDate) return false;
    } else if (currentView === 'history') {
      if (prod.status !== 'Vendido' && prod.status !== 'Devuelto') return false;
      if (currentSubFilter !== 'ALL' && prod.status !== currentSubFilter) return false;
    } else if (currentView === 'debts') {
      if (prod.paymentMethod === 'Efectivo' || prod.cardPaid !== 'No') return false;
      if (currentSubFilter !== 'ALL' && prod.paymentMethod !== currentSubFilter) return false;
    }

    if (filterMonth !== 'ALL' && (!prod.buyDate || !prod.buyDate.startsWith(filterMonth))) return false;

    if (query) {
      const matchName = prod.name && prod.name.toLowerCase().includes(query);
      const matchPlatform = prod.platform && prod.platform.toLowerCase().includes(query);
      const matchPay = prod.paymentMethod && prod.paymentMethod.toLowerCase().includes(query);
      if (!matchName && !matchPlatform && !matchPay) return false;
    }

    return true;
  });

  // 2. Ordenamiento Protegido
  if (currentSortColumn) {
    filteredProducts.sort((a, b) => {
      let valA, valB;

      if (currentSortColumn === 'cost' || currentSortColumn === 'targetPrice') {
        valA = parseFloat(a[currentSortColumn]) || 0;
        valB = parseFloat(b[currentSortColumn]) || 0;
      } else if (currentSortColumn === 'profit') {
        valA = calculateProductMetrics(a).profit;
        valB = calculateProductMetrics(b).profit;
      } else if (currentSortColumn === 'debtStatus') {
        valA = a.status === 'Vendido' ? 1 : 0;
        valB = b.status === 'Vendido' ? 1 : 0;
      } else if (currentSortColumn === 'daysInStock') {
        const startA = a.arrivalDate || a.buyDate || '';
        valA = calculateDays(startA, a.sellDate);
        const startB = b.arrivalDate || b.buyDate || '';
        valB = calculateDays(startB, b.sellDate);
      } else if (currentSortColumn === 'daysRemaining') {
        valA = getReturnRemainingDays(a.arrivalDate);
        valB = getReturnRemainingDays(b.arrivalDate);
      } else {
        valA = (a[currentSortColumn] || '').toString().toLowerCase();
        valB = (b[currentSortColumn] || '').toString().toLowerCase();
      }

      if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  } else {
    filteredProducts.sort((a, b) => {
      if (currentView === 'stock') {
        return getReturnRemainingDays(a.arrivalDate) - getReturnRemainingDays(b.arrivalDate);
      } else if (currentView === 'history') {
        const dateA = a.sellDate || a.buyDate || '';
        const dateB = b.sellDate || b.buyDate || '';
        return dateB.localeCompare(dateA);
      } else {
        return (a.buyDate || '').localeCompare(b.buyDate || '');
      }
    });
  }

  // 3. Selección y métricas
  const hasSelection = selectedProductIds.size > 0;
  const metricsSource = hasSelection
    ? filteredProducts.filter(p => selectedProductIds.has(p.id))
    : filteredProducts;

  if (hasSelection) {
    selectionBanner.style.display = 'flex';
    selectionCountText.innerText = `🔍 Mostrando métricas de ${selectedProductIds.size} producto${selectedProductIds.size !== 1 ? 's' : ''} seleccionado${selectedProductIds.size !== 1 ? 's' : ''}`;
  } else {
    selectionBanner.style.display = 'none';
  }

  // 4. Renderizar Tarjetas
  renderMetricsCards(metricsSource);

  // 5. Renderizar Filas de Tabla
  if (currentView === 'debts') {
    renderDebtRows(filteredProducts);
  } else {
    renderStandardRows(filteredProducts);
  }

  // Sincronizar checkbox "seleccionar todos"
  const selectAll = document.getElementById('select-all-checkbox');
  if (selectAll) {
    const allVisibleSelected = filteredProducts.length > 0 && filteredProducts.every(p => selectedProductIds.has(p.id));
    selectAll.checked = allVisibleSelected;
  }

  if (filteredProducts.length === 0) {
    let emptyMsg = '';
    if (currentView === 'stock') emptyMsg = 'No hay productos en stock o en camino en este momento.';
    else if (currentView === 'history') emptyMsg = 'No hay productos en el historial para este filtro.';
    else emptyMsg = '🎉 ¡Felicitaciones! No tienes deudas pendientes en tarjetas.';

    const colSpan = currentView === 'debts' ? 9 : 14;
    inventoryList.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding: 25px; color: #9ca3af;">${emptyMsg}</td></tr>`;
  }
}

// Renderizado de Filas para Deudas
function renderDebtRows(productsList) {
  productsList.forEach(prod => {
    const cost = parseFloat(prod.cost) || 0;
    const paymentBadge = formatPaymentBadge(prod.paymentMethod);
    const isSelected = selectedProductIds.has(prod.id);

    let trafficBadge = '';
    let productStatusText = '';

    if (prod.status === 'Vendido') {
      trafficBadge = `<span class="traffic-badge covered">🟢 Dinero en Mano (Cobrado)</span>`;
      productStatusText = `<span class="time-badge sold">Vendido</span>`;
    } else {
      trafficBadge = `<span class="traffic-badge uncovered">🟡 Pendiente en Stock</span>`;
      productStatusText = prod.arrivalDate 
        ? `<span class="time-badge">En bodega</span>` 
        : `<span class="time-badge">🚚 En camino</span>`;
    }

    const row = document.createElement('tr');
    row.setAttribute('data-id', prod.id);
    if (isSelected) row.className = 'row-selected';
    row.onclick = (e) => toggleProductSelection(prod.id, e);

    row.innerHTML = `
      <td class="td-checkbox">
        <input type="checkbox" class="row-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleProductSelection('${prod.id}', event)">
      </td>
      <td><strong>${escapeHtml(prod.name)}</strong></td>
      <td>${paymentBadge}</td>
      <td><strong class="text-red">${formatCurrency(cost)}</strong></td>
      <td>${trafficBadge}</td>
      <td>${escapeHtml(prod.platform)}</td>
      <td>${prod.buyDate || '-'}</td>
      <td>${productStatusText}</td>
      <td>
        <button class="btn-quick-pay" onclick="toggleCardPaidStatus('${prod.id}', 'Si')">✅ Pagar</button>
      </td>
    `;
    inventoryList.appendChild(row);
  });
}

// Renderizado de Filas Estándar (Stock e Historial)
function renderStandardRows(productsList) {
  productsList.forEach((prod) => {
    const metrics = calculateProductMetrics(prod);
    const isSelected = selectedProductIds.has(prod.id);

    let profitClass = '';
    let profitLabel = '';
    let roiHtml = '';

    if (prod.status === 'Vendido') {
      profitClass = metrics.profit >= 0 ? 'text-green' : 'text-red';
      profitLabel = `${metrics.profit >= 0 ? '+' : ''}${formatCurrency(metrics.profit)} Real`;
      roiHtml = `<span class="roi-badge ${profitClass}">${metrics.roi >= 0 ? '+' : ''}${metrics.roi}% ROI</span>`;
    } else if (prod.status === 'Devuelto') {
      profitClass = 'text-gray';
      profitLabel = `$0 (Devuelto)`;
      roiHtml = `<span class="roi-badge text-gray">0.0% ROI</span>`;
    } else {
      profitClass = metrics.profit >= 0 ? 'text-est' : 'text-red';
      profitLabel = `${metrics.profit >= 0 ? '+' : ''}${formatCurrency(metrics.profit)} Est.`;
      roiHtml = `<span class="roi-badge ${profitClass}">${metrics.roi >= 0 ? '+' : ''}${metrics.roi}% ROI</span>`;
    }

    let timeLabel = '';
    if (prod.status === 'Vendido') {
      const startDate = prod.arrivalDate || prod.buyDate;
      const daysInStock = calculateDays(startDate, prod.sellDate);
      timeLabel = `<span class="time-badge sold">Vendido en ${daysInStock} d</span>`;
    } else if (prod.status === 'Devuelto') {
      timeLabel = `<span class="time-badge returned">📦 Reembolsado</span>`;
    } else if (prod.arrivalDate) {
      const daysInStock = calculateDays(prod.arrivalDate, null);
      timeLabel = `<span class="time-badge">${daysInStock} d en stock</span>`;
    } else {
      timeLabel = `<span class="time-badge">🚚 En camino</span>`;
    }

    const returnBadge = calculateReturnStatus(prod.arrivalDate, prod.status);
    const paymentBadge = formatPaymentBadge(prod.paymentMethod);
    const cardPaidBadge = formatCardPaidBadge(prod);

    // Sanitización segura de enlace
    const safeUrl = (prod.productUrl && (prod.productUrl.startsWith('http://') || prod.productUrl.startsWith('https://'))) 
      ? prod.productUrl 
      : null;

    const linkHtml = safeUrl 
      ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="link-btn">🔗 Ver</a>` 
      : `<span class="link-btn disabled">Sin link</span>`;

    const row = document.createElement('tr');
    row.setAttribute('data-id', prod.id);

    let rowClasses = [];
    if (prod.status === 'Vendido') rowClasses.push('row-sold');
    if (prod.status === 'Devuelto') rowClasses.push('row-returned');
    if (prod.status === 'Disponible' && prod.arrivalDate) {
      const returnDays = getReturnRemainingDays(prod.arrivalDate);
      if (returnDays >= 0 && returnDays <= 5) {
        rowClasses.push('row-return-critical');
      }
    }
    if (isSelected) rowClasses.push('row-selected');
    if (rowClasses.length > 0) row.className = rowClasses.join(' ');

    row.onclick = (e) => toggleProductSelection(prod.id, e);

    row.innerHTML = `
      <td class="td-checkbox">
        <input type="checkbox" class="row-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleProductSelection('${prod.id}', event)">
      </td>
      <td><strong>${escapeHtml(prod.name)}</strong></td>
      <td>${paymentBadge}</td>
      <td>${cardPaidBadge}</td>
      <td>${escapeHtml(prod.platform)}</td>
      <td>${formatCurrency(metrics.cost)}</td>
      <td>${formatCurrency(prod.status === 'Vendido' ? metrics.actualPrice : metrics.targetPrice)}</td>
      <td>
        <span class="${profitClass}">${profitLabel}</span>
        ${roiHtml}
      </td>
      <td>${prod.buyDate || '-'}</td>
      <td>${timeLabel}</td>
      <td>${returnBadge}</td>
      <td>${linkHtml}</td>
      <td>
        <select class="select-status" onchange="handleStatusChange('${prod.id}', this.value, ${metrics.targetPrice})">
          <option value="Disponible" ${prod.status === 'Disponible' ? 'selected' : ''}>Disponible</option>
          <option value="Vendido" ${prod.status === 'Vendido' ? 'selected' : ''}>Vendido</option>
          <option value="Devuelto" ${prod.status === 'Devuelto' ? 'selected' : ''}>Devuelto</option>
        </select>
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn-duplicate" title="Duplicar producto" onclick="duplicateProduct('${prod.id}')">Copiar</button>
          <button class="btn-edit" onclick="openEditModal('${prod.id}')">Editar</button>
          <button class="btn-delete" onclick="openDeleteModal('${prod.id}')">Eliminar</button>
        </div>
      </td>
    `;
    inventoryList.appendChild(row);
  });
}

// Renderizado de Tarjetas Métricas Superiores
function renderMetricsCards(sourceList) {
  const grid = document.getElementById('metrics-grid');
  if (!grid) return;

  if (currentView === 'stock') {
    let stockCapital = 0;
    let projectedRevenue = 0;
    let projectedProfit = 0;
    let inTransit = 0;
    let inWarehouse = 0;

    sourceList.forEach(prod => {
      const metrics = calculateProductMetrics(prod);
      stockCapital += metrics.cost;
      projectedRevenue += metrics.targetPrice;
      projectedProfit += metrics.profit;

      if (prod.arrivalDate) inWarehouse++;
      else inTransit++;
    });

    const totalUnits = inTransit + inWarehouse;

    grid.innerHTML = `
      <div class="card-summary">
        <p>Capital en Stock (Riesgo)</p>
        <h2 class="text-warning">${formatCurrency(stockCapital)}</h2>
        <span class="sub-text text-gray">${totalUnits} producto${totalUnits !== 1 ? 's' : ''} activo${totalUnits !== 1 ? 's' : ''}</span>
      </div>

      <div class="card-summary">
        <p>Venta Estimada Total</p>
        <h2 class="text-blue">${formatCurrency(projectedRevenue)}</h2>
        <span class="sub-text text-gray">Ingreso bruto proyectado</span>
      </div>

      <div class="card-summary">
        <p>Ganancia Proyectada</p>
        <h2 class="text-est">${formatCurrency(projectedProfit)}</h2>
        <span class="sub-text text-gray">Margen esperado limpio</span>
      </div>

      <div class="card-summary">
        <p>Estado Físico Stock</p>
        <h2 class="text-blue">${inWarehouse} en bodega</h2>
        <span class="sub-text text-gray">🚚 ${inTransit} en camino</span>
      </div>
    `;
  } else if (currentView === 'history') {
    let capitalRecovered = 0;
    let realizedProfit = 0;
    let totalCostSold = 0;
    let totalDaysSold = 0;
    let soldCount = 0;
    let returnCount = 0;

    sourceList.forEach(prod => {
      const metrics = calculateProductMetrics(prod);

      if (prod.status === 'Vendido') {
        capitalRecovered += metrics.actualPrice;
        realizedProfit += metrics.profit;
        totalCostSold += metrics.cost;
        soldCount++;

        const start = prod.arrivalDate || prod.buyDate;
        totalDaysSold += calculateDays(start, prod.sellDate);
      } else if (prod.status === 'Devuelto') {
        capitalRecovered += metrics.cost;
        returnCount++;
      }
    });

    const avgRoi = totalCostSold > 0 ? ((realizedProfit / totalCostSold) * 100).toFixed(1) : 0;
    const avgDays = soldCount > 0 ? Math.round(totalDaysSold / soldCount) : 0;

    grid.innerHTML = `
      <div class="card-summary">
        <p>Capital Total Recuperado</p>
        <h2 class="text-blue">${formatCurrency(capitalRecovered)}</h2>
        <span class="sub-text text-gray">${soldCount} vendido${soldCount !== 1 ? 's' : ''} / ${returnCount} devuelto${returnCount !== 1 ? 's' : ''}</span>
      </div>

      <div class="card-summary">
        <p>Ganancia Real Neta</p>
        <h2 class="${realizedProfit >= 0 ? 'text-green' : 'text-red'}">${realizedProfit >= 0 ? '+' : ''}${formatCurrency(realizedProfit)}</h2>
        <span class="sub-text ${realizedProfit >= 0 ? 'text-green' : 'text-red'}">Dinero limpio en mano</span>
      </div>

      <div class="card-summary">
        <p>ROI Promedio Histórico</p>
        <h2 class="text-green">+${avgRoi}%</h2>
        <span class="sub-text text-gray">Retorno sobre costo</span>
      </div>

      <div class="card-summary">
        <p>Velocidad de Rotación</p>
        <h2 class="text-blue">${avgDays} días</h2>
        <span class="sub-text text-gray">Tiempo promedio de venta</span>
      </div>
    `;
  } else if (currentView === 'debts') {
    let totalDebt = 0;
    let debtNu = 0;
    let debtRappi = 0;
    let debtOther = 0;
    let coveredDebt = 0;

    sourceList.forEach(prod => {
      const cost = parseFloat(prod.cost) || 0;
      totalDebt += cost;

      if (prod.paymentMethod === 'Nu') debtNu += cost;
      else if (prod.paymentMethod === 'Rappi') debtRappi += cost;
      else debtOther += cost;

      if (prod.status === 'Vendido') {
        coveredDebt += cost;
      }
    });

    grid.innerHTML = `
      <div class="card-summary">
        <p>Deuda Total Tarjetas</p>
        <h2 class="text-red">${formatCurrency(totalDebt)}</h2>
        <span class="sub-text text-gray">${sourceList.length} compra${sourceList.length !== 1 ? 's' : ''} pendiente${sourceList.length !== 1 ? 's' : ''}</span>
      </div>

      <div class="card-summary">
        <p>Extracto Nu 💜</p>
        <h2 class="text-nu">${formatCurrency(debtNu)}</h2>
        <span class="sub-text text-gray">Pendiente por transferir</span>
      </div>

      <div class="card-summary">
        <p>Extracto RappiCard 🧡</p>
        <h2 class="text-rappi">${formatCurrency(debtRappi)}</h2>
        <span class="sub-text text-gray">Pendiente por transferir</span>
      </div>

      <div class="card-summary">
        <p>Deuda Respaldada</p>
        <h2 class="text-green">${formatCurrency(coveredDebt)}</h2>
        <span class="sub-text text-gray">Cobrado listo para pagar</span>
      </div>
    `;
  }
}

// Registro de Nuevos Productos (Soporta registro Multi-unidad)
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const status = document.getElementById('status').value;
  const paymentMethod = document.getElementById('paymentMethod').value;
  const actualSoldPrice = document.getElementById('actualSoldPrice').value;
  const arrivalDateVal = document.getElementById('arrivalDate') ? document.getElementById('arrivalDate').value : null;
  const quantityInput = document.getElementById('quantity');
  const quantity = quantityInput ? (parseInt(quantityInput.value) || 1) : 1;
  const baseName = document.getElementById('name').value.trim();

  const baseProduct = {
    paymentMethod: paymentMethod,
    cardPaid: paymentMethod === 'Efectivo' ? 'N/A' : document.getElementById('cardPaid').value,
    platform: document.getElementById('platform').value.trim(),
    cost: document.getElementById('cost').value,
    targetPrice: document.getElementById('targetPrice').value,
    actualPrice: status === 'Vendido' && actualSoldPrice ? actualSoldPrice : null,
    productUrl: document.getElementById('productUrl').value.trim(),
    buyDate: document.getElementById('buyDate').value,
    arrivalDate: arrivalDateVal || null,
    sellDate: status === 'Vendido' ? new Date().toISOString().split('T')[0] : null,
    status: status
  };

  const onSaveSuccess = () => {
    form.reset();
    document.getElementById('paymentMethod').value = 'Nu';
    document.getElementById('cardPaid').value = 'No';
    if (quantityInput) quantityInput.value = '1';
    handlePaymentMethodChange('Nu');
    toggleSoldPriceInput('Disponible');
    if (buyDateInput) buyDateInput.value = new Date().toISOString().split('T')[0];
    toggleForm();
    showToast(quantity > 1 ? `🎉 ¡${quantity} unidades de "${baseName}" registradas!` : '🎉 ¡Producto registrado con éxito!');
  };

  if (quantity > 1) {
    const batch = db.batch();
    for (let i = 1; i <= quantity; i++) {
      const docRef = db.collection("productos").doc();
      batch.set(docRef, {
        ...baseProduct,
        name: `${baseName} (${i}/${quantity})`
      });
    }
    batch.commit().then(onSaveSuccess).catch(err => {
      showToast('Error al guardar lote de unidades: ' + err.message, 'error');
    });
  } else {
    db.collection("productos").add({
      ...baseProduct,
      name: baseName
    }).then(onSaveSuccess).catch(err => {
      showToast('Error al guardar el producto: ' + err.message, 'error');
    });
  }
});

// Duplicar Producto
function duplicateProduct(docId) {
  const original = products.find(p => p.id === docId);
  if (!original) return;

  const duplicated = {
    name: original.name,
    paymentMethod: original.paymentMethod || 'Nu',
    cardPaid: original.paymentMethod === 'Efectivo' ? 'N/A' : 'No',
    platform: original.platform,
    cost: original.cost,
    targetPrice: original.targetPrice,
    productUrl: original.productUrl || '',
    buyDate: new Date().toISOString().split('T')[0],
    arrivalDate: null,
    sellDate: null,
    actualPrice: null,
    status: 'Disponible'
  };

  db.collection("productos").add(duplicated).then(() => {
    showToast(`Copia creada: "${original.name}"`);
  }).catch(err => {
    showToast('Error al duplicar: ' + err.message, 'error');
  });
}

// Modal de Edición
function openEditModal(docId) {
  const product = products.find(p => p.id === docId);
  if (!product) return;

  pendingEditDocId = docId;
  document.getElementById('edit-name').value = product.name || '';
  const payMethod = product.paymentMethod || 'Nu';
  document.getElementById('edit-paymentMethod').value = payMethod;
  handleEditPaymentMethodChange(payMethod);
  document.getElementById('edit-cardPaid').value = product.cardPaid || 'No';

  document.getElementById('edit-platform').value = product.platform || '';
  document.getElementById('edit-cost').value = product.cost || '';
  document.getElementById('edit-targetPrice').value = product.targetPrice || '';
  document.getElementById('edit-productUrl').value = product.productUrl || '';
  document.getElementById('edit-buyDate').value = product.buyDate || '';
  document.getElementById('edit-arrivalDate').value = product.arrivalDate || '';

  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
  pendingEditDocId = null;
}

function confirmEdit(e) {
  e.preventDefault();
  if (!pendingEditDocId) return;

  const payMethod = document.getElementById('edit-paymentMethod').value;
  const updatedProduct = {
    name: document.getElementById('edit-name').value.trim(),
    paymentMethod: payMethod,
    cardPaid: payMethod === 'Efectivo' ? 'N/A' : document.getElementById('edit-cardPaid').value,
    platform: document.getElementById('edit-platform').value.trim(),
    cost: document.getElementById('edit-cost').value,
    targetPrice: document.getElementById('edit-targetPrice').value,
    productUrl: document.getElementById('edit-productUrl').value.trim(),
    buyDate: document.getElementById('edit-buyDate').value,
    arrivalDate: document.getElementById('edit-arrivalDate').value || null
  };

  db.collection("productos").doc(pendingEditDocId).update(updatedProduct).then(() => {
    showToast('Cambios guardados con éxito');
    closeEditModal();
  }).catch(err => {
    showToast('Error al editar producto: ' + err.message, 'error');
  });
}

// Cambio de Estado con Confirmación Segura
function handleStatusChange(docId, newStatus, targetPrice) {
  const prod = products.find(p => p.id === docId);

  if (newStatus === 'Vendido') {
    pendingSaleDocId = docId;
    document.getElementById('modalPriceInput').value = targetPrice;
    document.getElementById('saleModal').style.display = 'flex';
  } else if (newStatus === 'Devuelto') {
    pendingReturnDocId = docId;
    document.getElementById('returnModalMessage').innerText = `¿Confirmas que devolviste "${prod ? prod.name : 'este producto'}" a la tienda y recibiste el reembolso de ${formatCurrency(prod ? prod.cost : 0)}?`;
    document.getElementById('returnModal').style.display = 'flex';
  } else {
    db.collection("productos").doc(docId).update({
      status: 'Disponible',
      actualPrice: null,
      sellDate: null
    }).then(() => {
      showToast('Producto regresado a Disponible');
    }).catch(err => {
      showToast('Error al actualizar estado: ' + err.message, 'error');
      render();
    });
  }
}

function closeSaleModal() {
  document.getElementById('saleModal').style.display = 'none';
  pendingSaleDocId = null;
  render();
}

function confirmSale() {
  const price = document.getElementById('modalPriceInput').value;
  if (pendingSaleDocId && price) {
    db.collection("productos").doc(pendingSaleDocId).update({
      status: 'Vendido',
      actualPrice: price,
      sellDate: new Date().toISOString().split('T')[0]
    }).then(() => {
      showToast('🎉 ¡Venta guardada exitosamente!');
      closeSaleModal();
    }).catch(err => {
      showToast('Error al guardar venta: ' + err.message, 'error');
    });
  }
}

// Confirmar Devolución
function closeReturnModal() {
  document.getElementById('returnModal').style.display = 'none';
  pendingReturnDocId = null;
  render();
}

function confirmReturn() {
  if (!pendingReturnDocId) return;
  const today = new Date().toISOString().split('T')[0];
  db.collection("productos").doc(pendingReturnDocId).update({
    status: 'Devuelto',
    actualPrice: null,
    sellDate: today
  }).then(() => {
    showToast('📦 Producto registrado como Devuelto');
    closeReturnModal();
  }).catch(err => {
    showToast('Error al registrar devolución: ' + err.message, 'error');
  });
}

// Modal de Eliminación
function openDeleteModal(docId) {
  pendingDeleteDocId = docId;
  document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
  document.getElementById('deleteModal').style.display = 'none';
  pendingDeleteDocId = null;
}

function confirmDelete() {
  if (pendingDeleteDocId) {
    db.collection("productos").doc(pendingDeleteDocId).delete().then(() => {
      selectedProductIds.delete(pendingDeleteDocId);
      showToast('Producto eliminado');
      closeDeleteModal();
    }).catch(err => {
      showToast('Error al eliminar producto: ' + err.message, 'error');
    });
  }
}

// Exportación a Excel (CSV con formato compatible con Excel Latinoamericano)
function exportToExcel() {
  if (products.length === 0) return showToast("No hay productos para exportar.", "info");

  let csvContent = "\uFEFFProducto;Metodo Pago;Tarjeta Pagada;Plataforma;Costo Compra;Precio Venta Obj;Precio Real Venta;Ganancia;ROI (%);Fecha Compra;Fecha Llegada;Fecha Venta;Dias en Stock;Estado;Link\n";

  products.forEach(p => {
    const metrics = calculateProductMetrics(p);
    const startDate = p.arrivalDate || p.buyDate;
    const days = calculateDays(startDate, p.sellDate);

    csvContent += `"${(p.name || '').replace(/"/g, '""')}";"${p.paymentMethod || '-'}";"${p.cardPaid || 'No'}";"${(p.platform || '').replace(/"/g, '""')}";${metrics.cost};${metrics.targetPrice};${p.actualPrice || '-'};${metrics.profit};${metrics.roi}%;"${p.buyDate || '-'}";"${p.arrivalDate || '-'}";"${p.sellDate || '-'}";${days};"${p.status}";"${p.productUrl || '-'}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Inventario_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('📥 Archivo Excel (CSV) descargado');
}

// Debounce para optimizar búsqueda en tiempo real
function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedRender = debounce(() => render(), 250);

// Sanitizador de texto para evitar XSS
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Inicialización de la cabecera
renderTableHeader();
