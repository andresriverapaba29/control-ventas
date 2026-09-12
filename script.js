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

// Estados de Filtro, Selección y Ordenamiento
let currentStatusFilter = 'ALL';
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
  updateChipCounters();
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

function toggleForm() {
  const isHidden = form.style.display === 'none';
  form.style.display = isHidden ? 'block' : 'none';
  document.getElementById('toggle-icon').innerText = isHidden ? '▲' : '▼';
}

function toggleSoldPriceInput(status) {
  document.getElementById('soldPriceGroup').style.display = status === 'Vendido' ? 'block' : 'none';
}

// Filtro de Chips
function setStatusFilter(status) {
  currentStatusFilter = status;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  const activeBtn = document.getElementById(`chip-${status}`);
  if (activeBtn) activeBtn.classList.add('active');
  render();
}

function updateChipCounters() {
  const total = products.length;
  const disp = products.filter(p => p.status === 'Disponible').length;
  const sold = products.filter(p => p.status === 'Vendido').length;
  const ret = products.filter(p => p.status === 'Devuelto').length;

  document.getElementById('count-chip-all').innerText = `(${total})`;
  document.getElementById('count-chip-disp').innerText = `(${disp})`;
  document.getElementById('count-chip-sold').innerText = `(${sold})`;
  document.getElementById('count-chip-ret').innerText = `(${ret})`;
}

