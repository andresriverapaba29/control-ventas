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

// Pestaña activa: 'stock' (por defecto), 'history' o 'debts'
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

buyDateInput.value = new Date().toISOString().split('T')[0];

db.collection("productos").onSnapshot((snapshot) => {
  products = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  updateMonthOptions();
  updateTabCounters();
  render();
});

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount);
}

function calculateDays(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = endDateStr ? new Date(endDateStr) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}

function getReturnRemainingDays(arrivalDateStr) {
  if (!arrivalDateStr) return 999;
  const arrivalDate = new Date(arrivalDateStr);
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
  if (daysRemaining <= 10) return `<span class="return-badge warning">🟠 ${daysRemaining} d. restantes</span>`;
  return `<span class="return-badge safe">🟢 ${daysRemaining} d. restantes</span>`;
}

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

function formatCardPaidBadge(prod) {
  const method = prod.paymentMethod || '';
  if (method === 'Efectivo') {
    return `<span class="card-paid-na">N/A 💵</span>`;
  }

  const isPaid = prod.cardPaid ? prod.cardPaid === 'Si' : true;

  if (isPaid) {
    return `<button type="button" class="card-paid-btn paid" title="Clic para marcar como pendiente" onclick="toggleCardPaidStatus('${prod.id}', 'No')">✅ Pagada</button>`;
  } else {
    return `<button type="button" class="card-paid-btn pending" title="Clic para marcar como pagada" onclick="toggleCardPaidStatus('${prod.id}', 'Si')">⏳ Pendiente</button>`;
  }
}

function toggleCardPaidStatus(docId, newStatus) {
  db.collection("productos").doc(docId).update({
    cardPaid: newStatus
  });
}

function handlePaymentMethodChange(val) {
  const cardGroup = document.getElementById('cardPaidGroup');
  cardGroup.style.display = val === 'Efectivo' ? 'none' : 'block';
}

function handleEditPaymentMethodChange(val) {
  const cardGroup = document.getElementById('editCardPaidGroup');
  cardGroup.style.display = val === 'Efectivo' ? 'none' : 'block';
}

function toggleForm() {
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  document.getElementById('toggle-icon').innerText = isHidden ? '▲' : '▼';
}

function toggleSoldPriceInput(status) {
  document.getElementById('soldPriceGroup').style.display = status === 'Vendido' ? 'block' : 'none';
}

// Navegación de Pestañas Principales
function switchView(view) {
  currentView = view;
  currentSubFilter = 'ALL';
  clearSelection();

  document.getElementById('tab-stock').classList.toggle('active', view === 'stock');
  document.getElementById('tab-history').classList.toggle('active', view === 'history');
  document.getElementById('tab-debts').classList.toggle('active', view === 'debts');

  // Mostrar u ocultar barra de corte de deudas
  const debtBar = document.getElementById('debt-actions-bar');
  if (debtBar) {
    debtBar.style.display = view === 'debts' ? 'flex' : 'none';
  }

  // Ocultar formulario de registro al estar en deudas para mayor limpieza visual
  const formCard = document.getElementById('product-form-card');
  if (formCard) {
    formCard.style.display = view === 'debts' ? 'none' : 'block';
  }

  // Botón marcar vendidos en lote
  const bulkSellBtn = document.getElementById('btn-bulk-sell');
  if (bulkSellBtn) {
    bulkSellBtn.style.display = view === 'stock' ? 'inline-block' : 'none';
  }

  renderSubFilters();
  renderTableHeader();
  render();
}

