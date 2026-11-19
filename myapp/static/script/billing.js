const API_BASE = '/api';
let currentUser = null;
let confirmCallback = null;

function getToken() {
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

async function api(endpoint, options = {}) {
  const token = getToken();
  const headers = { 
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Token ${token}` } : {})
  };
  return fetch(endpoint, { ...options, headers: { ...headers, ...options.headers } });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<div class="toast-icon">${icon}</div><div>${message}</div>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toast(message, type) {
  showToast(message, type);
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function openConfirm(title, message, callback) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = callback;
  document.getElementById('confirm-dialog').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirm-dialog').classList.remove('open');
  confirmCallback = null;
}

function confirmAction() {
  if (confirmCallback) confirmCallback();
  closeConfirm();
}

function logout() {
  billingChain.then(() => {
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
    window.location.href = '/';
  });
}

async function loadCurrentUser() {
  try {
    const res = await api('/api/current-user/');
    if (!res.ok) { logout(); return; }
    currentUser = await res.json();
    document.getElementById('current-username').textContent = currentUser.username || 'Admin';
    const avatar = document.getElementById('user-avatar');
    avatar.textContent = (currentUser.username || 'A')[0].toUpperCase();
  } catch (e) {
    console.error('Failed to load current user:', e);
  }
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.getAttribute('data-page');
    if (!page) return;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`${page}-page`);
    if (pageEl) pageEl.classList.add('active');

    const runInit = () => {
      if (page === 'billing') initBilling();
      else if (page === 'customers') initCustomers();
      else if (page === 'customer-bill-template') initCustomerBillTemplate();
      else if (page === 'items') initItems();
      else if (page === 'trb-bill-entry') initTrbEntry();
      else if (page === 'trb-bill-list') initTrbList();
      else if (page === 'trb-bill-due') initTrbDue();
      else if (page === 'trb-bill-history') initTrbHistory();
      else if (page === 'trb-dashboard') initTrbDashboard();
      else if (page === 'compose-message') initComposeMessage();
      else if (page === 'bill-send-pending') initBillSendPending();
      else if (page === 'amount-wise-client') initAmountWise();
    };
    if (BILLING_STORE_PAGES.indexOf(page) !== -1) billingEnsure(15000).then(runInit);
    else runInit();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open, .confirm-dialog.open').forEach(m => m.classList.remove('open'));
});

let allBills = [];
let billFormReady = false;
let billInstituteNames = [];
let billSelectedFiles = [];
let filteredBills = [];
let currentBillsPage = 1;
let billsPerPage = 25;

function billEsc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function defaultBillTitle() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `Bill - ${prev.toLocaleString('en-US', { month: 'long' })} ${prev.getFullYear()}`;
}

function resetBillForm() {
  const title = defaultBillTitle();
  document.getElementById('bill-institute-search').value = '';
  renderBillInstituteOptions();
  document.getElementById('bill-institute').value = '';
  document.getElementById('bill-title').value = title;
  document.getElementById('bill-title').placeholder = title;
  document.getElementById('bill-description').value = title;
  document.getElementById('bill-description').placeholder = title;
  document.getElementById('bill-file').value = '';
  billSelectedFiles = [];
  renderBillSelectedFiles();
}

function renderBillSelectedFiles() {
  const box = document.getElementById('bill-file-list');
  if (!box) return;
  if (!billSelectedFiles.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = billSelectedFiles.map((f, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="overflow-wrap:anywhere;">${billEsc(f.name)}</span>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeBillSelectedFile(${i})">Remove</button>
    </div>`).join('');
}

function removeBillSelectedFile(index) {
  billSelectedFiles.splice(index, 1);
  renderBillSelectedFiles();
}

function onBillFilesPicked() {
  const input = document.getElementById('bill-file');
  Array.from(input.files).forEach(file => {
    const exists = billSelectedFiles.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
    if (!exists) billSelectedFiles.push(file);
  });
  input.value = '';
  renderBillSelectedFiles();
}

async function initBilling() {
  if (!billFormReady) {
    resetBillForm();
    document.getElementById('bill-file').addEventListener('change', onBillFilesPicked);
    billFormReady = true;
  }
  await Promise.all([loadBillInstitutes(), loadBills()]);
}

function renderBillInstituteOptions() {
  const select = document.getElementById('bill-institute');
  const search = document.getElementById('bill-institute-search');
  const words = (search ? search.value : '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const current = select.value;
  const list = words.length
    ? billInstituteNames.filter(n => words.every(w => n.toLowerCase().includes(w)))
    : billInstituteNames;
  let html = '<option value="">Select Institute</option>';
  if (words.length) html = list.length ? '' : '<option value="">No institute found</option>';
  html += list.map(n => `<option value="${billEsc(n)}">${billEsc(n)}</option>`).join('');
  select.innerHTML = html;
  if (words.length && list.length) select.value = list.includes(current) ? current : list[0];
  else if (current && list.includes(current)) select.value = current;
}

async function loadBillInstitutes() {
  try {
    const res = await api('/api/centers/');
    if (!res.ok) return;
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data.results || []);
    const seen = {};
    const names = [];
    arr.forEach(c => {
      const n = (c.institute_name || '').trim();
      if (n && !seen[n]) {
        seen[n] = true;
        names.push(n);
      }
    });
    names.sort((a, b) => a.localeCompare(b));
    billInstituteNames = names;
    renderBillInstituteOptions();
  } catch (e) {
    console.error('Failed to load institutes:', e);
  }
}

async function loadBills() {
  const tbody = document.getElementById('bills-table-body');
  try {
    const res = await api('/api/institute-bills-admin/');
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    allBills = data.results || [];
    applyBillFilter();
    renderBillsWithPagination();
    billViewsReady = true;
    renderAllBillViews();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-title">Failed to load bills</div></div></td></tr>';
  }
}

function applyBillFilter() {
  const input = document.getElementById('bill-search-input');
  const query = input ? input.value.trim().toLowerCase() : '';

  filteredBills = allBills.filter(b => {
    return !query ||
           (b.institute_name || '').toLowerCase().includes(query) ||
           (b.title || '').toLowerCase().includes(query) ||
           (b.files || []).some(f => (f.name || '').toLowerCase().includes(query));
  });
}

function searchBills() {
  applyBillFilter();
  currentBillsPage = 1;
  renderBillsWithPagination();
}

function renderBillsWithPagination() {
  const totalBills = filteredBills.length;
  const totalPages = Math.ceil(totalBills / billsPerPage);
  if (currentBillsPage > totalPages) currentBillsPage = Math.max(1, totalPages);
  const startIndex = (currentBillsPage - 1) * billsPerPage;
  const endIndex = Math.min(startIndex + billsPerPage, totalBills);
  const billsToShow = filteredBills.slice(startIndex, endIndex);

  renderBills(billsToShow);

  if (totalBills > 10) {
    document.getElementById('bills-pagination-container').style.display = 'block';
    document.getElementById('bills-pagination-info').textContent = 
      `Showing ${startIndex + 1}-${endIndex} of ${totalBills} bills`;
    renderBillsPaginationButtons(totalPages);
  } else {
    document.getElementById('bills-pagination-container').style.display = 'none';
  }
}

function renderBillsPaginationButtons(totalPages) {
  const container = document.getElementById('bills-pagination-buttons');
  let html = '';

  html += `<button class="pagination-btn" onclick="goToBillsPage(${currentBillsPage - 1})" ${currentBillsPage === 1 ? 'disabled' : ''}>‹</button>`;

  const maxButtons = 7;
  let startPage = Math.max(1, currentBillsPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToBillsPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentBillsPage ? 'active' : ''}" onclick="goToBillsPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
    html += `<button class="pagination-btn" onclick="goToBillsPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" onclick="goToBillsPage(${currentBillsPage + 1})" ${currentBillsPage === totalPages ? 'disabled' : ''}>›</button>`;

  container.innerHTML = html;
}

function goToBillsPage(page) {
  const totalPages = Math.ceil(filteredBills.length / billsPerPage);
  if (page < 1 || page > totalPages) return;
  currentBillsPage = page;
  renderBillsWithPagination();
}

function changeBillsPerPage() {
  billsPerPage = parseInt(document.getElementById('bills-items-per-page').value);
  currentBillsPage = 1;
  renderBillsWithPagination();
}

function renderBills(bills) {
  const tbody = document.getElementById('bills-table-body');
  if (!bills.length) {
    const noBills = !allBills.length;
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-title">${noBills ? 'No bills sent yet' : 'No bills found'}</div><div class="empty-text">${noBills ? 'Bills you send to an institute will appear here.' : 'Try a different search.'}</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = bills.map(b => {
    const fileCell = (b.files || []).length
      ? b.files.map(f => `<div><a href="#" onclick="downloadBillFile(${b.id}, ${f.id}); return false;" style="color:var(--accent);">${billEsc(f.name)}</a></div>`).join('')
      : '<span style="color:var(--text3);font-size:12px;">No file</span>';
    const statusBadge = b.is_active
      ? '<span class="badge badge-green">Active</span>'
      : '<span class="badge badge-gray">Off</span>';
    const toggleBtn = b.is_active
      ? `<button class="btn btn-warning btn-xs" onclick="turnOffBill(${b.id})">Turn Off</button>`
      : `<button class="btn btn-success btn-xs" onclick="setBillActive(${b.id}, true)">Turn On</button>`;
    const action = `<div style="display:flex;gap:6px;flex-wrap:wrap;">${toggleBtn}<button class="btn btn-danger btn-xs" onclick="deleteBill(${b.id})">Delete</button></div>`;
    return `<tr>
      <td><span style="font-weight:500;color:var(--text);">${billEsc(b.institute_name)}</span></td>
      <td>${billEsc(b.title)}</td>
      <td style="font-size:12px;color:var(--text3);">${billEsc(b.bill_date)}</td>
      <td>${fileCell}</td>
      <td>${statusBadge}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function sendBill() {
  const institute = document.getElementById('bill-institute').value;
  const title = document.getElementById('bill-title').value.trim();
  if (!institute) {
    toast('Please select an institute', 'error');
    return;
  }
  if (!title) {
    toast('Please enter the bill title', 'error');
    return;
  }
  const form = new FormData();
  form.append('institute_name', institute);
  form.append('title', title);
  form.append('description', document.getElementById('bill-description').value.trim());
  const files = billSelectedFiles.slice();
  files.forEach(file => form.append('bill_file', file));

  const btn = document.getElementById('bill-send-btn');
  btn.disabled = true;
  try {
    const token = getToken();
    const res = await fetch('/api/institute-bills-admin/', {
      method: 'POST',
      headers: token ? { 'Authorization': `Token ${token}` } : {},
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast(data.error || 'Failed to send bill', 'error');
      return;
    }
    toast(`Bill sent to ${institute}`, 'success');
    resetBillForm();
    await loadBills();
  } catch (e) {
    toast('Failed to send bill', 'error');
  } finally {
    btn.disabled = false;
  }
}

function turnOffBill(id) {
  const bill = allBills.find(b => b.id === id);
  const label = bill ? `"${bill.title}" for ${bill.institute_name}` : 'this bill';
  openConfirm('Turn Off Bill', `Turn off ${label}? It will stop showing at the top of the institute's study list.`, () => setBillActive(id, false));
}

function deleteBill(id) {
  const bill = allBills.find(b => b.id === id);
  const label = bill ? `"${bill.title}" for ${bill.institute_name}` : 'this bill';
  openConfirm('Delete Bill', `Delete ${label}? The bill and its attached files will be removed permanently.`, () => removeBill(id));
}

async function removeBill(id) {
  try {
    const res = await api('/api/institute-bills-admin/delete/', {
      method: 'POST',
      body: JSON.stringify({ bill_id: id })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast(data.error || 'Failed to delete bill', 'error');
      return;
    }
    toast('Bill deleted', 'success');
    await loadBills();
  } catch (e) {
    toast('Failed to delete bill', 'error');
  }
}

async function setBillActive(id, isActive) {
  try {
    const res = await api('/api/institute-bills-admin/toggle/', {
      method: 'POST',
      body: JSON.stringify({ bill_id: id, is_active: isActive })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      toast(data.error || 'Failed to update bill', 'error');
      return;
    }
    toast(isActive ? 'Bill turned on' : 'Bill turned off', 'success');
    await loadBills();
  } catch (e) {
    toast('Failed to update bill', 'error');
  }
}

async function downloadBillFile(id, fileId) {
  const bill = allBills.find(b => b.id === id);
  const entry = bill && (bill.files || []).find(f => f.id === fileId);
  const name = entry && entry.name;
  try {
    const res = await api(`/api/institute-bills/${id}/download/?file=${fileId}`);
    if (!res.ok) throw new Error('failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'bill';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    toast('Failed to download file', 'error');
  }
}

const billViews = {
  list: { p: 'bl', match: function () { return true; } },
  due: { p: 'bd', match: function (b) { return !!b.is_active; } },
  paid: { p: 'bp', match: function (b) { return !b.is_active; } }
}
let billPageNo = { list: 1, due: 1, paid: 1 };
let billPerPage = { list: 25, due: 25, paid: 25 };
let billFiltered = { list: [], due: [], paid: [] };
let billViewsReady = false;

function billEl(id) {
  return document.getElementById(id);
}

function billIsoDate(bill) {
  var d = String(bill.bill_date || '').split(' ')[0].split('-');
  return d.length === 3 ? d[2] + '-' + d[1] + '-' + d[0] : '';
}

function billBase(key) {
  return allBills.filter(billViews[key].match);
}

function billUniqueInstitutes(list) {
  var seen = {};
  var names = [];
  list.forEach(function (b) {
    var n = (b.institute_name || '').trim();
    if (n && !seen[n]) {
      seen[n] = true;
      names.push(n);
    }
  });
  names.sort(function (a, b) { return a.localeCompare(b); });
  return names;
}

function billFillInstitutes(key) {
  var select = billEl(billViews[key].p + '-institute');
  var current = select.value;
  var names = billUniqueInstitutes(billBase(key));
  var html = '<option value="">All Institutes</option>';
  html += names.map(function (n) {
    return '<option value="' + billEsc(n) + '">' + billEsc(n) + '</option>';
  }).join('');
  select.innerHTML = html;
  select.value = names.indexOf(current) !== -1 ? current : '';
}

function billApplyViewFilters(key) {
  var p = billViews[key].p;
  var words = billEl(p + '-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  var institute = billEl(p + '-institute').value;
  var statusEl = billEl(p + '-status');
  var status = statusEl ? statusEl.value : '';
  var from = billEl(p + '-from').value;
  var to = billEl(p + '-to').value;

  billFiltered[key] = billBase(key).filter(function (b) {
    if (institute && b.institute_name !== institute) return false;
    if (status === 'due' && !b.is_active) return false;
    if (status === 'paid' && b.is_active) return false;
    var day = billIsoDate(b);
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    if (words.length) {
      var hay = [b.institute_name, b.title].concat((b.files || []).map(function (f) { return f.name; }))
        .join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }
    return true;
  });
}

function renderBillStats() {
  var due = allBills.filter(function (b) { return b.is_active; });
  var paid = allBills.filter(function (b) { return !b.is_active; });
  billEl('bl-stat-total').textContent = allBills.length;
  billEl('bl-stat-due').textContent = due.length;
  billEl('bl-stat-paid').textContent = paid.length;
}

function billEmptyMessage(key) {
  if (!billViewsReady) return ['Loading bills...', ''];
  if (!allBills.length) return ['No bills sent yet', 'Bills you send to an institute will appear here.'];
  if (!billBase(key).length) {
    if (key === 'due') return ['No due bills', 'Every bill has been turned off.'];
    if (key === 'paid') return ['No paid bills', 'Bills you turn off will appear here.'];
  }
  return ['No bills found', 'Try a different search or filter.'];
}

function billRowHtml(b) {
  var due = !!b.is_active;
  var files = (b.files || []).length
    ? b.files.map(function (f) {
        return '<div><a href="#" onclick="downloadBillFile(' + b.id + ', ' + f.id + '); return false;" style="color:var(--accent);">' + billEsc(f.name) + '</a></div>';
      }).join('')
    : '<span style="color:var(--text3);font-size:12px;">No file</span>';
  var badge = due
    ? '<span class="badge badge-yellow">Due</span>'
    : '<span class="badge badge-green">Paid</span>';
  var toggle = due
    ? '<button class="btn btn-warning btn-xs" onclick="turnOffBill(' + b.id + ')">Turn Off</button>'
    : '<button class="btn btn-success btn-xs" onclick="setBillActive(' + b.id + ', true)">Turn On</button>';
  var action = '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + toggle +
    '<button class="btn btn-danger btn-xs" onclick="deleteBill(' + b.id + ')">Delete</button></div>';
  return '<tr>' +
    '<td><span style="font-weight:500;color:var(--text);">' + billEsc(b.institute_name) + '</span></td>' +
    '<td>' + billEsc(b.title) + '</td>' +
    '<td style="font-size:12px;color:var(--text3);">' + billEsc(b.bill_date) + '</td>' +
    '<td>' + files + '</td>' +
    '<td>' + badge + '</td>' +
    '<td>' + action + '</td>' +
    '</tr>';
}

function renderBillViewPagination(key, total, start, end) {
  var p = billViews[key].p;
  var box = billEl(p + '-pagination');
  if (total <= 10) {
    box.style.display = 'none';
    return;
  }
  var totalPages = Math.ceil(total / billPerPage[key]);
  var current = billPageNo[key];
  box.style.display = 'block';
  billEl(p + '-info').textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + total + ' bills';

  var html = '<button class="pagination-btn" onclick="billViewGo(\'' + key + '\', ' + (current - 1) + ')" ' + (current === 1 ? 'disabled' : '') + '>‹</button>';
  var maxButtons = 7;
  var first = Math.max(1, current - Math.floor(maxButtons / 2));
  var last = Math.min(totalPages, first + maxButtons - 1);
  if (last - first < maxButtons - 1) first = Math.max(1, last - maxButtons + 1);
  if (first > 1) {
    html += '<button class="pagination-btn" onclick="billViewGo(\'' + key + '\', 1)">1</button>';
    if (first > 2) html += '<span class="pagination-ellipsis">...</span>';
  }
  for (var i = first; i <= last; i++) {
    html += '<button class="pagination-btn ' + (i === current ? 'active' : '') + '" onclick="billViewGo(\'' + key + '\', ' + i + ')">' + i + '</button>';
  }
  if (last < totalPages) {
    if (last < totalPages - 1) html += '<span class="pagination-ellipsis">...</span>';
    html += '<button class="pagination-btn" onclick="billViewGo(\'' + key + '\', ' + totalPages + ')">' + totalPages + '</button>';
  }
  html += '<button class="pagination-btn" onclick="billViewGo(\'' + key + '\', ' + (current + 1) + ')" ' + (current === totalPages ? 'disabled' : '') + '>›</button>';
  billEl(p + '-buttons').innerHTML = html;
}

function renderBillViewPage(key) {
  var p = billViews[key].p;
  var total = billFiltered[key].length;
  var totalPages = Math.max(1, Math.ceil(total / billPerPage[key]));
  if (billPageNo[key] > totalPages) billPageNo[key] = totalPages;
  var start = (billPageNo[key] - 1) * billPerPage[key];
  var end = Math.min(start + billPerPage[key], total);
  var rows = billFiltered[key].slice(start, end);

  if (rows.length) {
    billEl(p + '-body').innerHTML = rows.map(billRowHtml).join('');
  } else {
    var msg = billEmptyMessage(key);
    billEl(p + '-body').innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-title">' + msg[0] + '</div><div class="empty-text">' + msg[1] + '</div></div></td></tr>';
  }
  renderBillViewPagination(key, total, start, end);
}

function renderBillView(key) {
  billFillInstitutes(key);
  billApplyViewFilters(key);
  renderBillViewPage(key);
}

function renderAllBillViews() {
  renderBillStats();
  Object.keys(billViews).forEach(renderBillView);
}

function billViewFilter(key) {
  billPageNo[key] = 1;
  billApplyViewFilters(key);
  renderBillViewPage(key);
}

function billViewClear(key) {
  var p = billViews[key].p;
  billEl(p + '-search').value = '';
  billEl(p + '-institute').value = '';
  billEl(p + '-from').value = '';
  billEl(p + '-to').value = '';
  var statusEl = billEl(p + '-status');
  if (statusEl) statusEl.value = '';
  billViewFilter(key);
}

function billViewGo(key, page) {
  var totalPages = Math.ceil(billFiltered[key].length / billPerPage[key]);
  if (page < 1 || page > totalPages) return;
  billPageNo[key] = page;
  renderBillViewPage(key);
}

function billViewPerPage(key) {
  billPerPage[key] = parseInt(billEl(billViews[key].p + '-per-page').value, 10);
  billPageNo[key] = 1;
  renderBillViewPage(key);
}

function initBillViews() {
  renderAllBillViews();
  loadBills();
}

const CUSTOMER_STORE_KEY = 'telerad_customers';
const CUSTOMER_THANA_KEY = 'telerad_customer_thanas';

const customerDivisions = {
  'Barishal': ['Barguna', 'Barishal', 'Bhola', 'Jhalokati', 'Patuakhali', 'Pirojpur'],
  'Chattogram': ['Bandarban', 'Brahmanbaria', 'Chandpur', 'Chattogram', 'Cox\'s Bazar', 'Cumilla', 'Feni', 'Khagrachhari', 'Lakshmipur', 'Noakhali', 'Rangamati'],
  'Dhaka': ['Dhaka', 'Faridpur', 'Gazipur', 'Gopalganj', 'Kishoreganj', 'Madaripur', 'Manikganj', 'Munshiganj', 'Narayanganj', 'Narsingdi', 'Rajbari', 'Shariatpur', 'Tangail'],
  'Khulna': ['Bagerhat', 'Chuadanga', 'Jashore', 'Jhenaidah', 'Khulna', 'Kushtia', 'Magura', 'Meherpur', 'Narail', 'Satkhira'],
  'Mymensingh': ['Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur'],
  'Rajshahi': ['Bogura', 'Chapainawabganj', 'Joypurhat', 'Naogaon', 'Natore', 'Pabna', 'Rajshahi', 'Sirajganj'],
  'Rangpur': ['Dinajpur', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Panchagarh', 'Rangpur', 'Thakurgaon'],
  'Sylhet': ['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet']
};

let customerList = [];
let customerThanas = {};

const BILLING_KEYS = {
  telerad_customers: 'list',
  telerad_customer_thanas: 'dict',
  telerad_customer_templates: 'list',
  telerad_customer_bill_templates: 'dict',
  telerad_item_types: 'strings',
  telerad_items: 'list',
  telerad_bill_invoices: 'list',
  telerad_bill_collections: 'list',
  telerad_bill_seq: 'dict',
  telerad_messages: 'list',
  telerad_customer_contacts: 'dict',
  telerad_contact_types: 'list'
};

const BILLING_STORE_PAGES = [
  'customers', 'customer-bill-template', 'items', 'trb-bill-entry', 'trb-bill-list',
  'trb-bill-due', 'trb-bill-history', 'trb-dashboard', 'compose-message',
  'bill-send-pending', 'amount-wise-client'
];

const BILLING_BATCH = 300;
const billingCache = {};
const billingBase = {};
let billingLoaded = false;
let billingLoading = null;
let billingSyncedAt = 0;
let billingPending = 0;
let billingChain = Promise.resolve();

function billingEntries(key, value) {
  const kind = BILLING_KEYS[key];
  if (kind === 'dict') {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.keys(source).map(k => [k, JSON.stringify(source[k])]);
  }
  const list = Array.isArray(value) ? value : [];
  if (kind === 'strings') return list.map(s => [String(s), JSON.stringify(s)]);
  const out = [];
  list.forEach(o => {
    if (o && o.id != null) out.push([String(o.id), JSON.stringify(o)]);
  });
  return out;
}

function billingApply(key, payload) {
  const kind = BILLING_KEYS[key];
  const value = kind === 'dict'
    ? (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {})
    : (Array.isArray(payload) ? payload : []);
  const entries = billingEntries(key, value);
  const map = {};
  entries.forEach(e => { map[e[0]] = e[1]; });
  billingBase[key] = { order: entries.map(e => e[0]), map: map };
  billingCache[key] = JSON.stringify(value);
}

async function billingFlush(key) {
  const entries = billingEntries(key, JSON.parse(billingCache[key]));
  const base = billingBase[key] || { order: [], map: {} };
  const keep = {};
  const upserts = [];
  entries.forEach(e => {
    keep[e[0]] = true;
    if (base.map[e[0]] !== e[1]) upserts.push({ id: e[0], data: JSON.parse(e[1]) });
  });
  const deletes = base.order.filter(id => !keep[id]);
  const order = entries.map(e => e[0]);
  const kept = base.order.filter(id => keep[id]);
  const appendOnly = kept.length <= order.length && kept.every((id, i) => id === order[i]);
  const sendOrder = BILLING_KEYS[key] !== 'dict' && !appendOnly;
  if (!upserts.length && !deletes.length && !sendOrder) return;
  const batches = [];
  for (let i = 0; i < upserts.length; i += BILLING_BATCH) batches.push(upserts.slice(i, i + BILLING_BATCH));
  if (!batches.length) batches.push([]);
  try {
    for (let i = 0; i < batches.length; i++) {
      const last = i === batches.length - 1;
      const res = await api('/api/billing-data/sync/', {
        method: 'POST',
        body: JSON.stringify({
          key: key,
          upserts: batches[i],
          deletes: i === 0 ? deletes : [],
          order: last && sendOrder ? order : null
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    }
    const map = {};
    entries.forEach(e => { map[e[0]] = e[1]; });
    billingBase[key] = { order: order, map: map };
  } catch (e) {
    showToast('Could not save to the server. Please check your connection and try again.', 'error');
  }
}

async function billingImportLocal() {
  const keys = Object.keys(BILLING_KEYS);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const base = billingBase[key];
    if (base && base.order.length) continue;
    let value;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      value = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    if (!billingEntries(key, value).length) continue;
    billingCache[key] = JSON.stringify(value);
    await billingFlush(key);
    if (billingBase[key] && billingBase[key].order.length) {
      try { localStorage.removeItem(key); } catch (e) {}
    }
  }
}

async function billingFetch() {
  try {
    const res = await api('/api/billing-data/');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    if (billingLoaded && billingPending > 0) return;
    const data = body.data || {};
    Object.keys(BILLING_KEYS).forEach(k => billingApply(k, data[k]));
    billingLoaded = true;
    billingSyncedAt = Date.now();
    await billingImportLocal();
  } catch (e) {
    if (!billingLoaded) showToast('Could not load billing data from the server', 'error');
  }
}

function billingEnsure(maxAge) {
  if (billingPending > 0) return Promise.resolve();
  if (billingLoaded && Date.now() - billingSyncedAt < maxAge) return Promise.resolve();
  if (!billingLoading) billingLoading = billingFetch().then(() => { billingLoading = null; });
  return billingLoading;
}

function customerRead(key, fallback) {
  if (!(key in BILLING_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  const raw = billingCache[key];
  if (raw === undefined) return fallback;
  const value = JSON.parse(raw);
  if (fallback === null && Array.isArray(value) && !value.length) return fallback;
  return value;
}

function customerWrite(key, value) {
  if (!(key in BILLING_KEYS)) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      showToast('Could not save data in this browser', 'error');
    }
    return;
  }
  if (!billingLoaded) {
    showToast('Billing data is not loaded from the server. Refresh the page and try again.', 'error');
    return;
  }
  billingCache[key] = JSON.stringify(value);
  billingPending++;
  billingChain = billingChain
    .then(() => billingFlush(key))
    .catch(() => {})
    .then(() => { billingPending--; });
}

window.addEventListener('beforeunload', e => {
  if (billingPending > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

billingEnsure(0);

function customerVal(id) {
  return document.getElementById(id).value.trim();
}

function customerFillSelect(id, items, placeholder) {
  const el = document.getElementById(id);
  el.innerHTML = '<option value="">' + placeholder + '</option>' +
    items.map(name => '<option value="' + billEsc(name) + '">' + billEsc(name) + '</option>').join('');
}

const CUSTOMER_TPL_KEY = 'telerad_customer_templates';
let customerPerPage = 25;

let customerEditId = null;
let customerPageNo = 1;
let customerTemplates = [];
let customerActiveTpl = null;

function initCustomers() {
  customerList = customerRead(CUSTOMER_STORE_KEY, []);
  customerThanas = customerRead(CUSTOMER_THANA_KEY, {});
  customerTemplates = customerRead(CUSTOMER_TPL_KEY, null);
  if (!customerTemplates) {
    customerTemplates = [
      { id: 1, name: 'Add Template', field: 'all', term: '' },
      { id: 2, name: 'View Template', field: 'all', term: '' }
    ];
    customerWrite(CUSTOMER_TPL_KEY, customerTemplates);
  }
  if (customerActiveTpl === null && customerTemplates.length) customerActiveTpl = customerTemplates[0].id;
  customerPageNo = 1;
  renderCustomerTemplates();
  renderCustomers();
}

function customerDate(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m[3] + '/' + months[parseInt(m[2], 10) - 1] + '/' + m[1];
}

function customerDisplayId(c) {
  return String(1000 + trbCustomerNo(c));
}

function customerFiltered() {
  const term = document.getElementById('cs-search-input').value.trim().toLowerCase();
  const field = document.getElementById('cs-search-field').value;
  if (!term) return customerList;
  const keys = ['code', 'name', 'type', 'username', 'division', 'district', 'thana', 'address', 'instructedBy', 'connectionBy', 'connectionDate', 'connectionStatus', 'serverStatus', 'remarks'];
  return customerList.filter(c => {
    if (field === 'all') return keys.some(k => String(c[k] == null ? '' : c[k]).toLowerCase().includes(term));
    return String(c[field] == null ? '' : c[field]).toLowerCase().includes(term);
  });
}

function portalPageButtons(containerId, current, totalPages, handler) {
  const container = document.getElementById(containerId);
  let html = '<button class="pagination-btn" onclick="' + handler + '(' + (current - 1) + ')" ' + (current === 1 ? 'disabled' : '') + '>‹</button>';
  const maxButtons = 7;
  let startPage = Math.max(1, current - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);
  if (startPage > 1) {
    html += '<button class="pagination-btn" onclick="' + handler + '(1)">1</button>';
    if (startPage > 2) html += '<span class="pagination-ellipsis">...</span>';
  }
  for (let i = startPage; i <= endPage; i++) {
    html += '<button class="pagination-btn ' + (i === current ? 'active' : '') + '" onclick="' + handler + '(' + i + ')">' + i + '</button>';
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="pagination-ellipsis">...</span>';
    html += '<button class="pagination-btn" onclick="' + handler + '(' + totalPages + ')">' + totalPages + '</button>';
  }
  html += '<button class="pagination-btn" onclick="' + handler + '(' + (current + 1) + ')" ' + (current === totalPages ? 'disabled' : '') + '>›</button>';
  container.innerHTML = html;
}

function statusBadge(value) {
  if (!value) return '';
  const good = ['Active', 'Connected'];
  const bad = ['Inactive', 'Disconnected'];
  const cls = good.includes(value) ? 'badge-green' : bad.includes(value) ? 'badge-red' : 'badge-yellow';
  return '<span class="badge ' + cls + '">' + billEsc(value) + '</span>';
}

function renderCustomers() {
  const body = document.getElementById('customers-table-body');
  const rows = customerFiltered();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / customerPerPage));
  if (customerPageNo > pages) customerPageNo = pages;
  const start = (customerPageNo - 1) * customerPerPage;
  const end = Math.min(start + customerPerPage, total);
  const slice = rows.slice(start, end);
  if (!slice.length) {
    body.innerHTML = '<tr><td colspan="21"><div class="empty-state"><div class="empty-title">No customers found</div></div></td></tr>';
  } else {
    const contactStore = customerRead(CONTACTS_KEY, {});
    const templateStore = customerRead(CBT_KEY, {});
    body.innerHTML = slice.map(c => {
      return '<tr>' +
        '<td>' + billEsc(c.code) + '</td>' +
        '<td><span style="font-weight:500;color:var(--text);">' + billEsc(c.name) + '</span></td>' +
        '<td>' + billEsc(c.type) + '</td>' +
        '<td>' + billEsc(c.username) + '</td>' +
        '<td>' + billEsc(c.password) + '</td>' +
        '<td>' + billEsc(c.division) + '</td>' +
        '<td>' + billEsc(c.district) + '</td>' +
        '<td>' + billEsc(c.thana) + '</td>' +
        '<td>' + billEsc(c.address) + '</td>' +
        '<td>' + billEsc(c.instructedBy) + '</td>' +
        '<td>' + billEsc(c.connectionBy) + '</td>' +
        '<td>' + billEsc(customerDate(c.connectionDate)) + '</td>' +
        '<td>' + statusBadge(c.connectionStatus) + '</td>' +
        '<td>' + statusBadge(c.serverStatus) + '</td>' +
        '<td>' + billEsc(c.remarks) + '</td>' +
        '<td>' + billEsc(c.createdBy) + '</td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="openCustomerModal(' + c.id + ')">Edit</button></td>' +
        '<td>' + billEsc(customerContactText(customerContactsFor(c, contactStore))) + '</td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="customerOpenTemplate(' + c.id + ')">' + ((templateStore[c.id] || []).length ? 'View Template' : 'Add Template') + '</button></td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="contactInfoOpen(' + c.id + ')">View</button></td>' +
        '<td>' + billEsc(customerDisplayId(c)) + '</td>' +
      '</tr>';
    }).join('');
  }
  const box = document.getElementById('cs-pagination-container');
  if (total > 10) {
    box.style.display = 'block';
    document.getElementById('cs-pagination-info').textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + total + ' customers';
    portalPageButtons('cs-pagination-buttons', customerPageNo, pages, 'customerGoToPage');
  } else {
    box.style.display = 'none';
  }
}

function customerSearch() {
  customerPageNo = 1;
  renderCustomers();
}

function customerClearSearch() {
  document.getElementById('cs-search-input').value = '';
  document.getElementById('cs-search-field').value = 'all';
  customerActiveTpl = null;
  renderCustomerTemplates();
  customerSearch();
}

function customerGoToPage(page) {
  const pages = Math.ceil(customerFiltered().length / customerPerPage);
  if (page < 1 || page > pages) return;
  customerPageNo = page;
  renderCustomers();
}

function customerPerPageChanged() {
  customerPerPage = parseInt(document.getElementById('cs-items-per-page').value, 10);
  customerPageNo = 1;
  renderCustomers();
}

function customerDownload() {
  const rows = customerFiltered();
  if (!rows.length) {
    showToast('No customers to download', 'error');
    return;
  }
  const head = ['Customer Code', 'Customer Name', 'Customer Type', 'Username', 'Password', 'Division', 'District', 'Thana', 'Address', 'Instructed By', 'Connection By', 'Connection Date', 'Connection Status', 'Server Status', 'Remarks', 'Due'];
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [head.map(cell).join(',')];
  rows.forEach(c => lines.push([c.code, c.name, c.type, c.username, c.password, c.division, c.district, c.thana, c.address, c.instructedBy, c.connectionBy, c.connectionDate, c.connectionStatus, c.serverStatus, c.remarks, Number(c.due || 0).toFixed(2)].map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'customers.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function renderCustomerTemplates() {
  const list = document.getElementById('cs-tpl-list');
  if (!customerTemplates.length) {
    list.innerHTML = '<span style="font-size:12.5px;color:var(--text3);">None</span>';
    return;
  }
  list.innerHTML = customerTemplates.map(t =>
    '<span class="cs-chip' + (t.id === customerActiveTpl ? ' active' : '') + '" onclick="customerApplyTemplate(' + t.id + ')">' +
      billEsc(t.name) +
      '<span class="cs-chip-x" onclick="event.stopPropagation();customerRemoveTemplate(' + t.id + ')">&#10005;</span>' +
    '</span>'
  ).join('');
}

function customerApplyTemplate(id) {
  const t = customerTemplates.find(x => x.id === id);
  if (!t) return;
  customerActiveTpl = id;
  document.getElementById('cs-search-field').value = t.field;
  document.getElementById('cs-search-input').value = t.term;
  renderCustomerTemplates();
  customerSearch();
}

function customerRemoveTemplate(id) {
  customerTemplates = customerTemplates.filter(t => t.id !== id);
  if (customerActiveTpl === id) customerActiveTpl = null;
  customerWrite(CUSTOMER_TPL_KEY, customerTemplates);
  renderCustomerTemplates();
}

function customerSaveTemplate() {
  const name = (window.prompt('Template name') || '').trim();
  if (!name) return;
  const tpl = {
    id: Date.now(),
    name: name,
    field: document.getElementById('cs-search-field').value,
    term: document.getElementById('cs-search-input').value.trim()
  };
  customerTemplates.push(tpl);
  customerActiveTpl = tpl.id;
  customerWrite(CUSTOMER_TPL_KEY, customerTemplates);
  renderCustomerTemplates();
  showToast('Template saved', 'success');
}

function openCustomerModal(id) {
  const c = id ? customerList.find(x => x.id === id) : null;
  customerEditId = c ? c.id : null;
  document.getElementById('cu-save-btn').textContent = c ? 'Save' : 'Create';
  const map = {
    'cu-code': 'code', 'cu-name': 'name', 'cu-username': 'username', 'cu-password': 'password', 'cu-address': 'address',
    'cu-instructed': 'instructedBy', 'cu-connection-by': 'connectionBy', 'cu-conn-date': 'connectionDate',
    'cu-conn-status': 'connectionStatus', 'cu-server-status': 'serverStatus', 'cu-type': 'type', 'cu-remarks': 'remarks',
    'cu-contact': 'responsibleContract', 'cu-pricing': 'pricingDetails'
  };
  Object.keys(map).forEach(el => {
    const node = document.getElementById(el);
    const val = c && c[map[el]] != null ? c[map[el]] : '';
    if ((el === 'cu-type' || el === 'cu-server-status') && val && !Array.from(node.options).some(o => o.value === val)) {
      node.appendChild(new Option(val, val));
    }
    node.value = val;
  });
  document.getElementById('cu-reg-date').value = c && c.regDate ? c.regDate : new Date().toISOString().slice(0, 10);
  customerFillSelect('cu-division', Object.keys(customerDivisions), 'Division');
  customerFillSelect('cu-district', [], 'District');
  customerFillSelect('cu-thana', [], 'Thana');
  if (c) {
    document.getElementById('cu-division').value = c.division || '';
    customerFillSelect('cu-district', customerDivisions[c.division] || [], 'District');
    document.getElementById('cu-district').value = c.district || '';
    const thanas = (customerThanas[c.district] || []).slice();
    if (c.thana && !thanas.includes(c.thana)) thanas.push(c.thana);
    customerFillSelect('cu-thana', thanas, 'Thana');
    document.getElementById('cu-thana').value = c.thana || '';
  }
  document.getElementById('cu-error').style.display = 'none';
  openModal('customer-modal');
}

function customerDivisionChanged() {
  customerFillSelect('cu-district', customerDivisions[customerVal('cu-division')] || [], 'District');
  customerFillSelect('cu-thana', [], 'Thana');
}

function customerDistrictChanged() {
  customerFillSelect('cu-thana', customerThanas[customerVal('cu-district')] || [], 'Thana');
}

function customerDistrictList() {
  const list = [];
  Object.keys(customerDivisions).forEach(division => {
    customerDivisions[division].forEach(name => list.push(name));
  });
  return list;
}

function openThanaEntry() {
  const districts = customerDistrictList();
  document.getElementById('te-district-id').innerHTML = '<option value="">District Id</option>' +
    districts.map((name, i) => '<option value="' + (i + 1) + '">' + (i + 1) + ' - ' + billEsc(name) + '</option>').join('');
  document.getElementById('te-district-name').value = '';
  document.getElementById('te-thana-name').value = '';
  document.getElementById('te-error').style.display = 'none';
  const current = customerVal('cu-district');
  const index = districts.indexOf(current);
  if (index !== -1) {
    document.getElementById('te-district-id').value = String(index + 1);
    document.getElementById('te-district-name').value = current;
  }
  openModal('thana-entry-modal');
}

function thanaEntryDistrictChanged() {
  const id = parseInt(document.getElementById('te-district-id').value, 10);
  document.getElementById('te-district-name').value = id ? customerDistrictList()[id - 1] : '';
}

function refreshThanaEntry() {
  document.getElementById('te-district-id').value = '';
  document.getElementById('te-district-name').value = '';
  document.getElementById('te-thana-name').value = '';
  document.getElementById('te-error').style.display = 'none';
}

function saveThanaEntry() {
  const errorBox = document.getElementById('te-error');
  const district = document.getElementById('te-district-name').value.trim();
  const name = document.getElementById('te-thana-name').value.trim();
  if (!district || !name) {
    errorBox.textContent = 'Select a district and enter the thana name.';
    errorBox.style.display = 'flex';
    return;
  }
  const list = customerThanas[district] || [];
  if (list.some(t => t.toLowerCase() === name.toLowerCase())) {
    errorBox.textContent = 'This thana already exists for ' + district + '.';
    errorBox.style.display = 'flex';
    return;
  }
  list.push(name);
  list.sort();
  customerThanas[district] = list;
  customerWrite(CUSTOMER_THANA_KEY, customerThanas);
  errorBox.style.display = 'none';
  document.getElementById('te-thana-name').value = '';
  if (customerVal('cu-district') === district) {
    customerFillSelect('cu-thana', list, 'Thana');
    document.getElementById('cu-thana').value = name;
  }
  showToast('Thana saved', 'success');
}

function saveCustomer() {
  const errorBox = document.getElementById('cu-error');
  const name = customerVal('cu-name');
  const pricing = customerVal('cu-pricing');
  if (!name || !pricing) {
    errorBox.textContent = 'Customer Name and Pricing Details are required.';
    errorBox.style.display = 'flex';
    return;
  }
  const record = {
    code: customerVal('cu-code'),
    name: name,
    type: customerVal('cu-type'),
    username: customerVal('cu-username'),
    password: document.getElementById('cu-password').value,
    division: customerVal('cu-division'),
    district: customerVal('cu-district'),
    thana: customerVal('cu-thana'),
    address: customerVal('cu-address'),
    instructedBy: customerVal('cu-instructed'),
    connectionBy: customerVal('cu-connection-by'),
    connectionDate: customerVal('cu-conn-date'),
    connectionStatus: customerVal('cu-conn-status'),
    regDate: customerVal('cu-reg-date'),
    serverStatus: customerVal('cu-server-status'),
    remarks: customerVal('cu-remarks'),
    responsibleContract: customerVal('cu-contact'),
    pricingDetails: pricing
  };
  if (customerEditId) {
    const target = customerList.find(x => x.id === customerEditId);
    if (target) Object.assign(target, record);
    showToast('Customer updated', 'success');
  } else {
    customerList.push(Object.assign({ id: Date.now(), due: 0, createdBy: trbCreator() }, record));
    showToast('Customer added', 'success');
  }
  customerWrite(CUSTOMER_STORE_KEY, customerList);
  renderCustomers();
  closeModal('customer-modal');
}

const CONTACTS_KEY = 'telerad_customer_contacts';
const CONTACT_TYPES_KEY = 'telerad_contact_types';

let ciCustomerId = null;
let ciRows = [];
let ciTerm = '';
let ctEditId = null;

function customerContactsFor(c, store) {
  const saved = store[String(c.id)];
  if (Array.isArray(saved)) return saved;
  return String(c.responsibleContract || '')
    .split(/[;\n|]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = /^(.*?)\s*=\s*(.*?)\s*(?:\(([^)]*)\))?$/.exec(s);
      if (!m) {
        if (/^[\d\s+,-]+$/.test(s)) return { name: '', number: s, type: '', designation: '', remarks: '' };
        return { name: s, number: '', type: '', designation: '', remarks: '' };
      }
      return { name: m[1].trim(), number: m[2].trim(), type: '', designation: (m[3] || '').trim(), remarks: '' };
    });
}

function customerContactText(rows) {
  return (rows || [])
    .filter(r => r.name || r.number)
    .map(r => r.name && r.number ? '(' + r.name + ' = ' + r.number + ')' : (r.name || r.number))
    .join(' , ');
}

function customerOpenTemplate(id) {
  cbtPendingCustomer = String(id);
  document.querySelector('.nav-item[data-page="customer-bill-template"]').click();
}

function contactTypeList() {
  let list = customerRead(CONTACT_TYPES_KEY, null);
  if (!list) {
    list = [
      { id: 1, name: 'Management', remarks: '' },
      { id: 2, name: 'Accounts', remarks: '' },
      { id: 3, name: 'Technologist', remarks: '' }
    ];
    if (billingLoaded) customerWrite(CONTACT_TYPES_KEY, list);
  }
  return list;
}

function contactInfoOpen(id) {
  const c = customerList.find(x => x.id === id);
  if (!c) return;
  ciCustomerId = id;
  ciTerm = '';
  const store = customerRead(CONTACTS_KEY, {});
  ciRows = customerContactsFor(c, store).map(r => Object.assign({ name: '', number: '', type: '', designation: '', remarks: '' }, r, { selected: false }));
  document.getElementById('ci-customer').value = c.name;
  document.getElementById('ci-search').value = '';
  document.getElementById('ci-actions').value = '';
  renderContactInfo();
  openModal('contact-info-modal');
}

function contactInfoVisible(r) {
  if (!ciTerm) return true;
  if (!r.name && !r.number && !r.type && !r.designation && !r.remarks) return true;
  return [r.name, r.number, r.type, r.designation, r.remarks].some(v => String(v || '').toLowerCase().includes(ciTerm));
}

function renderContactInfo() {
  const types = contactTypeList();
  const body = document.getElementById('ci-body');
  const html = ciRows.map((r, i) => {
    if (!contactInfoVisible(r)) return '';
    const known = types.some(t => t.name === r.type);
    return '<tr>' +
      '<td><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="contactInfoSelect(' + i + ', this.checked)" /></td>' +
      '<td><input type="text" value="' + billEsc(r.name) + '" oninput="contactInfoEdit(' + i + ', \'name\', this.value)" /></td>' +
      '<td><input type="text" value="' + billEsc(r.number) + '" oninput="contactInfoEdit(' + i + ', \'number\', this.value)" /></td>' +
      '<td><select onchange="contactInfoEdit(' + i + ', \'type\', this.value)"><option value=""></option>' +
        (r.type && !known ? '<option value="' + billEsc(r.type) + '" selected>' + billEsc(r.type) + '</option>' : '') +
        types.map(t => '<option value="' + billEsc(t.name) + '"' + (t.name === r.type ? ' selected' : '') + '>' + billEsc(t.name) + '</option>').join('') +
      '</select></td>' +
      '<td><input type="text" value="' + billEsc(r.designation) + '" oninput="contactInfoEdit(' + i + ', \'designation\', this.value)" /></td>' +
      '<td><input type="text" value="' + billEsc(r.remarks) + '" oninput="contactInfoEdit(' + i + ', \'remarks\', this.value)" /></td>' +
    '</tr>';
  }).join('');
  body.innerHTML = html || '<tr><td colspan="6"><div class="empty-state"><div class="empty-title">No contacts</div></div></td></tr>';
  contactInfoFooter();
}

function contactInfoFooter() {
  const count = ciRows.filter(r => r.selected).length;
  document.getElementById('ci-selected-count').textContent = count + ' rows selected';
  document.getElementById('ci-total').textContent = 'Total ' + ciRows.length;
  document.getElementById('ci-check-all').checked = ciRows.length > 0 && count === ciRows.length;
}

function contactInfoEdit(i, field, value) {
  ciRows[i][field] = value;
}

function contactInfoSelect(i, checked) {
  ciRows[i].selected = checked;
  contactInfoFooter();
}

function contactInfoSelectAll(checked) {
  ciRows.forEach(r => { r.selected = checked; });
  renderContactInfo();
}

function contactInfoGo() {
  ciTerm = document.getElementById('ci-search').value.trim().toLowerCase();
  renderContactInfo();
}

function contactInfoAddRow() {
  ciRows.push({ name: '', number: '', type: '', designation: '', remarks: '', selected: false });
  renderContactInfo();
}

function contactInfoAction(value) {
  document.getElementById('ci-actions').value = '';
  if (value !== 'delete') return;
  if (!ciRows.some(r => r.selected)) {
    showToast('Select at least one row', 'error');
    return;
  }
  ciRows = ciRows.filter(r => !r.selected);
  renderContactInfo();
}

function contactInfoSave() {
  if (ciCustomerId === null) return;
  const rows = ciRows
    .filter(r => String(r.name).trim() || String(r.number).trim() || r.type || String(r.designation).trim() || String(r.remarks).trim())
    .map(r => ({ name: String(r.name).trim(), number: String(r.number).trim(), type: r.type, designation: String(r.designation).trim(), remarks: String(r.remarks).trim() }));
  const store = customerRead(CONTACTS_KEY, {});
  store[String(ciCustomerId)] = rows;
  customerWrite(CONTACTS_KEY, store);
  ciRows = rows.map(r => Object.assign({}, r, { selected: false }));
  renderContactInfo();
  renderCustomers();
  showToast('Contact info saved', 'success');
}

function contactTypeOpen() {
  ctEditId = null;
  document.getElementById('ct-name').value = '';
  renderContactTypes();
  openModal('contact-type-modal');
}

function renderContactTypes() {
  const list = contactTypeList();
  document.getElementById('ct-body').innerHTML = list.length ? list.map(t =>
    '<tr>' +
      '<td><button class="btn btn-ghost btn-xs" title="Edit" onclick="contactTypeEdit(' + t.id + ')">&#9998;</button></td>' +
      '<td>' + billEsc(t.name) + '</td>' +
      '<td>' + billEsc(t.remarks) + '</td>' +
    '</tr>'
  ).join('') : '<tr><td colspan="3"><div class="empty-state"><div class="empty-title">No contact types</div></div></td></tr>';
  document.getElementById('ct-count').textContent = list.length ? '1 - ' + list.length : '';
}

function contactTypeEdit(id) {
  const t = contactTypeList().find(x => x.id === id);
  if (!t) return;
  ctEditId = id;
  document.getElementById('ct-name').value = t.name;
  document.getElementById('ct-name').focus();
}

function contactTypeSave() {
  const name = document.getElementById('ct-name').value.trim();
  if (!name) {
    showToast('Contact Type Name is required', 'error');
    return;
  }
  const list = contactTypeList();
  if (list.some(t => t.id !== ctEditId && t.name.toLowerCase() === name.toLowerCase())) {
    showToast('This contact type already exists', 'error');
    return;
  }
  if (ctEditId !== null) {
    const target = list.find(t => t.id === ctEditId);
    if (target && target.name !== name) {
      const old = target.name;
      const store = customerRead(CONTACTS_KEY, {});
      Object.keys(store).forEach(cid => {
        (store[cid] || []).forEach(r => { if (r.type === old) r.type = name; });
      });
      customerWrite(CONTACTS_KEY, store);
      ciRows.forEach(r => { if (r.type === old) r.type = name; });
      target.name = name;
    }
  } else {
    list.push({ id: Date.now(), name: name, remarks: '' });
  }
  customerWrite(CONTACT_TYPES_KEY, list);
  showToast(ctEditId !== null ? 'Contact type updated' : 'Contact type added', 'success');
  ctEditId = null;
  document.getElementById('ct-name').value = '';
  renderContactTypes();
  renderContactInfo();
}

let cbtPendingCustomer = null;

const CBT_KEY = 'telerad_customer_bill_templates';

let cbtRows = [];
let cbtDragFrom = null;
let cbtPageNo = 1;
let cbtPerPage = 25;

function cbtNumber(value) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

function cbtFormat(value) {
  return String(Math.round(value * 100) / 100);
}

const ITEM_TYPES_KEY = 'telerad_item_types';

function itemIdValid(id) {
  return /^[1-9]\d{4}$/.test(String(id));
}

function itemNewId(list) {
  let max = 10000;
  list.forEach(it => {
    if (itemIdValid(it.id) && Number(it.id) > max) max = Number(it.id);
  });
  if (max < 99999) return max + 1;
  for (let n = 10001; n <= 99999; n++) {
    if (!list.some(it => String(it.id) === String(n))) return n;
  }
  return max;
}

function itemsMigrate(list) {
  const seen = {};
  list.forEach(it => {
    if (!itemIdValid(it.id) || seen[String(it.id)]) {
      it.__old = String(it.id);
      it.id = itemNewId(list);
    }
    seen[String(it.id)] = true;
  });
  const moved = list.filter(it => it.__old !== undefined);
  if (!moved.length) return list;
  const store = customerRead(CBT_KEY, {});
  Object.keys(store).forEach(cid => {
    (store[cid] || []).forEach(r => {
      const hit = moved.find(it => String(it.__old) === String(r.itemId) && !list.some(x => x.__old === undefined && String(x.id) === String(r.itemId)));
      if (hit) r.itemId = String(hit.id);
    });
  });
  moved.forEach(it => { delete it.__old; });
  customerWrite(CBT_KEY, store);
  customerWrite(ITEMS_KEY, list);
  return list;
}

function cbtItems() {
  itemsList = itemsMigrate(customerRead(ITEMS_KEY, []));
  return itemsList;
}

function cbtItemTypes() {
  const saved = customerRead(ITEM_TYPES_KEY, []);
  const fromItems = cbtItems().map(it => it.type).filter(Boolean);
  const all = [];
  saved.concat(fromItems).forEach(t => {
    const name = String(t).trim();
    if (name && !all.some(x => x.toLowerCase() === name.toLowerCase())) all.push(name);
  });
  return all.sort((a, b) => a.localeCompare(b));
}

function initCustomerBillTemplate() {
  customerList = customerRead(CUSTOMER_STORE_KEY, []);
  const select = document.getElementById('cbt-customer');
  const previous = select.value;
  select.innerHTML = '<option value="">Select Customer</option>' +
    customerList.map(c => '<option value="' + c.id + '">' + billEsc(c.name) + '</option>').join('');
  if (previous && customerList.some(c => String(c.id) === previous)) select.value = previous;
  if (cbtPendingCustomer !== null) {
    if (customerList.some(c => String(c.id) === cbtPendingCustomer)) select.value = cbtPendingCustomer;
    cbtPendingCustomer = null;
  }
  cbtCustomerChanged();
}

function cbtCustomerChanged() {
  const id = document.getElementById('cbt-customer').value;
  const store = customerRead(CBT_KEY, {});
  const items = cbtItems();
  cbtRows = id ? (store[id] || []).map(r => {
    const row = Object.assign({}, r, { selected: false });
    const item = items.find(it => String(it.id) === String(row.itemId));
    if (item && !row.remarks) row.remarks = item.remarks || '';
    return row;
  }) : [];
  cbtPageNo = 1;
  renderCbt();
}

function cbtNameOptions(r, items) {
  const current = String(r.itemId == null ? '' : r.itemId);
  const byId = items.some(it => String(it.id) === current);
  const legacy = !byId && r.itemName;
  let html = '<option value=""></option>';
  if (legacy) html += '<option value="__legacy" selected>' + billEsc(r.itemName) + '</option>';
  html += items.map(it => '<option value="' + it.id + '"' + (byId && String(it.id) === current ? ' selected' : '') + '>' + billEsc(it.name) + '</option>').join('');
  return html;
}

function renderCbt() {
  const body = document.getElementById('cbt-body');
  const items = cbtItems();
  const totalRows = cbtRows.length;
  const pages = Math.max(1, Math.ceil(totalRows / cbtPerPage));
  if (cbtPageNo > pages) cbtPageNo = pages;
  const start = (cbtPageNo - 1) * cbtPerPage;
  const end = Math.min(start + cbtPerPage, totalRows);
  if (!totalRows) {
    body.innerHTML = '<tr><td colspan="10" class="cbt-empty">No items</td></tr>';
  } else {
    body.innerHTML = cbtRows.slice(start, end).map((r, k) => {
      const i = start + k;
      const total = cbtFormat(cbtNumber(r.quantity) * cbtNumber(r.price));
      return '<tr class="' + (r.selected ? 'cbt-sel' : '') + '" ondragover="event.preventDefault()" ondrop="cbtDrop(' + i + ')" ondragstart="cbtDragFrom=' + i + '" ondragend="this.draggable=false">' +
        '<td><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="cbtRowSelect(' + i + ', this.checked)" /></td>' +
        '<td><span class="cbt-handle" onmousedown="this.closest(\'tr\').draggable=true" onmouseup="this.closest(\'tr\').draggable=false">&#8801;</span></td>' +
        '<td><input type="text" readonly value="' + billEsc(r.itemId) + '" /></td>' +
        '<td><select onchange="cbtPickItem(' + i + ', this.value)">' + cbtNameOptions(r, items) + '</select></td>' +
        '<td><input type="text" data-i="' + i + '" data-f="itemDesc" value="' + billEsc(r.itemDesc) + '" oninput="cbtEdit(this)" /></td>' +
        '<td><input type="number" step="any" class="cbt-num" data-i="' + i + '" data-f="quantity" value="' + billEsc(r.quantity) + '" oninput="cbtEdit(this)" /></td>' +
        '<td><input type="number" step="any" class="cbt-num" data-i="' + i + '" data-f="price" value="' + billEsc(r.price) + '" oninput="cbtEdit(this)" /></td>' +
        '<td class="cbt-totalcell" id="cbt-total-' + i + '">' + total + '</td>' +
        '<td><input type="number" step="1" class="cbt-num" data-i="' + i + '" data-f="priority" value="' + billEsc(r.priority) + '" oninput="cbtEdit(this)" /></td>' +
        '<td><input type="text" data-i="' + i + '" data-f="remarks" value="' + billEsc(r.remarks) + '" oninput="cbtEdit(this)" /></td>' +
      '</tr>';
    }).join('');
  }
  const box = document.getElementById('cbt-pagination-container');
  if (totalRows > 10) {
    box.style.display = 'block';
    document.getElementById('cbt-pagination-info').textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + totalRows + ' items';
    portalPageButtons('cbt-pagination-buttons', cbtPageNo, pages, 'cbtGoToPage');
  } else {
    box.style.display = 'none';
  }
  cbtUpdateFooter();
}

function cbtGoToPage(page) {
  const pages = Math.max(1, Math.ceil(cbtRows.length / cbtPerPage));
  if (page < 1 || page > pages) return;
  cbtPageNo = page;
  renderCbt();
}

function cbtPerPageChanged() {
  cbtPerPage = parseInt(document.getElementById('cbt-items-per-page').value, 10);
  cbtPageNo = 1;
  renderCbt();
}

function cbtPickItem(i, value) {
  if (value === '__legacy') return;
  const row = cbtRows[i];
  if (!value) {
    row.itemId = '';
    row.itemName = '';
    row.itemDesc = '';
    row.price = 0;
    row.remarks = '';
    renderCbt();
    return;
  }
  const item = cbtItems().find(it => String(it.id) === String(value));
  if (!item) return;
  row.itemId = String(item.id);
  row.itemName = item.name;
  row.itemDesc = item.description || item.name;
  row.price = item.price;
  row.remarks = item.remarks || '';
  if (!cbtNumber(row.quantity)) row.quantity = 1;
  renderCbt();
}

function cbtUpdateFooter() {
  const count = cbtRows.filter(r => r.selected).length;
  document.getElementById('cbt-selected-count').textContent = count + ' rows selected';
  document.getElementById('cbt-row-total').textContent = 'Total ' + cbtRows.length;
  const all = document.getElementById('cbt-check-all');
  all.checked = cbtRows.length > 0 && count === cbtRows.length;
}

function cbtEdit(el) {
  const i = parseInt(el.dataset.i, 10);
  const field = el.dataset.f;
  cbtRows[i][field] = el.value;
  if (field === 'quantity' || field === 'price') {
    const cell = document.getElementById('cbt-total-' + i);
    if (cell) cell.textContent = cbtFormat(cbtNumber(cbtRows[i].quantity) * cbtNumber(cbtRows[i].price));
  }
}

function cbtRowSelect(i, checked) {
  cbtRows[i].selected = checked;
  const cell = document.getElementById('cbt-total-' + i);
  const tr = cell ? cell.closest('tr') : null;
  if (tr) tr.classList.toggle('cbt-sel', checked);
  cbtUpdateFooter();
}

function cbtSelectAll(checked) {
  cbtRows.forEach(r => { r.selected = checked; });
  renderCbt();
}

function cbtRequireCustomer() {
  if (!document.getElementById('cbt-customer').value) {
    showToast('Select a customer first', 'error');
    return false;
  }
  return true;
}

function cbtAddRow() {
  if (!cbtRequireCustomer()) return;
  cbtRows.push({ itemId: '', itemName: '', itemDesc: '', quantity: 0, price: 0, priority: cbtRows.length + 1, remarks: '', selected: false });
  cbtPageNo = Math.ceil(cbtRows.length / cbtPerPage);
  renderCbt();
}

let cbtItemTarget = 'cbt';

function cbtAddItem() {
  if (!cbtRequireCustomer()) return;
  cbtItemTarget = 'cbt';
  cbtOpenItemForm();
}

function cbtOpenItemForm() {
  const select = document.getElementById('cbt-it-type');
  select.innerHTML = '<option value=""></option>' + cbtItemTypes().map(t => '<option value="' + billEsc(t) + '">' + billEsc(t) + '</option>').join('');
  document.getElementById('cbt-it-name').value = '';
  document.getElementById('cbt-it-description').value = '';
  document.getElementById('cbt-it-price').value = '';
  document.getElementById('cbt-it-remarks').value = '';
  document.getElementById('cbt-it-type-input').value = '';
  document.getElementById('cbt-it-type-new').style.display = 'none';
  document.getElementById('cbt-it-error').style.display = 'none';
  openModal('cbt-item-modal');
}

function cbtToggleTypeEntry() {
  const box = document.getElementById('cbt-it-type-new');
  const show = box.style.display === 'none';
  box.style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('cbt-it-type-input').focus();
}

function cbtAddItemType() {
  const input = document.getElementById('cbt-it-type-input');
  const name = input.value.trim();
  if (!name) return;
  const types = cbtItemTypes();
  const existing = types.find(t => t.toLowerCase() === name.toLowerCase());
  if (!existing) {
    types.push(name);
    customerWrite(ITEM_TYPES_KEY, types);
  }
  const value = existing || name;
  const select = document.getElementById('cbt-it-type');
  select.innerHTML = '<option value=""></option>' + cbtItemTypes().map(t => '<option value="' + billEsc(t) + '">' + billEsc(t) + '</option>').join('');
  select.value = value;
  input.value = '';
  document.getElementById('cbt-it-type-new').style.display = 'none';
}

function cbtSaveNewItem() {
  const errorBox = document.getElementById('cbt-it-error');
  const type = customerVal('cbt-it-type');
  const name = customerVal('cbt-it-name');
  if (!type || !name) {
    errorBox.textContent = !type && !name ? 'Item Type and Item Name are required.' : (!type ? 'Item Type is required.' : 'Item Name is required.');
    errorBox.style.display = 'flex';
    return;
  }
  const priceRaw = customerVal('cbt-it-price');
  const price = priceRaw === '' || isNaN(parseFloat(priceRaw)) ? 0 : parseFloat(priceRaw);
  const list = cbtItems();
  const item = {
    id: itemNewId(list),
    name: name,
    type: type,
    description: customerVal('cbt-it-description') || name,
    price: price,
    remarks: customerVal('cbt-it-remarks')
  };
  list.unshift(item);
  customerWrite(ITEMS_KEY, list);
  closeModal('cbt-item-modal');
  if (cbtItemTarget === 'trb') {
    trbRows.push({ itemName: item.name, itemDesc: item.description, quantity: 1, price: item.price, priority: trbRows.length + 1, remarks: item.remarks, selected: false });
    trbFillItemSelect();
    trbRenderRows();
    trbEntrySummary();
  } else {
    cbtRows.push({ itemId: String(item.id), itemName: item.name, itemDesc: item.description, quantity: 1, price: item.price, priority: cbtRows.length + 1, remarks: item.remarks, selected: false });
    cbtPageNo = Math.ceil(cbtRows.length / cbtPerPage);
    renderCbt();
  }
  showToast('Item added', 'success');
}

function cbtDownload() {
  if (!cbtRequireCustomer()) return;
  if (!cbtRows.length) {
    showToast('No items to download', 'error');
    return;
  }
  const select = document.getElementById('cbt-customer');
  const customer = select.options[select.selectedIndex].textContent;
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Item ID', 'Item Name', 'Item Desc', 'Quantity', 'Price', 'Total', 'Priority Level', 'Remarks'].map(cell).join(',')];
  cbtRows.forEach(r => lines.push([r.itemId, r.itemName, r.itemDesc, r.quantity, r.price, cbtFormat(cbtNumber(r.quantity) * cbtNumber(r.price)), r.priority, r.remarks].map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'customer_bill_template_' + customer.replace(/[^\w\-]+/g, '_') + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function cbtDeleteSelected() {
  if (!cbtRows.some(r => r.selected)) {
    showToast('No rows selected', 'error');
    return;
  }
  cbtRows = cbtRows.filter(r => !r.selected);
  renderCbt();
}

function cbtDrop(to) {
  if (cbtDragFrom === null || cbtDragFrom === to) return;
  const moved = cbtRows.splice(cbtDragFrom, 1)[0];
  cbtRows.splice(to, 0, moved);
  cbtDragFrom = null;
  renderCbt();
}

function cbtSave() {
  if (!cbtRequireCustomer()) return;
  const id = document.getElementById('cbt-customer').value;
  const store = customerRead(CBT_KEY, {});
  store[id] = cbtRows.map(r => ({
    itemId: r.itemId,
    itemName: r.itemName,
    itemDesc: r.itemDesc,
    quantity: r.quantity,
    price: r.price,
    priority: r.priority,
    remarks: r.remarks
  }));
  customerWrite(CBT_KEY, store);
  showToast('Bill template saved', 'success');
}


const ITEMS_KEY = 'telerad_items';

let itemsList = [];
let itemEditId = null;
let itemsPageNo = 1;
let itemsPerPage = 25;

function initItems() {
  itemsList = itemsMigrate(customerRead(ITEMS_KEY, []));
  itemsPageNo = 1;
  renderItems();
}

function renderItems() {
  itemsRender();
}

function itemsFiltered() {
  const term = document.getElementById('it-search-input').value.trim().toLowerCase();
  const field = document.getElementById('it-search-field').value;
  if (!term) return itemsList;
  return itemsList.filter(it => {
    if (field === 'all') {
      return [it.name, it.type, it.description, it.price, it.remarks].some(v => String(v == null ? '' : v).toLowerCase().includes(term));
    }
    return String(it[field] == null ? '' : it[field]).toLowerCase().includes(term);
  });
}

function itemsRender() {
  const body = document.getElementById('it-body');
  const rows = itemsFiltered();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / itemsPerPage));
  if (itemsPageNo > pages) itemsPageNo = pages;
  const start = (itemsPageNo - 1) * itemsPerPage;
  const end = Math.min(start + itemsPerPage, total);
  const slice = rows.slice(start, end);
  if (!slice.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-title">No items found</div></div></td></tr>';
  } else {
    body.innerHTML = slice.map(it =>
      '<tr>' +
        '<td><span style="font-weight:500;color:var(--text);">' + billEsc(it.name) + '</span></td>' +
        '<td>' + billEsc(it.type) + '</td>' +
        '<td>' + billEsc(it.description) + '</td>' +
        '<td>' + billEsc(it.price) + '</td>' +
        '<td>' + billEsc(it.remarks) + '</td>' +
        '<td><button class="btn btn-ghost btn-xs" onclick="openItemModal(' + it.id + ')">Edit</button></td>' +
      '</tr>'
    ).join('');
  }
  const box = document.getElementById('it-pagination-container');
  if (total > 10) {
    box.style.display = 'block';
    document.getElementById('it-pagination-info').textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + total + ' items';
    portalPageButtons('it-pagination-buttons', itemsPageNo, pages, 'itemsGoToPage');
  } else {
    box.style.display = 'none';
  }
}

function itemsSearch() {
  itemsPageNo = 1;
  itemsRender();
}

function itemsClearSearch() {
  document.getElementById('it-search-input').value = '';
  document.getElementById('it-search-field').value = 'all';
  itemsSearch();
}

function itemsGoToPage(page) {
  const pages = Math.ceil(itemsFiltered().length / itemsPerPage);
  if (page < 1 || page > pages) return;
  itemsPageNo = page;
  itemsRender();
}

function itemsPerPageChanged() {
  itemsPerPage = parseInt(document.getElementById('it-items-per-page').value, 10);
  itemsPageNo = 1;
  itemsRender();
}

function itemsDownload() {
  const rows = itemsFiltered();
  if (!rows.length) {
    showToast('No items to download', 'error');
    return;
  }
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Item Name', 'Item Type', 'Item Description', 'Price', 'Remarks'].map(cell).join(',')];
  rows.forEach(it => lines.push([it.name, it.type, it.description, it.price, it.remarks].map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'items.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function openItemModal(id) {
  const item = id ? itemsList.find(it => it.id === id) : null;
  itemEditId = item ? item.id : null;
  document.getElementById('it-modal-title').textContent = item ? 'Edit Item' : 'Add Item';
  document.getElementById('it-save-btn').textContent = item ? 'Update' : 'Create';
  document.getElementById('it-delete-btn').style.display = item ? 'inline-flex' : 'none';
  document.getElementById('it-name').value = item ? item.name : '';
  const typeSelect = document.getElementById('it-type');
  const types = cbtItemTypes();
  if (item && item.type && !types.some(t => t === item.type)) types.push(item.type);
  typeSelect.innerHTML = '<option value=""></option>' + types.map(t => '<option value="' + billEsc(t) + '">' + billEsc(t) + '</option>').join('');
  typeSelect.value = item ? (item.type || '') : '';
  document.getElementById('it-description').value = item ? item.description : '';
  document.getElementById('it-price').value = item ? item.price : '';
  document.getElementById('it-remarks').value = item ? item.remarks : '';
  document.getElementById('it-error').style.display = 'none';
  openModal('item-modal');
}

function saveItem() {
  const errorBox = document.getElementById('it-error');
  const name = customerVal('it-name');
  const priceRaw = customerVal('it-price');
  if (!name || priceRaw === '' || isNaN(parseFloat(priceRaw))) {
    errorBox.textContent = 'Item Name and a valid Price are required.';
    errorBox.style.display = 'flex';
    return;
  }
  const record = {
    name: name,
    type: customerVal('it-type'),
    description: customerVal('it-description') || name,
    price: parseFloat(priceRaw),
    remarks: customerVal('it-remarks')
  };
  if (itemEditId) {
    const target = itemsList.find(it => it.id === itemEditId);
    if (target) Object.assign(target, record);
    showToast('Item updated', 'success');
  } else {
    itemsList.unshift(Object.assign({ id: itemNewId(itemsList) }, record));
    showToast('Item added', 'success');
  }
  customerWrite(ITEMS_KEY, itemsList);
  closeModal('item-modal');
  itemsRender();
}

function deleteItem() {
  if (!itemEditId) return;
  openConfirm('Delete Item', 'Are you sure you want to delete this item?', () => {
    itemsList = itemsList.filter(it => it.id !== itemEditId);
    customerWrite(ITEMS_KEY, itemsList);
    closeModal('item-modal');
    itemsRender();
    showToast('Item deleted', 'success');
  });
}


const TRB_INV_KEY = 'telerad_bill_invoices';
const TRB_COL_KEY = 'telerad_bill_collections';
const TRB_SEQ_KEY = 'telerad_bill_seq';
const TRB_PAY_MODES = ['Janata TRB', 'Janata TMS', 'BRAC-J', 'AIBL-TRB', 'AIBL-TMS', 'IBBL-TRB', 'IBBL-TMS', 'DBBL-TRB', 'BKASH-34(PAYMENT)', 'BKASH-35(NAGOD)', 'BKASH-35', 'BKASH-36', 'BKASH-38', 'BKASH-39', 'MTB-S', 'MTB-M', 'CASH', 'BKASH-32'];
const TRB_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let trbInvoices = [];
let trbCollections = [];
let trbRows = [];
let trbFiles = [];
let trbTitleDirty = false;
let trbDragFrom = null;
let trbEntryReady = false;
let trbPayInvoiceId = null;
let trbEditingId = null;
let trbSaving = false;
let trbPayCollectionId = null;
let trbDueChip = true;
let trbHistChip = true;
const trbPg = { list: { n: 1, per: 25 }, due: { n: 1, per: 25 }, hist: { n: 1, per: 25 } };

function trbEl(id) {
  return document.getElementById(id);
}

function trbNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function trbRound(v) {
  return Math.round(v * 100) / 100;
}

function trbMoney(v) {
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function trbIso(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function trbCreator() {
  if (currentUser && currentUser.role === 'Admin_acc' && currentUser.full_name) return currentUser.full_name;
  return String((currentUser && currentUser.username) || 'ADMIN').toUpperCase();
}

function trbCanEnter() {
  return !!(currentUser && currentUser.role === 'Admin_acc');
}

function trbApplyEntryAccess() {
  const can = trbCanEnter();
  const grid = document.querySelector('#trb-bill-entry-page .trb-entry-grid');
  if (grid) grid.style.display = can ? '' : 'none';
  const itemGroup = trbEl('tb-item').closest('.input-group');
  if (itemGroup) {
    itemGroup.style.display = can ? '' : 'none';
  }
  ['tb-invoice-date', 'tb-from', 'tb-to', 'tb-title'].forEach(id => {
    const el = trbEl(id);
    if (el) el.disabled = !can;
  });
}

function trbSignatureData(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = frame.data;
        for (let i = 0; i < px.length; i += 4) {
          const alpha = 255 - Math.min(px[i], px[i + 1], px[i + 2]);
          if (alpha <= 0) {
            px[i + 3] = 0;
            continue;
          }
          px[i] = Math.max(0, 255 - (255 - px[i]) * 255 / alpha);
          px[i + 1] = Math.max(0, 255 - (255 - px[i + 1]) * 255 / alpha);
          px[i + 2] = Math.max(0, 255 - (255 - px[i + 2]) * 255 / alpha);
          px[i + 3] = Math.min(px[i + 3], alpha);
        }
        ctx.putImageData(frame, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(url);
      }
    };
    img.onerror = () => resolve('');
    img.src = url;
  });
}

async function trbSignerSnapshot() {
  let u = currentUser || {};
  try {
    const res = await api('/api/current-user/');
    if (res.ok) u = await res.json();
  } catch (e) {}
  return {
    username: u.username || '',
    name: u.full_name || u.username || '',
    designation: u.designation || '',
    qualification: u.qualification || '',
    cell: u.contact_number || '',
    signature: u.signature ? await trbSignatureData(u.signature) : ''
  };
}

function trbSignerLines(sg) {
  const lines = [];
  const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = t => String(t || '').split(String.fromCharCode(10)).map(l => l.trim()).filter(Boolean);
  const has = t => lines.some(l => norm(l) === norm(t));
  const name = String(sg.name || '').trim();
  const qual = parts(sg.qualification);
  if (name && !qual.some(l => norm(l) === norm(name))) lines.push(name);
  qual.forEach(l => { if (!has(l)) lines.push(l); });
  parts(sg.designation).forEach(l => { if (!has(l)) lines.push(l); });
  if (!lines.some(l => norm(l).indexOf('teleradbangladesh') !== -1)) lines.push('Telerad Bangladesh Ltd.');
  const cell = String(sg.cell || '').trim();
  const cellDigits = cell.replace(/[^0-9]/g, '');
  if (cell && !lines.some(l => cellDigits && l.replace(/[^0-9]/g, '').indexOf(cellDigits) !== -1)) lines.push('Cell: ' + cell);
  return lines;
}

function trbLoad() {
  trbInvoices = customerRead(TRB_INV_KEY, []);
  trbCollections = customerRead(TRB_COL_KEY, []);
  customerList = customerRead(CUSTOMER_STORE_KEY, []);
  itemsList = customerRead(ITEMS_KEY, []);
}

function trbPersist() {
  customerWrite(TRB_INV_KEY, trbInvoices);
  customerWrite(TRB_COL_KEY, trbCollections);
  customerWrite(CUSTOMER_STORE_KEY, customerList);
}

function trbRecalc(inv) {
  const cols = trbCollections.filter(c => c.invoiceId === inv.id);
  inv.extra = trbRound(cols.reduce((a, c) => a + trbNum(c.extraDiscount), 0));
  inv.net = trbRound(trbNum(inv.subTotal) - trbNum(inv.discount) - inv.extra);
  inv.paid = trbRound(cols.reduce((a, c) => a + trbNum(c.paid), 0));
  inv.due = Math.max(0, trbRound(inv.net - inv.paid));
}

function trbSyncCustomers() {
  customerList.forEach(c => {
    c.due = trbRound(trbInvoices.filter(i => i.customerId === c.id).reduce((a, i) => a + trbNum(i.due), 0));
  });
}

function trbFillPayModes(id, withDue) {
  const el = trbEl(id);
  const modes = withDue ? ['DUE'].concat(TRB_PAY_MODES) : TRB_PAY_MODES;
  el.innerHTML = modes.map(m => '<option value="' + m + '">' + m + '</option>').join('');
}

function trbAutoTitle() {
  if (trbTitleDirty) return;
  const f = trbEl('tb-from').value;
  const t = trbEl('tb-to').value;
  if (!t) {
    trbEl('tb-title').value = '';
    return;
  }
  const td = new Date(t + 'T00:00:00');
  let title = 'Billing Invoice - ' + TRB_MONTHS[td.getMonth()] + ' ' + td.getFullYear();
  if (f) {
    const fd = new Date(f + 'T00:00:00');
    if (fd.getMonth() !== td.getMonth() || fd.getFullYear() !== td.getFullYear()) {
      title = 'Billing Invoice - ' + TRB_MONTHS[fd.getMonth()] + ' to ' + TRB_MONTHS[td.getMonth()] + ' ' + td.getFullYear();
    }
  }
  trbEl('tb-title').value = title;
}

function initTrbEntry() {
  trbLoad();
  const sel = trbEl('tb-customer');
  const prev = sel.value;
  const sorted = customerList.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  sel.innerHTML = '<option value="">Select Customer</option>' +
    sorted.map(c => '<option value="' + c.id + '">' + billEsc(c.name) + '</option>').join('');
  if (prev && sorted.some(c => String(c.id) === prev)) sel.value = prev;
  trbFillItemSelect();
  if (!trbEntryReady) {
    const now = new Date();
    trbEl('tb-invoice-date').value = trbIso(now);
    trbEl('tb-from').value = trbIso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    trbEl('tb-to').value = trbIso(new Date(now.getFullYear(), now.getMonth(), 0));
    trbFillPayModes('tb-paymode', true);
    trbTitleDirty = false;
    trbAutoTitle();
    trbEntryReady = true;
  }
  trbRefreshEntryInfo();
  trbRenderRows();
  trbEntrySummary();
  trbRenderEntryInvoices();
  trbApplyEntryAccess();
  trbSetEditMode(!!trbEditingId);
}

function trbSelectedCustomer() {
  const id = trbEl('tb-customer').value;
  return id ? customerList.find(c => String(c.id) === id) : null;
}

function trbRefreshEntryInfo() {
  const c = trbSelectedCustomer();
  trbEl('tb-contact').value = c ? (c.responsibleContract || '') : '';
  trbEl('tb-predue').value = c ? trbMoney(c.due) : '';
}

function trbTemplateRows(customerId) {
  const store = customerRead(CBT_KEY, {});
  return (store[customerId] || []).map(r => ({
    itemName: r.itemName, itemDesc: r.itemDesc, quantity: r.quantity, price: r.price,
    priority: r.priority, remarks: r.remarks, selected: false
  }));
}

function trbCustomerPicked() {
  const c = trbSelectedCustomer();
  trbRows = c ? trbTemplateRows(c.id) : [];
  trbRefreshEntryInfo();
  trbRenderRows();
  trbEntrySummary();
  trbRenderEntryInvoices();
}

function trbResetRows() {
  const c = trbSelectedCustomer();
  trbRows = c ? trbTemplateRows(c.id) : [];
  trbRenderRows();
  trbEntrySummary();
}

function trbRowTotal(r) {
  return trbRound(trbNum(r.quantity) * trbNum(r.price));
}

function trbRenderRows() {
  const body = trbEl('trb-rows-body');
  const term = trbEl('tb-grid-search').value.trim().toLowerCase();
  const shown = [];
  trbRows.forEach((r, i) => {
    if (!term || [r.itemName, r.itemDesc, r.quantity, r.price, r.priority, r.remarks].some(v => String(v == null ? '' : v).toLowerCase().includes(term))) shown.push(i);
  });
  if (!shown.length) {
    body.innerHTML = '<tr><td colspan="10"><div class="empty-state"><div class="empty-title">No items</div></div></td></tr>';
  } else {
    body.innerHTML = shown.map(i => {
      const r = trbRows[i];
      const hasTotal = trbNum(r.quantity) > 0;
      return '<tr class="' + (r.selected ? 'trb-sel' : '') + '" ondragover="event.preventDefault()" ondrop="trbDrop(' + i + ')" ondragstart="trbDragFrom=' + i + '" ondragend="this.draggable=false">' +
        '<td><input type="checkbox" ' + (r.selected ? 'checked' : '') + ' onchange="trbRowSelect(' + i + ', this.checked)" /></td>' +
        '<td><span class="trb-handle" onmousedown="this.closest(\'tr\').draggable=true" onmouseup="this.closest(\'tr\').draggable=false">&#8801;</span></td>' +
        '<td><input type="text" data-i="' + i + '" data-f="itemName" value="' + billEsc(r.itemName) + '" oninput="trbEdit(this)" /></td>' +
        '<td><input type="text" data-i="' + i + '" data-f="itemDesc" value="' + billEsc(r.itemDesc) + '" oninput="trbEdit(this)" /></td>' +
        '<td><input type="number" step="any" class="trb-num" data-i="' + i + '" data-f="quantity" value="' + billEsc(r.quantity) + '" oninput="trbEdit(this)" /></td>' +
        '<td><input type="number" step="any" class="trb-num" data-i="' + i + '" data-f="price" value="' + billEsc(r.price) + '" oninput="trbEdit(this)" /></td>' +
        '<td class="trb-totalcell" id="trb-total-' + i + '">' + (hasTotal ? trbRowTotal(r) : '') + '</td>' +
        '<td><input type="number" step="1" class="trb-num" data-i="' + i + '" data-f="priority" value="' + billEsc(r.priority) + '" oninput="trbEdit(this)" /></td>' +
        '<td><input type="text" data-i="' + i + '" data-f="remarks" value="' + billEsc(r.remarks) + '" oninput="trbEdit(this)" /></td>' +
        '<td><button type="button" class="btn btn-danger btn-xs" onclick="trbRemoveRow(' + i + ')">Remove</button></td>' +
      '</tr>';
    }).join('');
  }
  trbUpdateRowFooter();
}

function trbUpdateRowFooter() {
  const count = trbRows.filter(r => r.selected).length;
  trbEl('tb-selected-count').textContent = count + ' rows selected';
  trbEl('tb-row-total').textContent = 'Total ' + trbRows.length;
  trbEl('tb-check-all').checked = trbRows.length > 0 && count === trbRows.length;
}

function trbEdit(el) {
  const i = parseInt(el.dataset.i, 10);
  const field = el.dataset.f;
  trbRows[i][field] = el.value;
  if (field === 'quantity' || field === 'price') {
    const cell = trbEl('trb-total-' + i);
    if (cell) cell.textContent = trbNum(trbRows[i].quantity) > 0 ? trbRowTotal(trbRows[i]) : '';
    trbEntrySummary();
  }
}

function trbRowSelect(i, checked) {
  trbRows[i].selected = checked;
  const tr = trbEl('trb-rows-body').querySelector('input[type=checkbox][onchange*="trbRowSelect(' + i + ',"]');
  if (tr) tr.closest('tr').classList.toggle('trb-sel', checked);
  trbUpdateRowFooter();
}

function trbSelectAll(checked) {
  trbRows.forEach(r => { r.selected = checked; });
  trbRenderRows();
}

function trbRemoveRow(i) {
  trbRows.splice(i, 1);
  trbRenderRows();
  trbEntrySummary();
}

function trbDrop(to) {
  if (trbDragFrom === null || trbDragFrom === to) return;
  const moved = trbRows.splice(trbDragFrom, 1)[0];
  trbRows.splice(to, 0, moved);
  trbDragFrom = null;
  trbRows.forEach((r, i) => { r.priority = i + 1; });
  trbRenderRows();
}

function trbFillItemSelect() {
  const select = trbEl('tb-item');
  select.innerHTML = '<option value="">Select an item</option>' +
    cbtItems().map(it => '<option value="' + it.id + '">' + billEsc(it.name) + '</option>').join('');
  select.value = '';
}

function trbPickItem(value) {
  if (!value) return;
  const item = cbtItems().find(it => String(it.id) === String(value));
  trbEl('tb-item').value = '';
  if (!item) return;
  trbRows.push({
    itemName: item.name,
    itemDesc: item.description || item.name,
    quantity: 1,
    price: item.price,
    priority: trbRows.length + 1,
    remarks: '',
    selected: false
  });
  trbRenderRows();
  trbEntrySummary();
}

function trbOpenItemForm() {
  cbtItemTarget = 'trb';
  cbtOpenItemForm();
}

function trbEntrySummary() {
  const sub = trbRound(trbRows.reduce((a, r) => a + trbRowTotal(r), 0));
  const discount = trbNum(trbEl('tb-discount').value);
  const net = trbRound(sub - discount);
  const paid = trbNum(trbEl('tb-paid').value);
  trbEl('tb-subtotal').value = trbMoney(sub);
  trbEl('tb-net').value = trbMoney(net);
  trbEl('tb-due').value = trbMoney(Math.max(0, trbRound(net - paid)));
}

function trbFilesPicked(input) {
  trbFiles = Array.from(input.files).map(f => f.name);
  if (trbFiles.length) showToast(trbFiles.length + ' file(s) attached', 'success');
}

function trbSetEditMode(on) {
  const can = trbCanEnter();
  const show = (id, visible) => { const el = trbEl(id); if (el) el.style.display = visible ? '' : 'none'; };
  show('tb-btn-save', can && !on);
  show('tb-btn-save-print', can && !on);
  show('tb-btn-save-download', can && !on);
  show('tb-btn-update', can && on);
  show('tb-btn-delete', can && on);
}

function trbDeleteBill() {
  if (!trbCanEnter()) {
    showToast('Only Admin_acc users can change bills', 'error');
    return;
  }
  const inv = trbEditingId ? trbFindInvoice(trbEditingId) : null;
  if (!inv) return;
  if (!confirm('Delete invoice ' + inv.no + '? Its payments will be deleted too.')) return;
  trbInvoices = trbInvoices.filter(i => i.id !== inv.id);
  trbCollections = trbCollections.filter(c => c.invoiceId !== inv.id);
  trbSyncCustomers();
  trbPersist();
  trbClearEntry();
  trbRefreshAll();
  showToast('Invoice ' + inv.no + ' deleted', 'success');
}

function trbClearEntry() {
  const now = new Date();
  trbEditingId = null;
  trbSetEditMode(false);
  trbRows = [];
  trbFiles = [];
  trbEl('tb-files').value = '';
  trbEl('tb-customer').value = '';
  trbEl('tb-invoice-date').value = trbIso(now);
  trbEl('tb-from').value = trbIso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  trbEl('tb-to').value = trbIso(new Date(now.getFullYear(), now.getMonth(), 0));
  trbTitleDirty = false;
  trbAutoTitle();
  trbEl('tb-discount').value = '';
  trbEl('tb-paid').value = '';
  trbEl('tb-paymode').value = 'DUE';
  trbEl('tb-grid-search').value = '';
  trbEl('tb-item').value = '';
  trbRefreshEntryInfo();
  trbRenderRows();
  trbEntrySummary();
  trbRenderEntryInvoices();
}

function trbRenderEntryInvoices() {
  const c = trbSelectedCustomer();
  const rows = trbInvoices
    .filter(i => !c || i.customerId === c.id)
    .sort((a, b) => b.id - a.id)
    .slice(0, 50);
  trbEl('tb-invoices-body').innerHTML = rows.length ? rows.map(i =>
    '<tr>' +
      '<td>' + billEsc(i.customerName) + '</td>' +
      '<td>' + billEsc(i.no) + '</td>' +
      '<td>' + billEsc(i.title) + '</td>' +
      '<td>' + billEsc(customerDate(i.invoiceDate)) + '</td>' +
      '<td>' + billEsc(customerDate(i.fromDate)) + '</td>' +
      '<td>' + billEsc(customerDate(i.toDate)) + '</td>' +
      '<td>' + billEsc(i.payMode) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.subTotal) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.discount) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.net) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.paid) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.due) + '</td>' +
      '<td>' + billEsc(i.creator) + '</td>' +
    '</tr>'
  ).join('') : '<tr><td colspan="13"><div class="empty-state"><div class="empty-title">No invoices yet</div></div></td></tr>';
  if (rows.length) {
    const sum = key => trbRound(rows.reduce((a, i) => a + trbNum(i[key]), 0));
    trbEl('tb-invoices-body').innerHTML +=
      '<tr style="font-weight:700;">' +
        '<td>Report Total:</td>' +
        '<td></td><td></td><td></td><td></td><td></td><td></td>' +
        '<td class="trb-r">' + trbMoney(sum('subTotal')) + '</td>' +
        '<td class="trb-r">' + trbMoney(sum('discount')) + '</td>' +
        '<td class="trb-r">' + trbMoney(sum('net')) + '</td>' +
        '<td class="trb-r">' + trbMoney(sum('paid')) + '</td>' +
        '<td class="trb-r">' + trbMoney(sum('due')) + '</td>' +
        '<td></td>' +
      '</tr>';
  }
}

async function trbSaveBill(after) {
  if (!trbCanEnter()) {
    showToast('Only Admin_acc users can add or submit bills', 'error');
    return;
  }
  if (trbSaving) return;
  const cust = trbSelectedCustomer();
  if (!cust) {
    showToast('Select a customer first', 'error');
    return;
  }
  const rows = trbRows.filter(r => String(r.itemName).trim() !== '');
  if (!rows.length) {
    showToast('Add at least one item', 'error');
    return;
  }
  const invoiceDate = trbEl('tb-invoice-date').value;
  const fromDate = trbEl('tb-from').value;
  const toDate = trbEl('tb-to').value;
  const title = trbEl('tb-title').value.trim();
  if (!invoiceDate || !fromDate || !toDate || !title) {
    showToast('Invoice date, billing dates and title are required', 'error');
    return;
  }
  const sub = trbRound(rows.reduce((a, r) => a + trbRowTotal(r), 0));
  const discount = trbNum(trbEl('tb-discount').value);
  if (discount < 0 || discount > sub) {
    showToast('Discount is not valid', 'error');
    return;
  }
  const net = trbRound(sub - discount);
  const paid = trbNum(trbEl('tb-paid').value);
  const payMode = trbEl('tb-paymode').value;
  if (paid < 0 || paid > net) {
    showToast('Paid amount is not valid', 'error');
    return;
  }
  if (paid > 0 && payMode === 'DUE') {
    showToast('Select a payment mode for the paid amount', 'error');
    return;
  }
  trbSaving = true;
  let signer;
  try {
    signer = await trbSignerSnapshot();
  } finally {
    trbSaving = false;
  }
  const seqs = customerRead(TRB_SEQ_KEY, {});
  const fields = {
    customerId: cust.id,
    customerName: cust.name,
    accountId: cust.code || '',
    contact: cust.responsibleContract || '',
    title: title,
    invoiceDate: invoiceDate,
    fromDate: fromDate,
    toDate: toDate,
    payMode: payMode,
    subTotal: sub,
    discount: discount,
    files: trbFiles.slice(),
    signer: signer,
    rows: rows.map(r => ({ itemName: r.itemName, itemDesc: r.itemDesc, quantity: trbNum(r.quantity), price: trbNum(r.price), total: trbRowTotal(r), priority: r.priority, remarks: r.remarks }))
  };
  let inv = trbEditingId ? trbFindInvoice(trbEditingId) : null;
  const updating = !!inv;
  if (updating) {
    Object.assign(inv, fields);
  } else {
    const d = new Date(invoiceDate + 'T00:00:00');
    const ym = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
    seqs[ym] = (seqs[ym] || 0) + 1;
    inv = Object.assign({
      id: Date.now(),
      no: ym + String(seqs[ym]).padStart(5, '0'),
      vat: 0,
      extra: 0,
      net: net,
      paid: 0,
      due: net,
      creator: trbCreator(),
      remarks: ''
    }, fields);
    trbInvoices.push(inv);
  }
  if (paid > 0) {
    const sl = trbCollections.reduce((m, c) => Math.max(m, c.sl || 0), 0) + 1;
    trbCollections.push({ id: Date.now() + 1, sl: sl, invoiceId: inv.id, type: 'Bill Payment', paid: paid, extraDiscount: 0, payMode: payMode, date: trbIso(new Date()), remarks: '', creator: trbCreator() });
  }
  trbRecalc(inv);
  trbSyncCustomers();
  trbPersist();
  customerWrite(TRB_SEQ_KEY, seqs);
  trbEditingId = null;
  trbSetEditMode(false);
  showToast('Invoice ' + inv.no + (updating ? ' updated' : ' saved'), 'success');
  trbEl('tb-discount').value = '';
  trbEl('tb-paid').value = '';
  trbEl('tb-paymode').value = 'DUE';
  trbFiles = [];
  trbEl('tb-files').value = '';
  trbRows = trbTemplateRows(cust.id);
  trbRefreshEntryInfo();
  trbRenderRows();
  trbEntrySummary();
  trbRenderEntryInvoices();
  if (after === 'print') trbPrintInvoice(inv.id);
  if (after === 'download') trbDownloadInvoice(inv.id);
}

function trbInvoiceHtml(inv) {
  const lines = (inv.rows || []).map((r, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + billEsc(r.itemName) + '</td><td>' + billEsc(r.itemDesc) + '</td>' +
    '<td class="r">' + billEsc(r.quantity) + '</td><td class="r">' + trbMoney(r.price) + '</td><td class="r">' + trbMoney(r.total) + '</td></tr>'
  ).join('');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ' + billEsc(inv.no) + '</title>' +
    '<style>body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:4px 0 18px}' +
    '.meta{display:flex;justify-content:space-between;margin-bottom:18px;line-height:1.7}table{width:100%;border-collapse:collapse}' +
    'th,td{border:1px solid #999;padding:7px 9px;text-align:left}th{background:#e5e5e5}.r{text-align:right}' +
    '.sum{width:300px;margin:18px 0 0 auto}.sum td{border:none;padding:4px 0}.sum td:last-child{text-align:right}</style></head><body>' +
    '<h1>Telerad Bangladesh Ltd.</h1><h2>' + billEsc(inv.title) + '</h2>' +
    '<div class="meta"><div><b>Customer:</b> ' + billEsc(inv.customerName) + '<br><b>Contact:</b> ' + billEsc(inv.contact) + '</div>' +
    '<div><b>Invoice No:</b> ' + billEsc(inv.no) + '<br><b>Invoice Date:</b> ' + billEsc(customerDate(inv.invoiceDate)) + '<br><b>Billing Period:</b> ' + billEsc(customerDate(inv.fromDate)) + ' - ' + billEsc(customerDate(inv.toDate)) + '</div></div>' +
    '<table><thead><tr><th>#</th><th>Item Name</th><th>Item Description</th><th class="r">Quantity</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>' + lines + '</tbody></table>' +
    '<table class="sum"><tr><td>Sub Total</td><td>' + trbMoney(inv.subTotal) + '</td></tr><tr><td>Discount</td><td>' + trbMoney(inv.discount) + '</td></tr>' +
    '<tr><td>Extra Discount</td><td>' + trbMoney(inv.extra) + '</td></tr><tr><td><b>Net Amount</b></td><td><b>' + trbMoney(inv.net) + '</b></td></tr>' +
    '<tr><td>Paid</td><td>' + trbMoney(inv.paid) + '</td></tr><tr><td><b>Due</b></td><td><b>' + trbMoney(inv.due) + '</b></td></tr></table></body></html>';
}

function trbSaveFile(name, content, type) {
  const blob = new Blob([content], { type: type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function trbFindInvoice(id) {
  return trbInvoices.find(i => i.id === id);
}

const TRB_LIBS = {
  html2canvas: { test: () => window.html2canvas, src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' },
  jspdf: { test: () => window.jspdf && window.jspdf.jsPDF, src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' },
  xlsx: { test: () => window.XLSX, src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' }
};

function trbLoadLib(key) {
  const lib = TRB_LIBS[key];
  return new Promise((resolve, reject) => {
    if (lib.test()) return resolve();
    const s = document.createElement('script');
    s.src = lib.src;
    s.onload = () => (lib.test() ? resolve() : reject(new Error('Library not ready')));
    s.onerror = () => reject(new Error('Library could not be loaded'));
    document.head.appendChild(s);
  });
}

function trbImageExists(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function trbInvoicePdfHtml(inv, hasLogo, hasSign) {
  const typeOf = name => {
    const it = itemsList.find(x => String(x.name) === String(name));
    return it && it.type ? it.type : '';
  };
  const cust = customerList.find(c => String(c.id) === String(inv.customerId)) || {};
  const groups = [];
  (inv.rows || []).forEach(r => {
    const t = typeOf(r.itemName);
    let g = groups.find(x => x.type === t);
    if (!g) {
      g = { type: t, rows: [] };
      groups.push(g);
    }
    g.rows.push(r);
  });
  const sg = inv.signer || null;
  const signImg = sg
    ? (sg.signature ? '<img src="' + billEsc(sg.signature) + '" style="display:block;max-height:56px;max-width:112px;width:auto;height:auto;margin:2px 0 0 8px;" />' : '')
    : (hasSign ? '<img src="/static/telerad_signature.png" style="display:block;height:56px;width:auto;margin:2px 0 0 8px;" />' : '');
  const signText = sg
    ? trbSignerLines(sg).map(l => billEsc(l)).concat('Date: ' + billEsc(customerDate(inv.invoiceDate))).join('<br>')
    : 'Md Mehedi Hasan Khan<br>Assistant Manager- Accounts &amp; Finance<br>Telerad Bangladesh Ltd.<br>Cell: 01716-302100<br>Date: ' + billEsc(customerDate(inv.invoiceDate));
  const serif = "'Times New Roman','Liberation Serif',Times,serif";
  const bangla = "'Nirmala UI','Noto Sans Bengali','Vrinda','Siyam Rupali',sans-serif";
  const ln = '1px solid #000';
  const pad = 'box-sizing:border-box;padding:3px 8px;line-height:14px;';
  const cell = pad + 'border-right:' + ln + ';border-bottom:' + ln + ';';
  const headCell = 'box-sizing:border-box;padding:4px 8px;line-height:15px;border-right:' + ln + ';border-bottom:' + ln + ';text-align:center;font-weight:bold;';
  const tbl = 'table-layout:fixed;width:736px;border-collapse:separate;border-spacing:0;border-top:' + ln + ';border-left:' + ln + ';';
  const sideRow = (label, value, bold, last) =>
    '<tr><td colspan="4" style="' + pad + 'border-right:' + ln + ';' + (last ? 'border-bottom:' + ln + ';' : '') + 'text-align:right;' + (bold ? 'font-weight:bold;' : '') + '">' + label + '</td>' +
    '<td style="' + cell + 'text-align:right;' + (bold ? 'font-weight:bold;' : '') + '">' + trbMoney(value) + '</td></tr>';
  let sl = 0;
  const body = groups.map(g =>
    (g.type ? '<tr><td colspan="5" style="' + cell + 'text-align:center;font-weight:bold;">' + billEsc(g.type) + '</td></tr>' : '') +
    g.rows.map(r => {
      sl += 1;
      return '<tr><td style="' + cell + 'text-align:center;">' + sl + '</td>' +
        '<td style="' + cell + '">' + billEsc(r.itemName) + '</td>' +
        '<td style="' + cell + 'text-align:center;">' + billEsc(r.quantity) + '</td>' +
        '<td style="' + cell + 'text-align:center;">' + trbMoney(r.price) + '</td>' +
        '<td style="' + cell + 'text-align:right;">' + trbMoney(r.total) + '</td></tr>';
    }).join('')
  ).join('');
  const paidInFull = !(inv.due > 0);
  const mark = paidInFull ? 'PAID' : 'DUE';
  const markColor = paidInFull ? '#e1f3e7' : '#ffe5e5';
  const infoCell = 'box-sizing:border-box;padding:4px 5px;line-height:15px;font-weight:bold;letter-spacing:0.78px;text-align:center;border-bottom:' + ln + ';';
  const boxCell = 'box-sizing:border-box;padding:5px 5px 4px;line-height:16px;font-weight:bold;vertical-align:top;';
  const boxCell2 = 'box-sizing:border-box;padding:6px 5px 4px;line-height:13.3px;font-weight:bold;vertical-align:top;';
  const bankCell = 'box-sizing:border-box;padding:1px 6px;line-height:18.8px;vertical-align:top;border-right:' + ln + ';border-bottom:' + ln + ';';
  const bankNo = 'box-sizing:border-box;padding:1px 2px;line-height:18.8px;text-align:center;vertical-align:middle;font-weight:bold;border-right:' + ln + ';border-bottom:' + ln + ';';
  return '<div style="position:relative;z-index:0;width:794px;min-height:1122px;box-sizing:border-box;padding:25px 29px 40px;background:#fff;color:#000;font-family:' + serif + ';font-size:13.33px;line-height:15px;overflow:hidden;">' +
    '<div style="position:absolute;z-index:-1;left:144px;top:524px;width:544px;height:204px;line-height:204px;text-align:center;font-size:177px;color:' + markColor + ';transform:rotate(-45deg);transform-origin:50% 50%;white-space:nowrap;">' + mark + '</div>' +
    '<div style="position:relative;">' +
      (hasLogo ? '<img src="/static/teleradlogo.png" style="position:absolute;left:76px;top:6px;height:88px;width:auto;" />' : '') +
      '<div style="padding-left:189px;text-align:left;">' +
        '<div style="font-size:21.33px;line-height:23px;font-weight:bold;">Telerad Bangladesh Ltd.</div>' +
        '<div style="margin-top:15px;line-height:16.7px;">Afza Tower, Flat # 5/A, 27/F, Sangsad Avenue, Monipuri Para, Tejgaon, Dhaka-1215</div>' +
        '<div style="line-height:16.7px;">Govt. Reg. No . C-124093/2015</div>' +
        '<div style="line-height:16.7px;font-weight:bold;">Hotline No- 01979797234-35; 01730716541-42; Accounts Contact No-01940333381</div>' +
        '<div style="line-height:16.7px;">E-mail: info@teleradbangladesh.com, web: www.teleradbangladesh.com</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin:7.5px 0 11.5px;text-align:center;font-size:16px;line-height:17px;font-weight:bold;">' + billEsc(inv.title) + '</div>' +
    '<table style="table-layout:fixed;width:736px;border-collapse:separate;border-spacing:0;border-top:' + ln + ';border-left:' + ln + ';border-right:' + ln + ';">' +
      '<colgroup><col style="width:253px;"><col style="width:230px;"><col style="width:253px;"></colgroup>' +
      '<tr><td style="' + infoCell + '">Billing Invoice: ' + billEsc(inv.no) + '</td>' +
      '<td style="' + infoCell + '">From Date: ' + billEsc(customerDate(inv.fromDate)) + '</td>' +
      '<td style="' + infoCell + '">To Date: ' + billEsc(customerDate(inv.toDate)) + '</td></tr>' +
      '<tr><td colspan="3" style="box-sizing:border-box;padding:9px 8px;line-height:17px;text-align:center;font-weight:bold;font-size:16px;background:#d9d9d9;border-bottom:' + ln + ';">Customer Information</td></tr>' +
    '</table>' +
    '<table style="table-layout:fixed;width:736px;border-collapse:separate;border-spacing:0;border-left:' + ln + ';border-right:' + ln + ';border-bottom:' + ln + ';">' +
      '<colgroup><col style="width:368px;"><col style="width:368px;"></colgroup>' +
      '<tr><td style="' + boxCell + 'border-right:' + ln + ';">Name: ' + billEsc(inv.customerName) + '</td>' +
      '<td style="' + boxCell + '">Contact No: ' + billEsc(inv.contact || '') + '</td></tr>' +
      '<tr><td style="' + boxCell2 + 'border-right:' + ln + ';">Address: ' + billEsc(cust.address || '') + '</td>' +
      '<td style="' + boxCell2 + '">Email: ' + billEsc(cust.email || '') + '</td></tr>' +
    '</table>' +
    '<table style="' + tbl + 'margin-top:10px;">' +
      '<colgroup><col style="width:52px;"><col style="width:268px;"><col style="width:106px;"><col style="width:164px;"><col style="width:146px;"></colgroup>' +
      '<tr><td style="' + headCell + '">SL.</td><td style="' + headCell + '">Items Description</td><td style="' + headCell + '">Quantity</td><td style="' + headCell + '">Unit Price(TK)</td><td style="' + headCell + '">Amount(TK)</td></tr>' +
      body +
      sideRow('Total', inv.subTotal, true) +
      sideRow('Total Due', inv.due, true) +
      sideRow('Discount', trbRound(trbNum(inv.discount) + trbNum(inv.extra)), false) +
      sideRow('Gross Amount', inv.net, false) +
      sideRow('Paid', inv.paid, false, true) +
    '</table>' +
    '<div style="margin-top:12px;height:52px;line-height:26px;text-align:center;white-space:nowrap;color:#079d2a;font-weight:bold;font-size:13.25px;font-family:' + bangla + ';">* নিরবিচ্ছিন্ন সেবার জন্য প্রত্যেক মাসের ১৫ তারিখের মধ্যে অবশ্যই বিল পরিশোধ করার জন্য বিনীতভাবে অনুরোধ করা<br>হলো। *</div>' +
    '<div data-tail="1">' +
      '<div style="margin:29px 0 0 0;width:120px;height:60px;border-bottom:1px solid #ececec;box-sizing:content-box;">' + signImg + '</div>' +
      '<div style="margin:5px 0 0 0;line-height:13.5px;">' + signText + '</div>' +
      '<div style="margin:26px 0 8px 0;font-size:10.5px;line-height:12px;font-weight:bold;">Please pay your bill at any of the following Bank account:</div>' +
      '<table style="' + tbl + '">' +
        '<colgroup><col style="width:33px;"><col style="width:335px;"><col style="width:34px;"><col style="width:334px;"></colgroup>' +
        '<tr><td style="' + bankNo + '">1</td>' +
        '<td style="' + bankCell + '">Name of Bank: <b>Al-Arafa Islami Bank</b><br>Account Name: <b>Telerad Bangladesh Ltd.</b><br>Account No: <b>0841020002942</b><br>Branch: <b>Panthapath Branch</b></td>' +
        '<td style="' + bankNo + '">2</td>' +
        '<td style="' + bankCell + '">Name of Bank: <b>Dutch Bangla Bank Ltd</b><br>Account Name: <b>Telerad Bangladesh Ltd</b><br>Account No: <b>2551100002816</b><br>Branch: <b>Panthapath Branch</b></td></tr>' +
        '<tr><td style="' + bankNo + '">3</td>' +
        '<td style="' + bankCell + '">Name of Bank: <b>Islami Bank Bangladesh Ltd</b><br>Account Name: <b>Telerad Bangladesh Ltd.</b><br>Account No: <b>20507140100000403</b><br>Branch: <b>Monipuripara Sub Branch</b></td>' +
        '<td style="' + bankNo + '">4</td>' +
        '<td style="' + bankCell + '">BKASH: <b>01979797234 (MERCHENT)</b><br>BKASH: <b>01979797235 (Personal)</b><br>Nagad: <b>01979797235 (MERCHENT)</b></td></tr>' +
        '<tr><td style="' + bankNo + '">5</td>' +
        '<td style="' + bankCell + '">Name of Bank: <b>Janata Bank PLC</b><br>Account Name: <b>Telerad Bangladesh Ltd.</b><br>Account No: <b>0100295277810</b><br>Branch: <b>Bangshal Road Branch (0113)</b></td>' +
        '<td style="' + bankCell + '"></td><td style="' + bankCell + '"></td></tr>' +
      '</table>' +
      '<div style="margin:8px 0 0 0;font-size:10.5px;line-height:12px;font-weight:bold;">Note: Any bank charges /fee to be bear by the customer</div>' +
    '</div>' +
  '</div>';
}

function trbPdfName(inv) {
  const name = String(inv.customerName || '').replace(/[\\/:*?"<>|,]+/g, ' ').trim().replace(/\s+/g, '_');
  return (name || 'Invoice-' + inv.no) + '.pdf';
}

async function trbBuildPdf(inv) {
  await Promise.all([trbLoadLib('html2canvas'), trbLoadLib('jspdf')]);
  const found = await Promise.all([trbImageExists('/static/teleradlogo.png'), trbImageExists('/static/telerad_signature.png')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:794px;z-index:-1;background:#fff;';
  host.innerHTML = trbInvoicePdfHtml(inv, found[0], found[1]);
  document.body.appendChild(host);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const tail = host.querySelector('[data-tail]');
    if (tail) {
      const pageH = 1122;
      const hostTop = () => host.getBoundingClientRect().top;
      const tailTop = () => tail.getBoundingClientRect().top - hostTop();
      let over = tailTop() + tail.offsetHeight + 8 - pageH;
      if (over > 0 && over <= 36) {
        const cutTop = Math.min(over, 15);
        host.firstElementChild.style.paddingTop = (25 - cutTop) + 'px';
        host.firstElementChild.style.paddingBottom = '8px';
        over -= cutTop;
        const cutSign = Math.min(Math.max(over, 0), 14);
        tail.firstElementChild.style.marginTop = (29 - cutSign) + 'px';
        over -= cutSign;
        if (over > 0) tail.previousElementSibling.style.marginTop = (12 - Math.min(over, 7)) + 'px';
      }
      const top = tailTop();
      const bottom = top + tail.offsetHeight;
      const edge = Math.floor(bottom / pageH) * pageH;
      if (bottom > pageH && top < edge) tail.style.paddingTop = (edge - top + 40) + 'px';
    }
    const canvas = await window.html2canvas(host, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794 });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pw = 210;
    const ph = 297;
    const fullH = canvas.height * pw / canvas.width;
    if (fullH <= ph) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, fullH);
    } else {
      const pagePx = Math.floor(canvas.width * ph / pw);
      for (let y = 0, p = 0; y < canvas.height; y += pagePx, p++) {
        const h = Math.min(pagePx, canvas.height - y);
        const part = document.createElement('canvas');
        part.width = canvas.width;
        part.height = h;
        part.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (p) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, h * pw / canvas.width);
      }
    }
    return pdf;
  } finally {
    host.remove();
  }
}

async function trbDownloadInvoice(id) {
  const inv = trbFindInvoice(id);
  if (!inv) return;
  showToast('Generating invoice PDF...', 'success');
  try {
    const pdf = await trbBuildPdf(inv);
    pdf.save(trbPdfName(inv));
  } catch (e) {
    showToast('Could not generate the invoice PDF. Check your internet connection and try again.', 'error');
  }
}

let trbPreviewUrl = '';
let trbPreviewName = '';

async function trbPrintInvoice(id) {
  const inv = trbFindInvoice(id);
  if (!inv) return;
  showToast('Preparing invoice...', 'success');
  try {
    const pdf = await trbBuildPdf(inv);
    if (trbPreviewUrl) URL.revokeObjectURL(trbPreviewUrl);
    trbPreviewUrl = URL.createObjectURL(pdf.output('blob'));
    trbPreviewName = trbPdfName(inv);
    trbEl('trb-prev-title').textContent = 'Bill - ' + (inv.title || inv.no).replace(/^Billing Invoice\s*-\s*/i, '');
    trbEl('trb-prev-frame').src = trbPreviewUrl + '#view=FitH&zoom=page-width&navpanes=0&pagemode=none';
    openModal('trb-preview-modal');
  } catch (e) {
    showToast('Could not generate the invoice PDF. Check your internet connection and try again.', 'error');
  }
}

function trbPreviewDownload() {
  if (!trbPreviewUrl) return;
  const link = document.createElement('a');
  link.href = trbPreviewUrl;
  link.download = trbPreviewName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function trbPreviewPrint() {
  const frame = trbEl('trb-prev-frame');
  try {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch (e) {
    window.open(trbPreviewUrl, '_blank');
  }
}

function trbClosePreview() {
  closeModal('trb-preview-modal');
  trbEl('trb-prev-frame').src = 'about:blank';
  if (trbPreviewUrl) URL.revokeObjectURL(trbPreviewUrl);
  trbPreviewUrl = '';
}

let trbExcelInvoiceId = null;
let trbExcelRaw = [];
let trbExcelName = '';

function trbOpenExcel(id) {
  if (!trbFindInvoice(id)) return;
  trbExcelInvoiceId = id;
  trbExcelRaw = [];
  trbExcelName = '';
  trbEl('trb-xl-file').value = '';
  trbEl('trb-xl-search').value = '';
  trbEl('trb-xl-actions').value = '';
  trbExcelRender();
  openModal('trb-excel-modal');
}

async function trbExcelUpload() {
  const file = trbEl('trb-xl-file').files[0];
  if (!file) {
    showToast('Choose an Excel file first', 'error');
    return;
  }
  try {
    await trbLoadLib('xlsx');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    trbExcelRaw = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    trbExcelName = file.name;
    trbExcelRender();
    showToast(trbExcelRaw.length + ' row(s) uploaded', 'success');
  } catch (e) {
    showToast('Could not read this file. Check that it is a valid Excel file and that you are online.', 'error');
  }
}

function trbExcelRender() {
  const box = trbEl('trb-xl-grid');
  const term = trbEl('trb-xl-search').value.trim().toLowerCase();
  if (!trbExcelRaw.length) {
    box.innerHTML = '<div style="text-align:center;padding:36px 0;color:var(--text3);font-size:13px;">No data to display</div>';
    return;
  }
  const heads = Object.keys(trbExcelRaw[0]);
  const rows = trbExcelRaw.filter(r => !term || heads.some(h => String(r[h]).toLowerCase().includes(term)));
  box.innerHTML = '<div class="table-container" style="max-height:260px;overflow:auto;"><table class="table"><thead><tr>' +
    heads.map(h => '<th>' + billEsc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.map(r => '<tr>' + heads.map(h => '<td>' + billEsc(r[h]) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + heads.length + '" style="text-align:center;">No matching rows</td></tr>') +
    '</tbody></table></div>';
}

function trbExcelActions(value) {
  trbEl('trb-xl-actions').value = '';
  if (value === 'clear') {
    trbExcelRaw = [];
    trbExcelName = '';
    trbEl('trb-xl-file').value = '';
    trbExcelRender();
  } else if (value === 'csv') {
    if (!trbExcelRaw.length) {
      showToast('Nothing to download', 'error');
      return;
    }
    const heads = Object.keys(trbExcelRaw[0]);
    trbCsvDownload('excel-data.csv', heads, trbExcelRaw.map(r => heads.map(h => r[h])));
  }
}

function trbExcelPick(row, names) {
  const keys = Object.keys(row);
  for (let i = 0; i < names.length; i++) {
    const k = keys.find(x => x.toLowerCase().replace(/[^a-z0-9]/g, '') === names[i]);
    if (k !== undefined) return row[k];
  }
  return '';
}

function trbExcelProcess() {
  const inv = trbFindInvoice(trbExcelInvoiceId);
  if (!inv) return;
  if (!trbExcelRaw.length) {
    showToast('Upload an Excel file first', 'error');
    return;
  }
  const rows = [];
  trbExcelRaw.forEach(r => {
    const name = String(trbExcelPick(r, ['itemname', 'item', 'name', 'itemsdescription', 'description'])).trim();
    if (!name) return;
    const item = itemsList.find(x => String(x.name).toLowerCase() === name.toLowerCase());
    const priceRaw = trbExcelPick(r, ['price', 'unitprice', 'unitpricetk', 'rate']);
    const qty = trbNum(trbExcelPick(r, ['quantity', 'qty']));
    const price = priceRaw === '' ? (item ? trbNum(item.price) : 0) : trbNum(priceRaw);
    const desc = String(trbExcelPick(r, ['itemdescription', 'itemdesc', 'desc'])).trim();
    const prio = trbExcelPick(r, ['priority', 'prioritylevel']);
    rows.push({
      itemName: item ? item.name : name,
      itemDesc: desc || (item ? item.description || item.name : name),
      quantity: qty,
      price: price,
      total: trbRound(qty * price),
      priority: prio === '' ? rows.length + 1 : prio,
      remarks: String(trbExcelPick(r, ['remarks', 'remark']))
    });
  });
  if (!rows.length) {
    showToast('No item rows found. The sheet needs an Item Name column.', 'error');
    return;
  }
  if (!confirm('Replace the items of invoice ' + inv.no + ' with ' + rows.length + ' row(s) from this sheet?')) return;
  inv.rows = rows;
  inv.subTotal = trbRound(rows.reduce((a, r) => a + r.total, 0));
  inv.excelFile = trbExcelName;
  trbRecalc(inv);
  trbSyncCustomers();
  trbPersist();
  closeModal('trb-excel-modal');
  trbRefreshAll();
  showToast('Invoice ' + inv.no + ' updated from the sheet', 'success');
}

function trbEditInvoice(id) {
  if (!trbCanEnter()) {
    showToast('Only Admin_acc users can edit bills', 'error');
    return;
  }
  const inv = trbFindInvoice(id);
  if (!inv) return;
  document.querySelector('.nav-item[data-page="trb-bill-entry"]').click();
  trbEditingId = id;
  trbSetEditMode(true);
  trbEl('tb-customer').value = String(inv.customerId);
  trbEl('tb-invoice-date').value = inv.invoiceDate;
  trbEl('tb-from').value = inv.fromDate;
  trbEl('tb-to').value = inv.toDate;
  trbTitleDirty = true;
  trbEl('tb-title').value = inv.title;
  trbEl('tb-discount').value = inv.discount || '';
  trbEl('tb-paid').value = '';
  trbEl('tb-paymode').value = 'DUE';
  trbEl('tb-grid-search').value = '';
  trbEl('tb-item').value = '';
  trbFiles = (inv.files || []).slice();
  trbRows = (inv.rows || []).map(r => ({ itemName: r.itemName, itemDesc: r.itemDesc, quantity: r.quantity, price: r.price, priority: r.priority, remarks: r.remarks, selected: false }));
  trbRefreshEntryInfo();
  trbRenderRows();
  trbEntrySummary();
  trbRenderEntryInvoices();
}

function trbCsvCell(v) {
  return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
}

function trbDownloadInvoiceCsv(id) {
  const inv = trbFindInvoice(id);
  if (!inv) return;
  const lines = [['Item Name', 'Item Description', 'Quantity', 'Price', 'Total', 'Priority Level', 'Remarks'].map(trbCsvCell).join(',')];
  (inv.rows || []).forEach(r => lines.push([r.itemName, r.itemDesc, r.quantity, r.price, r.total, r.priority, r.remarks].map(trbCsvCell).join(',')));
  trbSaveFile('Invoice-' + inv.no + '.csv', '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8;');
}

function trbCsvDownload(name, head, rows) {
  if (!rows.length) {
    showToast('Nothing to download', 'error');
    return;
  }
  const lines = [head.map(trbCsvCell).join(',')];
  rows.forEach(r => lines.push(r.map(trbCsvCell).join(',')));
  trbSaveFile(name, '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8;');
}

function trbMatch(obj, keys, field, term) {
  if (!term) return true;
  if (field === 'all') return keys.some(k => String(obj[k] == null ? '' : obj[k]).toLowerCase().includes(term));
  return String(obj[field] == null ? '' : obj[field]).toLowerCase().includes(term);
}

function trbPaginate(rows, st, prefix, handler, noun) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / st.per));
  if (st.n > pages) st.n = pages;
  const start = (st.n - 1) * st.per;
  const end = Math.min(start + st.per, total);
  const box = trbEl(prefix + '-pagination-container');
  if (total > 10) {
    box.style.display = 'block';
    trbEl(prefix + '-pagination-info').textContent = 'Showing ' + (start + 1) + '-' + end + ' of ' + total + ' ' + noun;
    portalPageButtons(prefix + '-pagination-buttons', st.n, pages, handler);
  } else {
    box.style.display = 'none';
  }
  return rows.slice(start, end);
}

function trbPageCount(rows, st) {
  return Math.max(1, Math.ceil(rows.length / st.per));
}

function trbReceiveButton(inv) {
  return inv.due > 0 ? '<button class="btn btn-danger btn-xs" onclick="trbOpenPay(' + inv.id + ')">Receive Payment</button>' : '';
}

function initTrbList() {
  trbLoad();
  trbPg.list.n = 1;
  trbRenderList();
}

function trbListFiltered() {
  const top = trbEl('trbl-search').value.trim().toLowerCase();
  const from = trbEl('trbl-from').value;
  const to = trbEl('trbl-to').value;
  const field = trbEl('trbl-field').value;
  const grid = trbEl('trbl-grid').value.trim().toLowerCase();
  return trbInvoices
    .filter(i => trbMatch(i, ['no', 'title', 'creator', 'customerName'], 'all', top))
    .filter(i => (!from || i.invoiceDate >= from) && (!to || i.invoiceDate <= to))
    .filter(i => trbMatch(i, ['no', 'customerName', 'title', 'creator', 'contact', 'remarks'], field, grid))
    .sort((a, b) => b.id - a.id);
}

function trbBillRow(i) {
  return (
    '<tr>' +
      '<td>' + billEsc(i.no) + '</td>' +
      '<td><span style="font-weight:500;color:var(--text);">' + billEsc(i.customerName) + '</span></td>' +
      '<td>' + billEsc(i.title) + '</td>' +
      '<td>' + billEsc(customerDate(i.invoiceDate)) + '</td>' +
      '<td>' + billEsc(customerDate(i.fromDate)) + '</td>' +
      '<td>' + billEsc(customerDate(i.toDate)) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.subTotal) + '</td>' +
      '<td class="trb-r">' + trbMoney(i.net) + '</td>' +
      '<td class="trb-r">' + (i.paid ? trbMoney(i.paid) : '') + '</td>' +
      '<td class="trb-r">' + trbMoney(i.due) + '</td>' +
      '<td>' + billEsc(i.contact) + '</td>' +
      '<td>' + billEsc(i.remarks) + '</td>' +
      '<td><div class="tf-actions">' +
        (trbReceiveButton(i) || '<span></span>') +
        '<button class="btn btn-ghost btn-xs" title="Download Invoice" onclick="trbDownloadInvoice(' + i.id + ')">Download Invoice</button>' +
        '<button class="btn btn-ghost btn-xs" title="Download Invoice2" onclick="trbDownloadInvoice(' + i.id + ')">Download Invoice2</button>' +
        '<button class="btn btn-ghost btn-xs" title="Due Invoice" onclick="trbPrintInvoice(' + i.id + ')">Print</button>' +
        '<button class="btn btn-ghost btn-xs" title="Excel Sheet" style="color:var(--blue);" onclick="trbOpenExcel(' + i.id + ')">Upload_<wbr>Excel_<wbr>sheet</button>' +
        '<button class="btn btn-ghost btn-xs" title="Print Invoice" onclick="trbPrintInvoice(' + i.id + ')">Print</button>' +
        '<button class="btn btn-ghost btn-xs" title="Print_1" onclick="trbPrintInvoice(' + i.id + ')">Print_1</button>' +
        '<button class="btn btn-ghost btn-xs" title="Action" style="color:var(--red);border:1px solid var(--red);" onclick="trbEditInvoice(' + i.id + ')">Edit/<wbr>Update</button>' +
      '</div></td>' +
    '</tr>'
  );
}

function trbRenderList() {
  const slice = trbPaginate(trbListFiltered(), trbPg.list, 'trbl', 'trbListGo', 'invoices');
  trbEl('trbl-body').innerHTML = slice.length ? slice.map(trbBillRow).join('') : '<tr><td colspan="13"><div class="empty-state"><div class="empty-title">No invoices found</div></div></td></tr>';
}

function trbListSearch() {
  trbPg.list.n = 1;
  trbRenderList();
}

function trbListReset() {
  ['trbl-search', 'trbl-from', 'trbl-to', 'trbl-grid'].forEach(id => { trbEl(id).value = ''; });
  trbEl('trbl-field').value = 'all';
  trbListSearch();
}

function trbListGo(page) {
  if (page < 1 || page > trbPageCount(trbListFiltered(), trbPg.list)) return;
  trbPg.list.n = page;
  trbRenderList();
}

function trbListPer() {
  trbPg.list.per = parseInt(trbEl('trbl-items-per-page').value, 10);
  trbPg.list.n = 1;
  trbRenderList();
}

function trbListDownload() {
  trbCsvDownload('bill-list.csv',
    ['Invoice No', 'Customer Name', 'Invoice Title', 'Invoice Date', 'Bill From Date', 'Bill To Date', 'Sub Total', 'Net Amount', 'Paid', 'Due', 'Responsible Contact', 'Remarks'],
    trbListFiltered().map(i => [i.no, i.customerName, i.title, i.invoiceDate, i.fromDate, i.toDate, i.subTotal, i.net, i.paid, i.due, i.contact, i.remarks]));
}

function initTrbDue() {
  trbLoad();
  trbPg.due.n = 1;
  trbRenderDueChip();
  trbRenderDue();
}

function trbRenderDueChip() {
  trbEl('trbd-chip').innerHTML = trbDueChip
    ? '<span class="trb-chip active">Due<span class="trb-chip-x" onclick="trbToggleDueChip()">&#10005;</span></span>'
    : '<button class="btn btn-ghost btn-xs" onclick="trbToggleDueChip()">+ Due</button>';
}

function trbToggleDueChip() {
  trbDueChip = !trbDueChip;
  trbRenderDueChip();
  trbDueSearch();
}

function trbDueFiltered() {
  const top = trbEl('trbd-search').value.trim().toLowerCase();
  const field = trbEl('trbd-field').value;
  const grid = trbEl('trbd-grid').value.trim().toLowerCase();
  return trbInvoices
    .filter(i => i.due > 0)
    .filter(i => trbMatch(i, ['no', 'title', 'creator', 'customerName'], 'all', top))
    .filter(i => trbMatch(i, ['customerName', 'no', 'title', 'creator', 'contact', 'remarks'], field, grid))
    .sort((a, b) => b.id - a.id);
}

function trbRenderDue() {
  const slice = trbPaginate(trbDueFiltered(), trbPg.due, 'trbd', 'trbDueGo', 'invoices');
  trbEl('trbd-body').innerHTML = slice.length ? slice.map(trbBillRow).join('') : '<tr><td colspan="13"><div class="empty-state"><div class="empty-title">No invoices found</div></div></td></tr>';
}

function trbDueSearch() {
  trbPg.due.n = 1;
  trbRenderDue();
}

function trbDueGo(page) {
  if (page < 1 || page > trbPageCount(trbDueFiltered(), trbPg.due)) return;
  trbPg.due.n = page;
  trbRenderDue();
}

function trbDuePer() {
  trbPg.due.per = parseInt(trbEl('trbd-items-per-page').value, 10);
  trbPg.due.n = 1;
  trbRenderDue();
}

function trbDueDownload() {
  trbCsvDownload('bill-due-collection.csv',
    ['Invoice No', 'Customer Name', 'Invoice Title', 'Invoice Date', 'Bill From Date', 'Bill To Date', 'Sub Total', 'Net Amount', 'Paid', 'Due', 'Responsible Contact', 'Remarks'],
    trbDueFiltered().map(i => [i.no, i.customerName, i.title, i.invoiceDate, i.fromDate, i.toDate, i.subTotal, i.net, i.paid, i.due, i.contact, i.remarks]));
}

function initTrbHistory() {
  trbLoad();
  trbPg.hist.n = 1;
  trbRenderHistChip();
  trbRenderHistory();
}

function trbRenderHistChip() {
  trbEl('trbh-chip').innerHTML = trbHistChip
    ? '<span class="trb-chip active">Paid != 0<span class="trb-chip-x" onclick="trbToggleHistChip()">&#10005;</span></span>'
    : '<button class="btn btn-ghost btn-xs" onclick="trbToggleHistChip()">+ Paid != 0</button>';
}

function trbToggleHistChip() {
  trbHistChip = !trbHistChip;
  trbRenderHistChip();
  trbHistSearch();
}

function trbHistRows() {
  return trbCollections.map(c => {
    const inv = trbFindInvoice(c.invoiceId);
    if (!inv) return null;
    return {
      id: c.id, sl: c.sl, customerName: inv.customerName, title: inv.title, accountId: inv.accountId, no: inv.no,
      type: c.type, subTotal: inv.subTotal, discount: inv.discount, extra: c.extraDiscount, net: inv.net,
      paid: c.paid, due: inv.due, payMode: c.payMode, date: c.date, remarks: c.remarks, creator: c.creator, invoiceId: inv.id
    };
  }).filter(Boolean);
}

function trbHistFiltered() {
  const field = trbEl('trbh-field').value;
  const grid = trbEl('trbh-grid').value.trim().toLowerCase();
  return trbHistRows()
    .filter(r => !trbHistChip || trbNum(r.paid) !== 0)
    .filter(r => trbMatch(r, ['sl', 'customerName', 'title', 'accountId', 'no', 'type', 'payMode', 'date', 'remarks', 'creator'], field, grid))
    .sort((a, b) => b.sl - a.sl);
}

function trbRenderHistory() {
  const slice = trbPaginate(trbHistFiltered(), trbPg.hist, 'trbh', 'trbHistGo', 'collections');
  trbEl('trbh-body').innerHTML = slice.length ? slice.map(r =>
    '<tr>' +
      '<td>' + r.sl + '</td>' +
      '<td><span style="font-weight:500;color:var(--text);">' + billEsc(r.customerName) + '</span></td>' +
      '<td>' + billEsc(r.title) + '</td>' +
      '<td>' + billEsc(r.accountId) + '</td>' +
      '<td>' + billEsc(r.no) + '</td>' +
      '<td>' + billEsc(r.type) + '</td>' +
      '<td class="trb-r">' + trbMoney(r.subTotal) + '</td>' +
      '<td class="trb-r">' + (trbNum(r.discount) ? trbMoney(r.discount) : '') + '</td>' +
      '<td class="trb-r">' + (trbNum(r.extra) ? trbMoney(r.extra) : '') + '</td>' +
      '<td class="trb-r">' + trbMoney(r.net) + '</td>' +
      '<td class="trb-r">' + trbMoney(r.paid) + '</td>' +
      '<td class="trb-r">' + trbMoney(r.due) + '</td>' +
      '<td>' + billEsc(r.payMode) + '</td>' +
      '<td>' + billEsc(customerDate(r.date)) + '</td>' +
      '<td>' + billEsc(r.remarks) + '</td>' +
      '<td>' + billEsc(r.creator) + '</td>' +
      '<td><button class="btn btn-ghost btn-xs" style="color:var(--red);border:1px solid var(--red);" onclick="trbOpenPay(' + r.invoiceId + ',' + r.id + ')">EDIT/MODIFY</button></td>' +
    '</tr>'
  ).join('') : '<tr><td colspan="17"><div class="empty-state"><div class="empty-title">No collections found</div></div></td></tr>';
}

function trbHistSearch() {
  trbPg.hist.n = 1;
  trbRenderHistory();
}

function trbHistGo(page) {
  if (page < 1 || page > trbPageCount(trbHistFiltered(), trbPg.hist)) return;
  trbPg.hist.n = page;
  trbRenderHistory();
}

function trbHistPer() {
  trbPg.hist.per = parseInt(trbEl('trbh-items-per-page').value, 10);
  trbPg.hist.n = 1;
  trbRenderHistory();
}

function trbHistDownload() {
  trbCsvDownload('bill-collection-history.csv',
    ['#SL', 'Customer Name', 'Invoice Title', 'Account ID', 'Invoice No', 'Collection Type', 'Sub Total', 'Discount', 'Extra Discount', 'Net Amount', 'Paid', 'Due', 'Payment Mode', 'Collection Date', 'Remarks', 'Creator'],
    trbHistFiltered().map(r => [r.sl, r.customerName, r.title, r.accountId, r.no, r.type, r.subTotal, r.discount, r.extra, r.net, r.paid, r.due, r.payMode, r.date, r.remarks, r.creator]));
}

function trbRefreshAll() {
  trbRenderList();
  trbRenderDue();
  trbRenderHistory();
  trbRenderEntryInvoices();
  trbRefreshEntryInfo();
}

const TRB_COLLECT_MODES = ['Janata TRB', 'Janata TMS', 'BRAC-J', 'AIBL-TRB', 'AIBL-TMS', 'IBBL-TRB', 'IBBL-TMS', 'DBBL-TRB', 'BKASH-34(PAYMENT)', 'BKASH-35(NAGOD)', 'BKASH-35', 'BKASH-36', 'BKASH-38', 'BKASH-39', 'MTB-S', 'MTB-M', 'CASH', 'BKASH-32'];
let trbPayAvailable = 0;

function trbPayCalc() {
  const extra = trbNum(trbEl('trb-pay-extra').value);
  const paid = trbNum(trbEl('trb-pay-paid').value);
  trbEl('trb-pay-remaining').value = trbMoney(Math.max(0, trbRound(trbPayAvailable - extra - paid)));
}

function trbOpenPay(invoiceId, collectionId) {
  const inv = trbFindInvoice(invoiceId);
  if (!inv) return;
  const col = collectionId ? trbCollections.find(c => c.id === collectionId) : null;
  const cust = customerList.find(c => String(c.id) === String(inv.customerId));
  trbPayInvoiceId = invoiceId;
  trbPayCollectionId = col ? col.id : null;
  trbPayAvailable = trbRound(inv.due + (col ? trbNum(col.paid) + trbNum(col.extraDiscount) : 0));
  trbEl('trb-pay-title').textContent = 'Due Collection Entry/Modify Form';
  trbEl('trb-pay-no').value = col ? (col.sl || '') : '';
  trbEl('trb-pay-invno').value = inv.no;
  trbEl('trb-pay-account').value = inv.accountId || (cust ? cust.code || '' : '');
  trbEl('trb-pay-custid').value = cust ? trbCustomerNo(cust) : '';
  trbEl('trb-pay-customer').value = inv.customerName;
  trbEl('trb-pay-prev').value = trbMoney(col ? inv.due : trbPayAvailable);
  trbEl('trb-pay-invtitle').value = inv.title || '';
  trbEl('trb-pay-remarks').value = col ? (col.remarks || '') : '';
  trbEl('trb-pay-date').value = col ? col.date : trbIso(new Date());
  trbEl('trb-pay-due').value = trbMoney(col ? inv.due : trbPayAvailable);
  trbEl('trb-pay-extra').value = col && col.extraDiscount ? col.extraDiscount : '';
  trbEl('trb-pay-paid').value = col && col.paid ? col.paid : '';
  trbEl('trb-pay-paid').style.color = col ? 'var(--green)' : '';
  trbEl('trb-pay-save').textContent = col ? 'Update' : 'Save';
  trbEl('trb-pay-delete').style.display = col ? '' : 'none';
  trbEl('trb-pay-bank').value = col && col.bankCharge ? col.bankCharge : '';
  const modes = TRB_COLLECT_MODES.slice();
  if (col && col.payMode && !modes.includes(col.payMode)) modes.push(col.payMode);
  trbEl('trb-pay-mode').innerHTML = '<option value="">Choose Payment Mode</option>' + modes.map(m => '<option value="' + billEsc(m) + '">' + billEsc(m) + '</option>').join('');
  trbEl('trb-pay-mode').value = col && col.payMode ? col.payMode : '';
  trbEl('trb-pay-status').value = col && col.connStatus ? col.connStatus : 'Active';
  trbEl('trb-pay-revby').textContent = col && col.creator ? col.creator : trbCreator();
  trbPayCalc();
  trbEl('trb-pay-error').style.display = 'none';
  openModal('trb-pay-modal');
}

function trbDeletePay() {
  const col = trbPayCollectionId ? trbCollections.find(c => c.id === trbPayCollectionId) : null;
  const inv = trbFindInvoice(trbPayInvoiceId);
  if (!col || !inv) return;
  if (!confirm('Delete payment ' + (col.sl || '') + ' of invoice ' + inv.no + '?')) return;
  trbCollections = trbCollections.filter(c => c.id !== col.id);
  trbRecalc(inv);
  trbSyncCustomers();
  trbPersist();
  closeModal('trb-pay-modal');
  trbRefreshAll();
  showToast('Payment deleted', 'success');
}

function trbSavePay() {
  const errorBox = trbEl('trb-pay-error');
  const inv = trbFindInvoice(trbPayInvoiceId);
  if (!inv) return;
  const col = trbPayCollectionId ? trbCollections.find(c => c.id === trbPayCollectionId) : null;
  const paid = trbNum(trbEl('trb-pay-paid').value);
  const extra = trbNum(trbEl('trb-pay-extra').value);
  const bank = trbNum(trbEl('trb-pay-bank').value);
  const date = trbEl('trb-pay-date').value;
  const mode = trbEl('trb-pay-mode').value;
  const fail = msg => {
    errorBox.textContent = msg;
    errorBox.style.display = 'flex';
  };
  if (paid < 0 || extra < 0 || bank < 0 || (paid <= 0 && extra <= 0)) return fail('Enter a paid amount or an extra discount.');
  if (!date) return fail('Collection date is required.');
  if (!mode) return fail('Choose a payment mode.');
  if (trbRound(paid + extra) > trbPayAvailable) return fail('Amount is more than the due of ' + trbMoney(trbPayAvailable) + '.');
  const record = { paid: paid, extraDiscount: extra, bankCharge: bank, payMode: mode, connStatus: trbEl('trb-pay-status').value, date: date, remarks: trbEl('trb-pay-remarks').value.trim() };
  if (col) {
    Object.assign(col, record);
  } else {
    const sl = trbCollections.reduce((m, c) => Math.max(m, c.sl || 0), 0) + 1;
    trbCollections.push(Object.assign({ id: Date.now(), sl: sl, invoiceId: inv.id, type: 'Due Payment', creator: trbCreator() }, record));
  }
  trbRecalc(inv);
  trbSyncCustomers();
  trbPersist();
  closeModal('trb-pay-modal');
  trbRefreshAll();
  showToast(col ? 'Collection updated' : 'Payment received', 'success');
}


const MSG_KEY = 'telerad_messages';

trbPg.bsp = { n: 1, per: 25 };

function trbMonthRange(offset) {
  const now = new Date();
  return {
    from: trbIso(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    to: trbIso(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))
  };
}

function trbCustomerNo(c) {
  return customerList.indexOf(c) + 1;
}

function trbLoadSynced() {
  trbLoad();
  trbSyncCustomers();
}

function initTrbDashboard() {
  trbLoadSynced();
  const build = range => {
    const inRange = d => {
      const day = String(d || '').slice(0, 10);
      return !!day && day >= range.from && day <= range.to;
    };
    const invs = trbInvoices.filter(i => inRange(i.invoiceDate));
    const collected = trbCollections
      .filter(c => inRange(c.date) && trbFindInvoice(c.invoiceId))
      .reduce((a, c) => a + trbNum(c.paid), 0);
    const monthClients = customerList.filter(c => inRange(c.connectionDate));
    return {
      invs: invs,
      sent: invs.length,
      sentTk: invs.reduce((a, i) => a + trbNum(i.subTotal), 0),
      collected: collected,
      due: invs.reduce((a, i) => a + trbNum(i.due), 0),
      fresh: monthClients,
      inactive: monthClients.filter(c => c.connectionStatus === 'Inactive').length,
      active: customerList.filter(c => c.connectionStatus === 'Active').length
    };
  };
  const last = build(trbMonthRange(-1));
  const cur = build(trbMonthRange(0));
  const row = (label, value, details) =>
    '<div class="dsh-row"><label>' + label + '</label><input type="text" class="input-text" value="' + billEsc(value) + '" readonly />' +
    (details ? '<button class="btn btn-secondary btn-sm" onclick="dashDetails(\'' + details + '\')">Details</button>' : '') + '</div>';
  trbEl('dsh-last').innerHTML =
    row('Total Bill Sent:', last.sent) +
    row('Total Bill Sent Tk', trbRound(last.sentTk)) +
    row('Total Collection', trbRound(last.collected)) +
    row('Total Due', trbRound(last.due)) +
    row('Total New Client:', last.fresh.length, 'last') +
    row('Total Inactive Client:', last.inactive);
  trbEl('dsh-this').innerHTML =
    row('Bill Sent', cur.sent) +
    row('Bill Sent Tk', trbRound(cur.sentTk)) +
    row('Collection Tk:', trbRound(cur.collected)) +
    row('Due Tk:', trbRound(cur.due)) +
    row('Total New Client:', cur.fresh.length, 'this') +
    row('Inactive Client:', cur.inactive) +
    row('Total Active Client:', cur.active);
}

const DASH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let dashRows = [];
let dashShown = [];

function dashFmt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return m[3] + '-' + DASH_MONTHS[parseInt(m[2], 10) - 1] + '-' + m[1];
}

function dashFmtUpper(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return m[3] + '/' + DASH_MONTHS[parseInt(m[2], 10) - 1].toUpperCase() + '/' + m[1];
}

function dashShowPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  trbEl(id).classList.add('active');
  window.scrollTo(0, 0);
}

function dashBackToDashboard() {
  initTrbDashboard();
  dashShowPage('trb-dashboard-page');
}

function dashBackToReport() {
  dashShowPage('dash-report-page');
}

function dashFillNames() {
  const sorted = customerList.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  trbEl('dsr-name').innerHTML = '<option value="">Select Name</option>' +
    sorted.map(c => '<option value="' + c.id + '">' + billEsc(c.name) + '</option>').join('');
}

function dashDetails(which) {
  customerList = customerRead(CUSTOMER_STORE_KEY, []);
  const range = trbMonthRange(which === 'last' ? -1 : 0);
  dashFillNames();
  trbEl('dsr-name').value = '';
  trbEl('dsr-from').value = range.from;
  trbEl('dsr-to').value = range.to;
  dashShowPage('dash-report-page');
  dashShowReport();
}

function dashRefreshReport() {
  trbEl('dsr-name').value = '';
  trbEl('dsr-from').value = '';
  trbEl('dsr-to').value = '';
  dashShown = [];
  trbEl('dsr-by').textContent = 'Bill/Income Statement By';
  trbEl('dsr-range').textContent = 'From : To :';
  trbEl('dsr-printdate').textContent = '';
  trbEl('dsr-body').innerHTML = '';
}

function dashShowReport() {
  const id = trbEl('dsr-name').value;
  const from = trbEl('dsr-from').value;
  const to = trbEl('dsr-to').value;
  if (from && to && from > to) {
    showToast('From Date cannot be after To Date', 'error');
    return;
  }
  customerList = customerRead(CUSTOMER_STORE_KEY, []);
  dashShown = customerList.filter(c => {
    if (id && String(c.id) !== id) return false;
    if (from && (!c.connectionDate || c.connectionDate < from)) return false;
    if (to && (!c.connectionDate || c.connectionDate > to)) return false;
    return true;
  }).sort((x, y) => String(x.connectionDate || '').localeCompare(String(y.connectionDate || '')));
  const picked = id ? customerList.find(c => String(c.id) === id) : null;
  trbEl('dsr-by').textContent = 'Bill/Income Statement By' + (picked ? ' ' + (picked.code || picked.name) : '');
  trbEl('dsr-range').textContent = 'From :' + dashFmt(from) + ' To :' + dashFmt(to);
  trbEl('dsr-printdate').textContent = 'Print Date: ' + dashFmt(trbIso(new Date())).toUpperCase();
  trbEl('dsr-body').innerHTML = dashShown.length ? dashShown.map((c, i) =>
    '<tr>' +
    '<td>' + (i + 1) + '</td>' +
    '<td>' + billEsc(c.code) + '</td>' +
    '<td class="dsr-left">' + billEsc(c.name) + '</td>' +
    '<td class="dsr-left">' + billEsc(c.address) + '</td>' +
    '<td>' + billEsc(c.district) + '</td>' +
    '<td>' + billEsc(c.division) + '</td>' +
    '<td>' + billEsc(c.thana) + '</td>' +
    '<td>' + billEsc(c.upazila) + '</td>' +
    '<td>' + billEsc(c.responsibleContract) + '</td>' +
    '<td>' + billEsc(c.modalities) + '</td>' +
    '<td>' + billEsc(c.serverDetails) + '</td>' +
    '<td>' + billEsc(c.pricingDetails) + '</td>' +
    '<td>' + billEsc(c.setupCharge) + '</td>' +
    '<td>' + billEsc(c.receivedBy) + '</td>' +
    '<td>' + billEsc(c.instructedBy) + '</td>' +
    '<td>' + billEsc(c.connectionBy) + '</td>' +
    '<td>' + billEsc(dashFmt(c.connectionDate)) + '</td>' +
    '<td><a class="dsr-link" onclick="dashOpenInstall(' + c.id + ')">Details</a></td>' +
    '</tr>'
  ).join('') : '<tr><td colspan="18">No clients found</td></tr>';
}

function dashOpenInstall(id) {
  const c = customerList.find(x => x.id === id);
  if (!c) return;
  const set = (key, value) => { trbEl(key).value = value || ''; };
  set('ir-id', c.code);
  set('ir-date', dashFmtUpper(c.connectionDate || c.regDate));
  set('ir-hospital', c.name);
  set('ir-address', c.address);
  set('ir-po', c.po);
  set('ir-upazila', c.upazila || c.thana);
  set('ir-dist', c.district);
  set('ir-div', c.division);
  set('ir-manager', c.responsibleContract);
  set('ir-modalities', c.modalities);
  set('ir-server', c.serverDetails);
  set('ir-pricing', c.pricingDetails);
  set('ir-setup', c.setupCharge);
  set('ir-received', c.receivedBy);
  set('ir-comments', c.remarks);
  trbEl('ir-instructed').textContent = c.instructedBy || '';
  trbEl('ir-installed').textContent = c.connectionBy || '';
  dashShowPage('dash-install-page');
}

function dashPrintFrame(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 60000);
  }, 300);
}

function dashPrintReport() {
  const css = '@page{size:A4 landscape;margin:8mm}body{margin:0;font-family:"Times New Roman",serif;color:#000}' +
    '.dsr-head{text-align:center;font-size:14px;line-height:1.5;font-weight:700}.dsr-head .dsr-co{font-size:20px}' +
    '.dsr-printdate{text-align:right;font-size:12px;margin:6px 4px 14px;font-family:Arial,sans-serif}' +
    '.dsr-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}.dsr-table th,.dsr-table td{overflow-wrap:anywhere}.dsr-table th:nth-child(1){width:3%}.dsr-table th:nth-child(2){width:4%}.dsr-table th:nth-child(3){width:11%}.dsr-table th:nth-child(4){width:9%}.dsr-table th:nth-child(5){width:5%}.dsr-table th:nth-child(6){width:5%}.dsr-table th:nth-child(7){width:5%}.dsr-table th:nth-child(8){width:5%}.dsr-table th:nth-child(9){width:11%}.dsr-table th:nth-child(10){width:5%}.dsr-table th:nth-child(11){width:5%}.dsr-table th:nth-child(12){width:5%}.dsr-table th:nth-child(13){width:4%}.dsr-table th:nth-child(14){width:4%}.dsr-table th:nth-child(15){width:5%}.dsr-table th:nth-child(16){width:4%}.dsr-table th:nth-child(17){width:6%}.dsr-table th:nth-child(18){width:4%}.dsr-table th,.dsr-table td{border:1px solid #000;padding:3px 4px;text-align:center;vertical-align:middle}' +
    '.dsr-table td.dsr-left{text-align:left}.dsr-link{color:#e11d1d}.dsr-sign{margin-top:22px;font-size:14px;font-weight:700;text-decoration:underline}';
  dashPrintFrame('<!DOCTYPE html><html><head><meta charset="utf-8"><title>New Client List</title><style>' + css + '</style></head><body>' +
    trbEl('dsr-sheet').innerHTML + '</body></html>');
}

function dashPrintInstall() {
  const val = id => billEsc(trbEl(id).value);
  const box = (label, id, tall) =>
    '<div class="f"><div class="l">' + label + '</div><div class="b' + (tall ? ' t' : '') + '">' + val(id) + '</div></div>';
  const css = '@page{size:A4 portrait;margin:14mm}body{margin:0;font-family:Arial,sans-serif;color:#000;font-size:12px}' +
    '.title{text-align:center;font-weight:700;font-size:15px;margin-bottom:22px}.row{display:flex;gap:16px}.row .f{flex:1}' +
    '.f{margin-bottom:12px}.l{font-weight:700;font-size:11px;margin-bottom:4px}.b{border:1px solid #777;padding:7px 8px;min-height:18px;white-space:pre-wrap}' +
    '.b.t{min-height:46px}.sg{display:flex;justify-content:space-between;gap:26px;margin-top:70px}.sg.two{margin-top:90px}' +
    '.s{flex:1;text-align:center;font-size:11px}.n{min-height:15px}.ln{border-top:1px dotted #000;padding-top:3px}';
  const body =
    '<div class="title">Teleradiology Installation Report</div>' +
    '<div class="row">' + box('1. Client ID:', 'ir-id') + box('2. Date:', 'ir-date') + '</div>' +
    box('3. Hospital Name:', 'ir-hospital') +
    box('4. Full Address:', 'ir-address', true) +
    '<div class="row">' + box('5. P.O -', 'ir-po') + box('Upazila:', 'ir-upazila') + box('Dist:', 'ir-dist') + box('Div:', 'ir-div') + '</div>' +
    box('6. Manager &amp; Technologist Name &amp; Phone:', 'ir-manager', true) +
    '<div class="row">' + box('7. Modalities:', 'ir-modalities') + box('8. Server Detail:', 'ir-server') + '</div>' +
    box('9. Pricing Details:', 'ir-pricing') +
    '<div class="row">' + box('10. Setup Charge Amount:', 'ir-setup') + box('11. Received By:', 'ir-received') + '</div>' +
    box('12. Comments:', 'ir-comments', true) +
    '<div class="sg"><div class="s"><div class="n">' + billEsc(trbEl('ir-instructed').textContent) + '</div><div class="ln">Instructed By</div></div>' +
    '<div class="s"><div class="n">' + billEsc(trbEl('ir-installed').textContent) + '</div><div class="ln">Installed By</div></div>' +
    '<div class="s"><div class="n"></div><div class="ln">Hospital Authority</div></div></div>' +
    '<div class="sg two"><div class="s"><div class="ln">Manager/Incharge<br>Telerad Bangladesh Ltd</div></div>' +
    '<div class="s"><div class="ln">Authority<br>Telerad Bangladesh Ltd</div></div></div>';
  dashPrintFrame('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Teleradiology Installation Report</title><style>' + css + '</style></head><body>' + body + '</body></html>');
}

function initComposeMessage() {
  trbLoad();
  const sel = trbEl('msg-customer');
  const prev = sel.value;
  const sorted = customerList.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  sel.innerHTML = '<option value="">Customer Name</option>' +
    sorted.map(c => '<option value="' + c.id + '">' + billEsc(c.name) + '</option>').join('');
  if (prev && sorted.some(c => String(c.id) === prev)) sel.value = prev;
  msgCustomerPicked();
}

function msgCustomer() {
  const id = trbEl('msg-customer').value;
  return id ? customerList.find(c => String(c.id) === id) : null;
}

function msgCustomerPicked() {
  const c = msgCustomer();
  const inv = trbEl('msg-invoice');
  const list = c ? trbInvoices.filter(i => i.customerId === c.id).sort((a, b) => b.id - a.id) : [];
  inv.innerHTML = '<option value="">Invoice ID</option>' + list.map(i => '<option value="' + i.id + '">' + billEsc(i.no) + '</option>').join('');
  msgContactTypeChanged();
}

function msgContactTypeChanged() {
  const c = msgCustomer();
  const numbers = c && trbEl('msg-contact-type').value === 'Responsible Contact'
    ? (String(c.responsibleContract || '').match(/01\d{9}/g) || [])
    : [];
  trbEl('msg-to-list').innerHTML = numbers.map(n => '<option value="' + n + '"></option>').join('');
  trbEl('msg-to').value = numbers[0] || '';
}

function msgSend() {
  const c = msgCustomer();
  const to = trbEl('msg-to').value.trim();
  const text = trbEl('msg-text').value.trim();
  const withUrl = document.querySelector('input[name="msg-url"]:checked').value;
  if (!c) {
    showToast('Select a customer first', 'error');
    return;
  }
  if (!/^01\d{9}$/.test(to)) {
    showToast('Enter a valid mobile number in Sms To', 'error');
    return;
  }
  if (!text) {
    showToast('Write a message first', 'error');
    return;
  }
  if (withUrl === 'Yes' && !trbEl('msg-invoice').value) {
    showToast('Select an invoice to attach its url', 'error');
    return;
  }
  const log = customerRead(MSG_KEY, []);
  log.unshift({
    id: Date.now(),
    customerId: c.id,
    customerName: c.name,
    invoiceId: trbEl('msg-invoice').value,
    to: to,
    text: text,
    attachedUrl: withUrl,
    creator: trbCreator(),
    sentAt: new Date().toISOString()
  });
  customerWrite(MSG_KEY, log);
  showToast('Message saved for ' + to, 'success');
  trbEl('msg-text').value = '';
}

function msgClear() {
  trbEl('msg-customer').value = '';
  msgCustomerPicked();
  trbEl('msg-to').value = '';
  trbEl('msg-text').value = '';
  document.querySelector('input[name="msg-url"][value="No"]').checked = true;
}

function initBillSendPending() {
  trbLoadSynced();
  if (!trbEl('bsp-from').value && !trbEl('bsp-to').value) {
    const range = trbMonthRange(0);
    trbEl('bsp-from').value = range.from;
    trbEl('bsp-to').value = range.to;
  }
  trbPg.bsp.n = 1;
  bspRender();
}

function bspFiltered() {
  const from = trbEl('bsp-from').value;
  const to = trbEl('bsp-to').value;
  const field = trbEl('bsp-field').value;
  const grid = trbEl('bsp-grid').value.trim().toLowerCase();
  const sent = new Set(trbInvoices
    .filter(i => (!from || i.invoiceDate >= from) && (!to || i.invoiceDate <= to))
    .map(i => i.customerId));
  return customerList
    .filter(c => !sent.has(c.id))
    .filter(c => trbMatch(c, ['code', 'name', 'division', 'district', 'thana', 'instructedBy', 'connectionBy', 'serverStatus', 'remarks'], field, grid));
}

function bspRender() {
  const slice = trbPaginate(bspFiltered(), trbPg.bsp, 'bsp', 'bspGo', 'customers');
  trbEl('bsp-body').innerHTML = slice.length ? slice.map(c =>
    '<tr>' +
      '<td>' + trbCustomerNo(c) + '</td>' +
      '<td>' + billEsc(c.code) + '</td>' +
      '<td><span style="font-weight:500;color:var(--text);">' + billEsc(c.name) + '</span></td>' +
      '<td>' + billEsc(customerDate(c.regDate)) + '</td>' +
      '<td>' + billEsc(c.address) + '</td>' +
      '<td>' + billEsc(c.division) + '</td>' +
      '<td>' + billEsc(c.district) + '</td>' +
      '<td>' + billEsc(c.thana) + '</td>' +
      '<td>' + billEsc(c.instructedBy) + '</td>' +
      '<td>' + billEsc(c.connectionBy) + '</td>' +
      '<td>' + billEsc(customerDate(c.connectionDate)) + '</td>' +
      '<td>' + statusBadge(c.connectionStatus) + '</td>' +
      '<td>' + statusBadge(c.serverStatus) + '</td>' +
      '<td>' + billEsc(c.remarks) + '</td>' +
    '</tr>'
  ).join('') : '<tr><td colspan="14"><div class="empty-state"><div class="empty-title">No pending customers</div></div></td></tr>';
}

function bspSearch() {
  trbPg.bsp.n = 1;
  bspRender();
}

function bspGo(page) {
  if (page < 1 || page > trbPageCount(bspFiltered(), trbPg.bsp)) return;
  trbPg.bsp.n = page;
  bspRender();
}

function bspPer() {
  trbPg.bsp.per = parseInt(trbEl('bsp-items-per-page').value, 10);
  trbPg.bsp.n = 1;
  bspRender();
}

function bspDownload() {
  trbCsvDownload('bill-send-pending.csv',
    ['Customer Id', 'Customer Code', 'Customer Name', 'Reg Date', 'Address', 'Division', 'District', 'Thana', 'Instructed By', 'Connection By', 'Connection Date', 'Connection Status', 'Server Status', 'Remarks'],
    bspFiltered().map(c => [trbCustomerNo(c), c.code, c.name, c.regDate, c.address, c.division, c.district, c.thana, c.instructedBy, c.connectionBy, c.connectionDate, c.connectionStatus, c.serverStatus, c.remarks]));
}

function initAmountWise() {
  trbLoadSynced();
  awShow();
}

function awRows() {
  const raw1 = trbEl('aw-amount1').value;
  const raw2 = trbEl('aw-amount2').value;
  const a1 = raw1 === '' ? 0 : trbNum(raw1);
  const a2 = raw2 === '' ? 9999999999.99 : trbNum(raw2);
  const low = Math.min(a1, a2);
  const high = Math.max(a1, a2);
  return {
    low: low,
    high: high,
    rows: customerList.filter(c => trbNum(c.due) > 0 && trbNum(c.due) >= low && trbNum(c.due) <= high).sort((a, b) => trbNum(b.due) - trbNum(a.due))
  };
}

function awShow() {
  const result = awRows();
  trbEl('aw-range').textContent = 'From: ' + trbMoney(result.low).replace(/^0\./, '.') + ' TK To: ' + trbMoney(result.high) + ' TK';
  trbEl('aw-body').innerHTML = result.rows.length ? result.rows.map((c, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + trbCustomerNo(c) + '</td><td>' + billEsc(c.name) + '</td><td class="trb-r">' + trbMoney(c.due) + '</td></tr>'
  ).join('') : '<tr><td colspan="4"><div class="empty-state"><div class="empty-title">No clients found</div></div></td></tr>';
}

function awRefresh() {
  trbEl('aw-amount1').value = '';
  trbEl('aw-amount2').value = '';
  trbLoadSynced();
  awShow();
}

function awPrint() {
  const result = awRows();
  const lines = result.rows.map((c, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + trbCustomerNo(c) + '</td><td>' + billEsc(c.name) + '</td><td class="r">' + trbMoney(c.due) + '</td></tr>'
  ).join('');
  const w = window.open('', '_blank');
  if (!w) {
    showToast('Allow pop-ups to print the report', 'error');
    return;
  }
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Amount Wise Client Report</title>' +
    '<style>body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}.c{text-align:center;line-height:1.8;margin-bottom:16px}' +
    'table{width:100%;border-collapse:collapse}th,td{border:1px solid #666;padding:6px 8px;text-align:left}.r{text-align:right}th{background:#e5e5e5}</style></head><body>' +
    '<div class="c"><b style="font-size:18px">Telerad Bangladesh Ltd.</b><br>Afza Tower, Flat # 5/A, 35/F, Sangsad Avenue, Monipuri Para, Tejgaon, Dhaka-1215<br>' +
    'Hotline No- 01979797234-35; Accounts Contact No-01940333381<br><b>' + billEsc(trbEl('aw-range').textContent) + '</b></div>' +
    '<table><thead><tr><th>SL#</th><th>Customer ID</th><th>Client Name</th><th class="r">Total Due</th></tr></thead><tbody>' + lines + '</tbody></table></body></html>');
  w.document.close();
  w.focus();
  w.print();
}

(function () {
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const panel = document.createElement('div');
  panel.className = 'ss-panel';
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'ss-search';
  search.placeholder = 'Search...';
  search.autocomplete = 'off';
  const list = document.createElement('div');
  list.className = 'ss-list';
  panel.appendChild(search);
  panel.appendChild(list);

  let current = null;
  let shown = [];
  let activeIndex = -1;

  function optionLabel(opt) {
    return opt.text && opt.text.trim() ? opt.text.trim() : 'None';
  }

  function refresh(sel) {
    const box = sel._ssBox;
    if (!box) return;
    const text = box.querySelector('.ss-text');
    const opt = sel.options[sel.selectedIndex];
    const label = opt ? opt.text.trim() : '';
    text.textContent = label;
    text.classList.toggle('ss-placeholder', !opt || opt.value === '');
    box.classList.toggle('ss-disabled', sel.disabled);
  }

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const selectedValue = nativeValue.get.call(current);
    shown = [];
    Array.prototype.forEach.call(current.options, function (opt) {
      const label = optionLabel(opt);
      if (!q || label.toLowerCase().indexOf(q) !== -1) shown.push({ value: opt.value, label: label });
    });
    list.innerHTML = '';
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'ss-empty';
      empty.textContent = 'No match found';
      list.appendChild(empty);
      activeIndex = -1;
      return;
    }
    activeIndex = shown.findIndex(function (o) { return o.value === selectedValue; });
    if (q || activeIndex < 0) activeIndex = 0;
    shown.forEach(function (o, i) {
      const row = document.createElement('div');
      row.className = 'ss-opt' + (o.value === selectedValue ? ' ss-selected' : '') + (i === activeIndex ? ' ss-active' : '');
      row.textContent = o.label;
      row.title = o.label;
      row.addEventListener('mousedown', function (e) {
        e.preventDefault();
        choose(i);
      });
      row.addEventListener('mousemove', function () {
        if (activeIndex !== i) setActive(i, false);
      });
      list.appendChild(row);
    });
  }

  function setActive(i, scroll) {
    const rows = list.querySelectorAll('.ss-opt');
    if (!rows.length) return;
    if (rows[activeIndex]) rows[activeIndex].classList.remove('ss-active');
    activeIndex = i;
    rows[i].classList.add('ss-active');
    if (scroll) rows[i].scrollIntoView({ block: 'nearest' });
  }

  function place() {
    if (!current) return;
    const rect = current._ssBox.getBoundingClientRect();
    const width = Math.max(rect.width, 200);
    panel.style.width = width + 'px';
    panel.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)) + 'px';
    const below = window.innerHeight - rect.bottom;
    const panelHeight = panel.offsetHeight;
    if (below < panelHeight + 8 && rect.top > below) {
      panel.style.top = Math.max(4, rect.top - panelHeight - 2) + 'px';
    } else {
      panel.style.top = (rect.bottom + 2) + 'px';
    }
  }

  function open(sel) {
    if (sel.disabled) return;
    if (current) close();
    current = sel;
    sel._ssBox.classList.add('ss-open');
    search.value = '';
    renderList();
    panel.classList.add('ss-show');
    place();
    search.focus();
    const active = list.querySelector('.ss-active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    if (!current) return;
    current._ssBox.classList.remove('ss-open');
    panel.classList.remove('ss-show');
    current = null;
  }

  function choose(i) {
    const sel = current;
    const item = shown[i];
    if (!sel || !item) return;
    const changed = nativeValue.get.call(sel) !== item.value;
    const box = sel._ssBox;
    close();
    sel.value = item.value;
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (box && document.body.contains(box)) box.focus();
  }

  search.addEventListener('input', function () {
    renderList();
    place();
  });

  search.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (shown.length) setActive(Math.min(activeIndex + 1, shown.length - 1), true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) setActive(Math.max(activeIndex - 1, 0), true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) choose(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const box = current && current._ssBox;
      close();
      if (box) box.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  document.addEventListener('mousedown', function (e) {
    if (!current) return;
    if (panel.contains(e.target) || current._ssBox.contains(e.target)) return;
    close();
  });

  window.addEventListener('resize', close);
  window.addEventListener('scroll', function (e) {
    if (current && !panel.contains(e.target)) close();
  }, true);

  function enhance(sel) {
    if (sel._ssBox) return;
    const box = document.createElement('div');
    box.className = 'ss-box';
    box.tabIndex = 0;
    box.setAttribute('role', 'combobox');
    box.setAttribute('aria-haspopup', 'listbox');
    box.innerHTML = '<span class="ss-text"></span><span class="ss-arrow"></span>';
    sel._ssBox = box;
    sel.classList.add('ss-native');
    sel.parentNode.insertBefore(box, sel.nextSibling);

    Object.defineProperty(sel, 'value', {
      configurable: true,
      get: function () { return nativeValue.get.call(sel); },
      set: function (v) {
        nativeValue.set.call(sel, v);
        refresh(sel);
      }
    });

    new MutationObserver(function () { refresh(sel); })
      .observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

    box.addEventListener('click', function () {
      if (current === sel) close();
      else open(sel);
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        open(sel);
      }
    });
    refresh(sel);
  }

  const fixedIds = ['dsr-name', 'tb-customer', 'tb-item', 'msg-customer', 'msg-invoice', 'msg-contact-type', 'cbt-customer', 'it-type'];

  function enhanceTable() {
    const body = document.getElementById('cbt-body');
    if (!body) return;
    body.querySelectorAll('select:not(.ss-native)').forEach(enhance);
  }

  function init() {
    document.body.appendChild(panel);
    fixedIds.forEach(function (id) {
      const sel = document.getElementById(id);
      if (sel) enhance(sel);
    });
    const body = document.getElementById('cbt-body');
    if (body) {
      enhanceTable();
      new MutationObserver(enhanceTable).observe(body, { childList: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

function navGroupOf(item) {
  if (item.dataset.group) return item.dataset.group;
  const fold = item.closest('.nav-fold[data-group]');
  return fold ? fold.dataset.group : null;
}

function setNavGroup(group) {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.querySelectorAll('.nav-fold').forEach(fold => {
    const kind = fold.dataset.fold;
    const own = fold.dataset.group;
    let hide;
    if (kind === 'back') hide = !group;
    else if (kind === 'children') hide = group !== own;
    else if (kind === 'parent') hide = !!group && group !== own;
    else hide = !!group;
    fold.classList.toggle('collapsed', hide);
  });
  nav.querySelectorAll('.nav-parent').forEach(parent => {
    parent.classList.toggle('expanded', parent.dataset.group === group);
  });
  nav.scrollTop = 0;
}

document.querySelectorAll('#sidebar-nav .nav-item').forEach(item => {
  if (item.id === 'nav-back') return;
  item.addEventListener('click', () => {
    const group = navGroupOf(item);
    if (group) setNavGroup(group);
  });
});

const navBackBtn = document.getElementById('nav-back');
if (navBackBtn) {
  navBackBtn.addEventListener('click', () => {
    billingChain.then(() => {
      window.location.href = 'admin.html';
    });
  });
}

loadCurrentUser();
setNavGroup('billing');
document.querySelector('.nav-item[data-page="billing"]').click();