function resetFilters() {
  monthFilterSelect.value = 'ALL';
  searchInput.value = '';
  setStatusFilter('ALL');
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

// Lógica de Selección Múltiple
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

// Acciones en Lote (Bulk Actions)
function bulkMarkAsSold() {
  if (selectedProductIds.size === 0) return;
  
  const today = new Date().toISOString().split('T')[0];
  const batch = db.batch();

  selectedProductIds.forEach(id => {
    const prod = products.find(p => p.id === id);
    if (prod && prod.status !== 'Vendido') {
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

// Lógica de Ordenamiento por Encabezados
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
  const headers = ['name', 'paymentMethod', 'platform', 'cost', 'targetPrice', 'profit', 'buyDate', 'daysInStock', 'daysRemaining', 'status'];
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

  let filteredProducts = products.filter(prod => {
    if (filterMonth !== 'ALL' && (!prod.buyDate || !prod.buyDate.startsWith(filterMonth))) return false;
    if (currentStatusFilter !== 'ALL' && prod.status !== currentStatusFilter) return false;
    if (query) {
      const matchName = prod.name && prod.name.toLowerCase().includes(query);
      const matchPlatform = prod.platform && prod.platform.toLowerCase().includes(query);
      const matchPay = prod.paymentMethod && prod.paymentMethod.toLowerCase().includes(query);
      if (!matchName && !matchPlatform && !matchPay) return false;
    }
    return true;
  });

  // Ordenamiento de tabla
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
      } else if (currentSortColumn === 'daysInStock') {
        const startA = a.arrivalDate || a.buyDate;
        valA = calculateDays(startA, a.sellDate);
        const startB = b.arrivalDate || b.buyDate;
        valB = calculateDays(startB, b.sellDate);
      } else if (currentSortColumn === 'daysRemaining') {
        valA = getReturnRemainingDays(a.arrivalDate);
        valB = getReturnRemainingDays(b.arrivalDate);
      } else if (currentSortColumn === 'status') {
        valA = (a.status || '').toLowerCase();
        valB = (b.status || '').toLowerCase();
      } else if (currentSortColumn === 'paymentMethod') {
        valA = (a.paymentMethod || '').toLowerCase();
        valB = (b.paymentMethod || '').toLowerCase();
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
      if (a.status !== b.status) {
        if (a.status === 'Disponible') return -1;
        if (b.status === 'Disponible') return 1;
        if (a.status === 'Vendido') return -1;
        return 1;
      }
      if (a.status === 'Disponible') {
        return getReturnRemainingDays(a.arrivalDate) - getReturnRemainingDays(b.arrivalDate);
      }
      return 0;
    });
  }

  // Manejo de Métricas: ¿Global o Selección?
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

  let totalInvested = 0;
  let capitalRecovered = 0;
  let realizedProfit = 0;
  let capitalAtRisk = 0;
  let projectedProfit = 0;
  let unitsInStock = 0;
  let unitsSold = 0;

  metricsSource.forEach(prod => {
    const cost = parseFloat(prod.cost) || 0;
    const targetPrice = parseFloat(prod.targetPrice) || 0;
    const actualPrice = prod.actualPrice ? parseFloat(prod.actualPrice) : targetPrice;

    totalInvested += cost;

    if (prod.status === 'Vendido') {
      capitalRecovered += actualPrice;
      realizedProfit += (actualPrice - cost);
      unitsSold++;
    } else if (prod.status === 'Devuelto') {
      capitalRecovered += cost;
    } else {
      capitalAtRisk += cost;
      projectedProfit += (targetPrice - cost);
      unitsInStock++;
    }
  });

  // Renderizar filas de la tabla
  filteredProducts.forEach((prod) => {
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

  if (filteredProducts.length === 0) {
    inventoryList.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 20px; color: #9ca3af;">No se encontraron productos registrados.</td></tr>`;
  }

  const subElem = document.getElementById('realized-profit-sub');
  subElem.innerText = `${realizedProfit >= 0 ? '+' : ''} ${formatCurrency(realizedProfit)} de Ganancia Real`;
  subElem.className = `sub-text ${realizedProfit >= 0 ? 'text-green' : 'text-red'}`;

  document.getElementById('total-invested').innerText = formatCurrency(totalInvested);
  document.getElementById('capital-recovered').innerText = formatCurrency(capitalRecovered);
  document.getElementById('capital-at-risk').innerText = formatCurrency(capitalAtRisk);
  
  document.getElementById('units-in-stock').innerText = `${unitsInStock} producto${unitsInStock !== 1 ? 's' : ''} en stock`;
  document.getElementById('units-sold').innerText = `${unitsSold} producto${unitsSold !== 1 ? 's' : ''} vendido${unitsSold !== 1 ? 's' : ''}`;
  
  document.getElementById('projected-profit').innerText = formatCurrency(projectedProfit);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const status = document.getElementById('status').value;
  const actualSoldPrice = document.getElementById('actualSoldPrice').value;

  const newProduct = {
    name: document.getElementById('name').value,
    paymentMethod: document.getElementById('paymentMethod').value,
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
  document.getElementById('edit-paymentMethod').value = product.paymentMethod || 'Nu';
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

  const updatedProduct = {
    name: document.getElementById('edit-name').value,
    paymentMethod: document.getElementById('edit-paymentMethod').value,
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

  let csvContent = "\uFEFFProducto;Metodo Pago;Plataforma;Costo Compra;Precio Venta Obj;Precio Real Venta;Ganancia;ROI (%);Fecha Compra;Fecha Llegada;Fecha Venta;Dias en Stock;Estado;Link\n";

  products.forEach(p => {
    const cost = parseFloat(p.cost) || 0;
    const target = parseFloat(p.targetPrice) || 0;
    const actual = p.actualPrice ? parseFloat(p.actualPrice) : target;
    const profit = p.status === 'Vendido' ? (actual - cost) : (p.status === 'Devuelto' ? 0 : target - cost);
    const roi = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '0';
    const days = calculateDays(p.buyDate, p.sellDate);

    csvContent += `"${p.name}";"${p.paymentMethod || '-'}";"${p.platform}";${cost};${target};${p.actualPrice || '-'};${profit};${roi}%;"${p.buyDate}";"${p.arrivalDate || '-'}";"${p.sellDate || '-'}";${days};"${p.status}";"${p.productUrl || '-'}"\n`;
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