function renderTableHeader() {
  const thead = document.getElementById('table-head');
  
  if (currentView === 'debts') {
    thead.innerHTML = `
      <tr>
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
  } else {
    // Subfiltros para Deudas
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
  
  // Conteo de deudas pendientes
  const pendingDebts = products.filter(p => p.paymentMethod !== 'Efectivo' && p.cardPaid === 'No');
  const debtCount = pendingDebts.length;

  document.getElementById('badge-stock-count').innerText = stockCount;
  document.getElementById('badge-history-count').innerText = historyCount;
  document.getElementById('badge-debt-count').innerText = debtCount;

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

function toggleProductSelection(docId, event) {
  if (event.target.closest('button') || event.target.closest('select') || event.target.closest('a')) {
    return;
  }

  if (selectedProductIds.has(docId)) {
    selectedProductIds.delete(docId);
  } else {
    selectedProductIds.add(docId);
  }

  render();
}

function clearSelection() {
  selectedProductIds.clear();
  render();
}

function bulkMarkAsSold() {
  if (selectedProductIds.size === 0) return;
  
  const today = new Date().toISOString().split('T')[0];
  const batch = db.batch();

  selectedProductIds.forEach(id => {
    const prod = products.find(p => p.id === id);
    if (prod && prod.status === 'Disponible') {
      const docRef = db.collection("productos").doc(id);
      batch.update(docRef, {
        status: 'Vendido',
        actualPrice: prod.actualPrice || prod.targetPrice,
        sellDate: today
      });
    }
  });

  batch.commit().then(() => {
    clearSelection();
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
    clearSelection();
    closeBulkDeleteModal();
  });
}

// Modal de Pago de Corte Completo
function openCutPaymentModal(cardName) {
  const pendingForCard = products.filter(p => p.paymentMethod === cardName && p.cardPaid === 'No');
  if (pendingForCard.length === 0) {
    return alert(`No tienes compras pendientes en Tarjeta ${cardName}.`);
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
    closeCutPaymentModal();
  });
}

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

function render() {
  inventoryList.innerHTML = '';
  
  const filterMonth = monthFilterSelect.value;
  const query = searchInput.value.toLowerCase().trim();

  // 1. Filtrado por Pestaña
  let filteredProducts = products.filter(prod => {
    if (currentView === 'stock') {
      if (prod.status !== 'Disponible') return false;
      if (currentSubFilter === 'TRANSIT' && prod.arrivalDate) return false;
      if (currentSubFilter === 'WAREHOUSE' && !prod.arrivalDate) return false;
    } else if (currentView === 'history') {
      if (prod.status !== 'Vendido' && prod.status !== 'Devuelto') return false;
      if (currentSubFilter !== 'ALL' && prod.status !== currentSubFilter) return false;
    } else if (currentView === 'debts') {
      // Vista de Deudas: solo compras con tarjeta y pendientes de pago
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

  // 2. Ordenamiento
  if (currentSortColumn) {
    filteredProducts.sort((a, b) => {
      let valA, valB;

      if (currentSortColumn === 'cost' || currentSortColumn === 'targetPrice') {
        valA = parseFloat(a[currentSortColumn]) || 0;
        valB = parseFloat(b[currentSortColumn]) || 0;
      } else if (currentSortColumn === 'profit') {
        const costA = parseFloat(a.cost) || 0;
        const targetA = parseFloat(a.targetPrice) || 0;
        const actualA = a.actualPrice ? parseFloat(a.actualPrice) : targetA;
        valA = a.status === 'Vendido' ? (actualA - costA) : (a.status === 'Devuelto' ? 0 : targetA - costA);

        const costB = parseFloat(b.cost) || 0;
        const targetB = parseFloat(b.targetPrice) || 0;
        const actualB = b.actualPrice ? parseFloat(b.actualPrice) : targetB;
        valB = b.status === 'Vendido' ? (actualB - costB) : (b.status === 'Devuelto' ? 0 : targetB - costB);
      } else if (currentSortColumn === 'debtStatus') {
        valA = a.status === 'Vendido' ? 1 : 0;
        valB = b.status === 'Vendido' ? 1 : 0;
      } else if (currentSortColumn === 'daysInStock') {
        const startA = a.arrivalDate || a.buyDate;
        valA = calculateDays(startA, a.sellDate);
        const startB = b.arrivalDate || b.buyDate;
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
        // En deudas: las compras más antiguas primero para pagar a tiempo
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

  if (filteredProducts.length === 0) {
    let emptyMsg = '';
    if (currentView === 'stock') emptyMsg = 'No hay productos en stock o en camino en este momento.';
    else if (currentView === 'history') emptyMsg = 'No hay productos en el historial para este filtro.';
    else emptyMsg = '🎉 ¡Felicitaciones! No tienes deudas pendientes en tarjetas.';

    const colSpan = currentView === 'debts' ? 8 : 13;
    inventoryList.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; padding: 25px; color: #9ca3af;">${emptyMsg}</td></tr>`;
  }
}

