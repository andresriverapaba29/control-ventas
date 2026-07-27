// Credenciales de tu Proyecto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCE6i1aLAzB2n_AZaNlohwH7ikr_8Z7dhM",
  authDomain: "control-ventas-app-cd82b.firebaseapp.com",
  projectId: "control-ventas-app-cd82b",
  storageBucket: "control-ventas-app-cd82b.firebasestorage.app",
  messagingSenderId: "93145997049",
  appId: "1:93145997049:web:df17391f11f971120c0c28"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

let products = [];
let pendingSaleDocId = null;
let pendingDeleteDocId = null;
let pendingEditDocId = null;

const form = document.getElementById('product-form');
const inventoryList = document.getElementById('inventory-list');
const monthFilterSelect = document.getElementById('month-filter');
const statusFilterSelect = document.getElementById('status-filter');
const buyDateInput = document.getElementById('buyDate');

buyDateInput.value = new Date().toISOString().split('T')[0];

// Escuchar cambios en tiempo real desde Firestore
db.collection("productos").onSnapshot((snapshot) => {
  products = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  updateMonthOptions();
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
  return Math.floor(Math.abs(end - start) / (1000 * 60 * 60 * 24));
}

function toggleSoldPriceInput(status) {
  document.getElementById('soldPriceGroup').style.display = status === 'Vendido' ? 'block' : 'none';
}

function resetFilters() {
  monthFilterSelect.value = 'ALL';
  statusFilterSelect.value = 'ALL';
  render();
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

function render() {
  inventoryList.innerHTML = '';
  
  const filterMonth = monthFilterSelect.value;
  const filterStatus = statusFilterSelect.value;

  let totalInvested = 0;
  let capitalRecovered = 0;
  let realizedProfit = 0;
  let capitalAtRisk = 0;
  let projectedProfit = 0;

  products.forEach((prod) => {
    if (filterMonth !== 'ALL' && (!prod.buyDate || !prod.buyDate.startsWith(filterMonth))) return;
    if (filterStatus !== 'ALL' && prod.status !== filterStatus) return;

    const cost = parseFloat(prod.cost) || 0;
    const targetPrice = parseFloat(prod.targetPrice) || 0;
    const actualPrice = prod.actualPrice ? parseFloat(prod.actualPrice) : targetPrice;

    totalInvested += cost;

    if (prod.status === 'Vendido') {
      capitalRecovered += actualPrice;
      realizedProfit += (actualPrice - cost);
    } else {
      capitalAtRisk += cost;
      projectedProfit += (targetPrice - cost);
    }

    const profit = prod.status === 'Vendido' ? (actualPrice - cost) : (targetPrice - cost);
    const daysInStock = calculateDays(prod.buyDate, prod.sellDate);
    const timeLabel = prod.status === 'Vendido' 
      ? `<span class="time-badge sold">Vendido en ${daysInStock} d</span>` 
      : `<span class="time-badge">${daysInStock} d en stock</span>`;

    const linkHtml = prod.productUrl 
      ? `<a href="${escapeHtml(prod.productUrl)}" target="_blank" class="link-btn">🔗 Ver</a>` 
      : `<span class="link-btn disabled">Sin link</span>`;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${escapeHtml(prod.name)}</strong></td>
      <td>${escapeHtml(prod.platform)}</td>
      <td>${formatCurrency(cost)}</td>
      <td>${formatCurrency(prod.status === 'Vendido' ? actualPrice : targetPrice)}</td>
      <td class="text-green">+${formatCurrency(profit)}</td>
      <td>${prod.buyDate || '-'}</td>
      <td>${timeLabel}</td>
      <td>${linkHtml}</td>
      <td>
        <select class="select-status" onchange="handleStatusChange('${prod.id}', this.value, ${targetPrice})">
          <option value="Disponible" ${prod.status === 'Disponible' ? 'selected' : ''}>Disponible</option>
          <option value="Vendido" ${prod.status === 'Vendido' ? 'selected' : ''}>Vendido</option>
        </select>
      </td>
      <td>
        <div class="action-buttons">
          <button class="btn-edit" onclick="openEditModal('${prod.id}')">Editar</button>
          <button class="btn-delete" onclick="openDeleteModal('${prod.id}')">Eliminar</button>
        </div>
      </td>
    `;
    inventoryList.appendChild(row);
  });

  document.getElementById('total-invested').innerText = formatCurrency(totalInvested);
  document.getElementById('capital-recovered').innerText = formatCurrency(capitalRecovered);
  document.getElementById('realized-profit-sub').innerText = `+ ${formatCurrency(realizedProfit)} de Ganancia Real`;
  document.getElementById('capital-at-risk').innerText = formatCurrency(capitalAtRisk);
  document.getElementById('projected-profit').innerText = formatCurrency(projectedProfit);
}

// Formulario Agregar
form.addEventListener('submit', (e) => {
  e.preventDefault();

  const status = document.getElementById('status').value;
  const actualSoldPrice = document.getElementById('actualSoldPrice').value;

  const newProduct = {
    name: document.getElementById('name').value,
    platform: document.getElementById('platform').value,
    cost: document.getElementById('cost').value,
    targetPrice: document.getElementById('targetPrice').value,
    actualPrice: status === 'Vendido' && actualSoldPrice ? actualSoldPrice : null,
    productUrl: document.getElementById('productUrl').value,
    buyDate: document.getElementById('buyDate').value,
    sellDate: status === 'Vendido' ? new Date().toISOString().split('T')[0] : null,
    status: status
  };

  db.collection("productos").add(newProduct).then(() => {
    form.reset();
    toggleSoldPriceInput('Disponible');
    buyDateInput.value = new Date().toISOString().split('T')[0];
  });
});

// Modal y Lógica de Edición
function openEditModal(docId) {
  const product = products.find(p => p.id === docId);
  if (!product) return;

  pendingEditDocId = docId;
  document.getElementById('edit-name').value = product.name || '';
  document.getElementById('edit-platform').value = product.platform || '';
  document.getElementById('edit-cost').value = product.cost || '';
  document.getElementById('edit-targetPrice').value = product.targetPrice || '';
  document.getElementById('edit-productUrl').value = product.productUrl || '';
  document.getElementById('edit-buyDate').value = product.buyDate || '';

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
    platform: document.getElementById('edit-platform').value,
    cost: document.getElementById('edit-cost').value,
    targetPrice: document.getElementById('edit-targetPrice').value,
    productUrl: document.getElementById('edit-productUrl').value,
    buyDate: document.getElementById('edit-buyDate').value
  };

  db.collection("productos").doc(pendingEditDocId).update(updatedProduct).then(() => {
    closeEditModal();
  });
}

// Modales y Acciones
function handleStatusChange(docId, newStatus, targetPrice) {
  if (newStatus === 'Vendido') {
    pendingSaleDocId = docId;
    document.getElementById('modalPriceInput').value = targetPrice;
    document.getElementById('saleModal').style.display = 'flex';
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
      closeDeleteModal();
    });
  }
}

function exportToExcel() {
  if (products.length === 0) return alert("No hay productos para exportar.");

  let csvContent = "\uFEFFProducto;Plataforma;Costo Compra;Precio Venta Obj;Precio Real Venta;Ganancia;Fecha Compra;Fecha Venta;Dias en Stock;Estado;Link\n";

  products.forEach(p => {
    const cost = parseFloat(p.cost) || 0;
    const target = parseFloat(p.targetPrice) || 0;
    const actual = p.actualPrice ? parseFloat(p.actualPrice) : target;
    const profit = p.status === 'Vendido' ? (actual - cost) : (target - cost);
    const days = calculateDays(p.buyDate, p.sellDate);

    csvContent += `"${p.name}";"${p.platform}";${cost};${target};${p.actualPrice || '-'};${profit};"${p.buyDate}";"${p.sellDate || '-'}";${days};"${p.status}";"${p.productUrl || '-'}"\n`;
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