// Renderizado de Filas para Deudas
function renderDebtRows(productsList) {
  productsList.forEach(prod => {
    const cost = parseFloat(prod.cost) || 0;
    const paymentBadge = formatPaymentBadge(prod.paymentMethod);

    // Semáforo de cobertura: ¿Ya se cobró o sigue financiado en stock?
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
    if (selectedProductIds.has(prod.id)) row.className = 'row-selected';
    row.onclick = (e) => toggleProductSelection(prod.id, e);

    row.innerHTML = `
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

// Renderizado de Filas para Stock e Historial
function renderStandardRows(productsList) {
  productsList.forEach((prod) => {
    const cost = parseFloat(prod.cost) || 0;
    const targetPrice = parseFloat(prod.targetPrice) || 0;
    const actualPrice = prod.actualPrice ? parseFloat(prod.actualPrice) : targetPrice;

    let profit = 0;
    let profitClass = '';
    let profitLabel = '';
    let roiHtml = '';

    if (prod.status === 'Vendido') {
      const netGain = (actualPrice - cost);
      profit = netGain;
      const roi = cost > 0 ? ((netGain / cost) * 100).toFixed(1) : 0;
      profitClass = profit >= 0 ? 'text-green' : 'text-red';
      profitLabel = `${profit >= 0 ? '+' : ''}${formatCurrency(profit)} Real`;
      roiHtml = `<span class="roi-badge ${profitClass}">${roi >= 0 ? '+' : ''}${roi}% ROI</span>`;
    } else if (prod.status === 'Devuelto') {
      profit = 0;
      profitClass = 'text-gray';
      profitLabel = `$0 (Devuelto)`;
      roiHtml = `<span class="roi-badge text-gray">0.0% ROI</span>`;
    } else {
      const projGain = (targetPrice - cost);
      profit = projGain;
      const roi = cost > 0 ? ((projGain / cost) * 100).toFixed(1) : 0;
      profitClass = profit >= 0 ? 'text-est' : 'text-red';
      profitLabel = `${profit >= 0 ? '+' : ''}${formatCurrency(profit)} Est.`;
      roiHtml = `<span class="roi-badge ${profitClass}">${roi >= 0 ? '+' : ''}${roi}% ROI</span>`;
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

    const linkHtml = prod.productUrl 
      ? `<a href="${escapeHtml(prod.productUrl)}" target="_blank" class="link-btn">🔗 Ver</a>` 
      : `<span class="link-btn disabled">Sin link</span>`;

    const row = document.createElement('tr');
    
    let rowClasses = [];
    if (prod.status === 'Vendido') rowClasses.push('row-sold');
    if (prod.status === 'Devuelto') rowClasses.push('row-returned');
    if (selectedProductIds.has(prod.id)) rowClasses.push('row-selected');
    if (rowClasses.length > 0) row.className = rowClasses.join(' ');

    row.onclick = (e) => toggleProductSelection(prod.id, e);

    row.innerHTML = `
      <td><strong>${escapeHtml(prod.name)}</strong></td>
      <td>${paymentBadge}</td>
      <td>${cardPaidBadge}</td>
      <td>${escapeHtml(prod.platform)}</td>
      <td>${formatCurrency(cost)}</td>
      <td>${formatCurrency(prod.status === 'Vendido' ? actualPrice : targetPrice)}</td>
      <td>
        <span class="${profitClass}">${profitLabel}</span>
        ${roiHtml}
      </td>
      <td>${prod.buyDate || '-'}</td>
      <td>${timeLabel}</td>
      <td>${returnBadge}</td>
      <td>${linkHtml}</td>
      <td>
        <select class="select-status" onchange="handleStatusChange('${prod.id}', this.value, ${targetPrice})">
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

// Renderizado de Tarjetas según Pestaña Activa
function renderMetricsCards(sourceList) {
  const grid = document.getElementById('metrics-grid');

  if (currentView === 'stock') {
    let stockCapital = 0;
    let projectedRevenue = 0;
    let projectedProfit = 0;
    let inTransit = 0;
    let inWarehouse = 0;

    sourceList.forEach(prod => {
      const cost = parseFloat(prod.cost) || 0;
      const target = parseFloat(prod.targetPrice) || 0;

      stockCapital += cost;
      projectedRevenue += target;
      projectedProfit += (target - cost);

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
      const cost = parseFloat(prod.cost) || 0;
      const actual = prod.actualPrice ? parseFloat(prod.actualPrice) : (parseFloat(prod.targetPrice) || 0);

      if (prod.status === 'Vendido') {
        capitalRecovered += actual;
        realizedProfit += (actual - cost);
        totalCostSold += cost;
        soldCount++;

        const start = prod.arrivalDate || prod.buyDate;
        totalDaysSold += calculateDays(start, prod.sellDate);
      } else if (prod.status === 'Devuelto') {
        capitalRecovered += cost;
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
  } else {
    // Métricas exclusivas para Deudas y Tarjetas
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

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const status = document.getElementById('status').value;
  const paymentMethod = document.getElementById('paymentMethod').value;
  const actualSoldPrice = document.getElementById('actualSoldPrice').value;

  const newProduct = {
    name: document.getElementById('name').value,
    paymentMethod: paymentMethod,
    cardPaid: paymentMethod === 'Efectivo' ? 'N/A' : document.getElementById('cardPaid').value,
    platform: document.getElementById('platform').value,
    cost: document.getElementById('cost').value,
    targetPrice: document.getElementById('targetPrice').value,
    actualPrice: status === 'Vendido' && actualSoldPrice ? actualSoldPrice : null,
    productUrl: document.getElementById('productUrl').value,
    buyDate: document.getElementById('buyDate').value,
    arrivalDate: null,
    sellDate: status === 'Vendido' ? new Date().toISOString().split('T')[0] : null,
    status: status
  };

  db.collection("productos").add(newProduct).then(() => {
    form.reset();
    document.getElementById('paymentMethod').value = 'Nu';
    document.getElementById('cardPaid').value = 'No';
    handlePaymentMethodChange('Nu');
    toggleSoldPriceInput('Disponible');
    buyDateInput.value = new Date().toISOString().split('T')[0];
    toggleForm();
  });
});

function duplicateProduct(docId) {
  const original = products.find(p => p.id === docId);
  if (!original) return;

  const duplicated = {
    name: original.name,
    paymentMethod: original.paymentMethod || 'Nu',
    cardPaid: original.cardPaid || 'No',
    platform: original.platform,
    cost: original.cost,
    targetPrice: original.targetPrice,
    productUrl: original.productUrl || '',
    buyDate: original.buyDate,
    arrivalDate: original.arrivalDate || null,
    sellDate: null,
    actualPrice: null,
    status: 'Disponible'
  };

  db.collection("productos").add(duplicated);
}

function openEditModal(docId) {
  const product = products.find(p => p.id === docId);
  if (!product) return;

  pendingEditDocId = docId;
  document.getElementById('edit-name').value = product.name || '';
  const payMethod = product.paymentMethod || 'Nu';
  document.getElementById('edit-paymentMethod').value = payMethod;
  handleEditPaymentMethodChange(payMethod);
  document.getElementById('edit-cardPaid').value = product.cardPaid || 'Si';

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
    name: document.getElementById('edit-name').value,
    paymentMethod: payMethod,
    cardPaid: payMethod === 'Efectivo' ? 'N/A' : document.getElementById('edit-cardPaid').value,
    platform: document.getElementById('edit-platform').value,
    cost: document.getElementById('edit-cost').value,
    targetPrice: document.getElementById('edit-targetPrice').value,
    productUrl: document.getElementById('edit-productUrl').value,
    buyDate: document.getElementById('edit-buyDate').value,
    arrivalDate: document.getElementById('edit-arrivalDate').value || null
  };

  db.collection("productos").doc(pendingEditDocId).update(updatedProduct).then(() => {
    closeEditModal();
  });
}

function handleStatusChange(docId, newStatus, targetPrice) {
  if (newStatus === 'Vendido') {
    pendingSaleDocId = docId;
    document.getElementById('modalPriceInput').value = targetPrice;
    document.getElementById('saleModal').style.display = 'flex';
  } else if (newStatus === 'Devuelto') {
    db.collection("productos").doc(docId).update({
      status: 'Devuelto',
      actualPrice: null,
      sellDate: new Date().toISOString().split('T')[0]
    });
  } else {
    db.collection("productos").doc(docId).update({
      status: 'Disponible',
      actualPrice: null,
      sellDate: null
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
      closeSaleModal();
    });
  }
}

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
      closeDeleteModal();
    });
  }
}

function exportToExcel() {
  if (products.length === 0) return alert("No hay productos para exportar.");

  let csvContent = "\uFEFFProducto;Metodo Pago;Tarjeta Pagada;Plataforma;Costo Compra;Precio Venta Obj;Precio Real Venta;Ganancia;ROI (%);Fecha Compra;Fecha Llegada;Fecha Venta;Dias en Stock;Estado;Link\n";

  products.forEach(p => {
    const cost = parseFloat(p.cost) || 0;
    const target = parseFloat(p.targetPrice) || 0;
    const actual = p.actualPrice ? parseFloat(p.actualPrice) : target;
    const profit = p.status === 'Vendido' ? (actual - cost) : (p.status === 'Devuelto' ? 0 : target - cost);
    const roi = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '0';
    const days = calculateDays(p.buyDate, p.sellDate);

    csvContent += `"${p.name}";"${p.paymentMethod || '-'}";"${p.cardPaid || 'Si'}";"${p.platform}";${cost};${target};${p.actualPrice || '-'};${profit};${roi}%;"${p.buyDate}";"${p.arrivalDate || '-'}";"${p.sellDate || '-'}";${days};"${p.status}";"${p.productUrl || '-'}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Inventario_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Inicializar encabezado de tabla al cargar
renderTableHeader();