const API_BASE = '/api';
let currentUser = null;
let allUsers = [];
let allCenters = [];
let confirmCallback = null;
let editingUserId = null;
let filteredUsers = [];
let currentUsersPage = 1;
let usersPerPage = 25;

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
  sessionStorage.removeItem('token');
  localStorage.removeItem('token');
  window.location.href = '/';
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

    if (page === 'users') loadUsers();
    else if (page === 'centers') loadCenters();
    else if (page === 'dicom') loadDicom();
    else if (page === 'templates') loadTemplates();
    else if (page === 'groups') loadGroups();
    else if (page === 'sessions') loadSessions();
    else if (page === 'server') loadServerInfo();
    else if (page === 'mgmt-reports') initMgmtReports();
  });
});

async function loadDashboard() {
  try {
    const [usersRes, centersRes, dicomRes, templatesRes] = await Promise.all([
      api('/api/users/'),
      api('/api/centers/'),
      api('/api/dicom-list/?page=1&page_size=1'),
      api('/api/manage-templates/')
    ]);
    if (usersRes.ok) {
      const users = await usersRes.json();
      document.getElementById('total-users').textContent = users.length || 0;
    }
    if (centersRes.ok) {
      const centers = await centersRes.json();
      document.getElementById('total-centers').textContent = centers.length || 0;
    }
    if (dicomRes.ok) {
      const dicom = await dicomRes.json();
      document.getElementById('total-images').textContent = dicom.count || 0;
    }
    if (templatesRes.ok) {
      const templates = await templatesRes.json();
      document.getElementById('total-templates').textContent = (templates.templates || []).length;
    }
  } catch (e) {
    console.error('Failed to load dashboard stats:', e);
  }
}

async function loadUsers() {
  document.getElementById('users-table-body').innerHTML = '<tr><td colspan="6" class="loading">Loading users</td></tr>';
  try {
    const res = await api('/api/users/');
    if (!res.ok) throw new Error();
    allUsers = await res.json();
    const groupMap = await loadUserGroupMap();
    allUsers.forEach(u => {
      if (!u.userprofile) u.userprofile = {};
      u.userprofile.group_id = groupMap[String(u.id)] || '';
    });
    filteredUsers = [...allUsers];
    currentUsersPage = 1;
    renderUsersWithPagination();
  } catch {
    document.getElementById('users-table-body').innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--red);">Failed to load users</td></tr>';
  }
}

function filterUsers() {
  const query = document.getElementById('user-search').value.toLowerCase();
  const roleFilter = document.getElementById('user-role-filter').value;
  const filtered = allUsers.filter(u => {
    const profile = u.userprofile || {};
    const matchQuery = !query || (u.username || '').toLowerCase().includes(query) || 
                       (profile.full_name || '').toLowerCase().includes(query);
    const matchRole = !roleFilter || (profile.role_name === roleFilter);
    return matchQuery && matchRole;
  });
  renderUsers(filtered);
}

function renderUsers(users) {
  const tbody = document.getElementById('users-table-body');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No users found</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const p = u.userprofile || {};
    const isActive = u.is_active;
    return `<tr>
      <td><span style="font-weight:500;color:var(--text);">${u.username}</span></td>
      <td>${p.full_name || '—'}</td>
      <td><button class="btn btn-secondary btn-xs" onclick="openChangePasswordModal(${u.id}, '${(u.username || '').replace(/'/g,"\\'")}')">Change</button></td>
      <td>
        <button class="btn btn-${isActive ? 'warning' : 'success'} btn-xs" onclick="toggleUserActive(${u.id}, ${isActive}, '${(u.username || '').replace(/'/g,"\\'")}')">
          ${isActive ? 'Disable' : 'Enable'}
        </button>
      </td>
      <td><button class="btn btn-ghost btn-xs" onclick="openEditUserModal(${u.id})">Edit</button></td>
      <td><button class="btn btn-danger btn-xs" onclick="deleteUser(${u.id}, '${(u.username || '').replace(/'/g,"\\'")}')">Delete</button></td>
    </tr>`;
  }).join('');
}

async function openCreateUserModal() {
  editingUserId = null;
  document.getElementById('user-modal-title').textContent = 'Create New User';
  document.getElementById('user-username').value = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-role').value = '';
  document.getElementById('user-group').value = '';
  document.getElementById('user-center').value = '';
  document.getElementById('user-fullname').value = '';
  document.getElementById('user-designation').value = '';
  document.getElementById('user-qualification').value = '';
  document.getElementById('user-contact').value = '';
  document.getElementById('user-bmdc').value = '';
  document.getElementById('user-signature').value = '';
  document.getElementById('signature-preview').style.display = 'none';
  document.getElementById('perm-assign-doctors').checked = false;
  document.getElementById('perm-write-reports').checked = false;
  document.getElementById('perm-manage-templates').checked = false;
  document.getElementById('perm-view-images').checked = false;
  document.getElementById('user-modal-error').style.display = 'none';
  document.getElementById('user-center-group').style.display = 'none';
  document.getElementById('user-institution-section').style.display = 'none';
  document.getElementById('fullname-required').style.display = 'none';
  document.getElementById('qualification-required').style.display = 'none';
  await loadCentersForDropdown();
  populateGroupDropdown('user-group', '');
  openModal('create-user-modal');
}

async function loadCentersForDropdown() {
  try {
    const res = await api('/api/centers/');
    if (res.ok) {
      allCenters = await res.json();
      const select = document.getElementById('user-center');
      select.innerHTML = '<option value="">Select Center</option>' + 
        allCenters.map(c => `<option value="${c.id}">${c.institute_name}</option>`).join('');
    }
  } catch {}
}

function toggleUserFields() {
  const role = document.getElementById('user-role').value;
  const centerGroup = document.getElementById('user-center-group');
  const instSection = document.getElementById('user-institution-section');
  const fullnameReq = document.getElementById('fullname-required');
  const qualReq = document.getElementById('qualification-required');

  centerGroup.style.display = role === 'Center' ? 'block' : 'none';
  instSection.style.display = role === 'Doctor' ? 'block' : 'none';
  fullnameReq.style.display = role === 'Doctor' ? 'inline' : 'none';
  qualReq.style.display = role === 'Doctor' ? 'inline' : 'none';

  if (role === 'Doctor') {
    loadInstitutionsMultiSelect();
  }
}

function loadInstitutionsMultiSelect() {
  const container = document.getElementById('institution-multi-select');
  if (!allCenters.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--text3);">No centers available</div>';
    return;
  }
  container.innerHTML = allCenters.map(c => `
    <div class="multi-select-item">
      <input type="checkbox" class="checkbox" id="inst-${c.id}" value="${c.id}" />
      <label for="inst-${c.id}" style="cursor:pointer;flex:1;">${c.institute_name}</label>
    </div>
  `).join('');
}

function previewSignature() {
  const file = document.getElementById('user-signature').files[0];
  const preview = document.getElementById('signature-preview');
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    preview.style.display = 'none';
  }
}

async function saveUser() {
  const username = document.getElementById('user-username').value.trim();
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;
  const centerId = document.getElementById('user-center').value;
  const errEl = document.getElementById('user-modal-error');
  
  if (!username || !password || !role) {
    errEl.textContent = 'Username, password, and role are required.';
    errEl.style.display = 'inline-flex';
    return;
  }
  
  const fullName = document.getElementById('user-fullname').value.trim();
  const qualification = document.getElementById('user-qualification').value.trim();
  
  if (role === 'Doctor' && (!fullName || !qualification)) {
    errEl.textContent = 'Full name and qualification are required for doctors.';
    errEl.style.display = 'inline-flex';
    return;
  }
  
  const userPayload = { username, password, role };
  if (role === 'Center' && centerId) {
    userPayload.center = centerId;
  }
  
  const res = await api('/api/users/', { method: 'POST', body: JSON.stringify(userPayload) });
  const data = await res.json();
  
  if (!res.ok) {
    errEl.textContent = data.detail || 'Failed to create user.';
    errEl.style.display = 'inline-flex';
    return;
  }
  
  const profileData = new FormData();
  profileData.append('username', username);
  profileData.append('full_name', document.getElementById('user-fullname').value.trim());
  profileData.append('designation', document.getElementById('user-designation').value.trim());
  profileData.append('qualification', document.getElementById('user-qualification').value.trim());
  profileData.append('contact_number', document.getElementById('user-contact').value.trim());
  profileData.append('bmdc_reg_no', document.getElementById('user-bmdc').value.trim());

  profileData.append('can_assign_doctors', document.getElementById('perm-assign-doctors').checked);
  profileData.append('can_write_reports', document.getElementById('perm-write-reports').checked);
  profileData.append('can_manage_templates', document.getElementById('perm-manage-templates').checked);
  profileData.append('can_view_images', document.getElementById('perm-view-images').checked);

  const signatureFile = document.getElementById('user-signature').files[0];
  if (signatureFile) {
    profileData.append('signature', signatureFile);
  }

  if (role === 'Doctor') {
    const selectedInsts = Array.from(document.querySelectorAll('#institution-multi-select input:checked'))
      .map(cb => cb.value);
    profileData.append('assigned_institutions', JSON.stringify(selectedInsts));
  }

  const profileRes = await fetch('/api/update-user-profile/', {
    method: 'POST',
    headers: { 'Authorization': `Token ${getToken()}` },
    body: profileData
  });

  if (!profileRes.ok) {
    console.error('Failed to update profile');
  }

  const selectedGroupId = document.getElementById('user-group').value;
  if (selectedGroupId) {
    const fullNameForGroup = document.getElementById('user-fullname').value.trim();
    saveUserGroupAssignment(data.id || data.user_id, selectedGroupId, fullNameForGroup);
  }
  
  toast('User created successfully!', 'success');
  closeModal('create-user-modal');
  loadUsers();
  loadDashboard();
}

async function openEditUserModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  
  editingUserId = userId;
  const profile = user.userprofile || {};
  
  document.getElementById('edit-user-id').value = userId;
  document.getElementById('edit-user-username').value = user.username;
  document.getElementById('edit-user-role').value = profile.role_name || '';
  document.getElementById('edit-user-fullname').value = profile.full_name || '';
  document.getElementById('edit-user-designation').value = profile.designation || '';
  document.getElementById('edit-user-qualification').value = profile.qualification || '';
  document.getElementById('edit-user-contact').value = profile.contact_number || '';
  document.getElementById('edit-user-bmdc').value = profile.bmdc_reg_no || '';
  
  document.getElementById('edit-perm-assign-doctors').checked = profile.can_assign_doctors || false;
  document.getElementById('edit-perm-write-reports').checked = profile.can_write_reports || false;
  document.getElementById('edit-perm-manage-templates').checked = profile.can_manage_templates || false;
  document.getElementById('edit-perm-view-images').checked = profile.can_view_images || false;
  
  document.getElementById('edit-user-signature').value = '';
  document.getElementById('edit-signature-preview').style.display = 'none';
  
  const sigInfo = document.getElementById('current-signature-info');
  if (profile.signature) {
    sigInfo.textContent = 'Current signature uploaded';
    sigInfo.style.color = 'var(--green)';
  } else {
    sigInfo.textContent = 'No signature uploaded';
    sigInfo.style.color = 'var(--text3)';
  }
  
  const instSection = document.getElementById('edit-institution-section');
  if (profile.role_name === 'Doctor') {
    instSection.style.display = 'block';
    await loadEditInstitutionsMultiSelect(userId);
  } else {
    instSection.style.display = 'none';
  }

  populateGroupDropdown('edit-user-group', profile.group_id || '');
  
  document.getElementById('edit-user-modal-error').style.display = 'none';
  openModal('edit-user-modal');
}

async function loadEditInstitutionsMultiSelect(userId) {
  const container = document.getElementById('edit-institution-multi-select');
  if (!allCenters.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--text3);">No centers available</div>';
    return;
  }
  
  let assignedInsts = [];
  try {
    const res = await api(`/api/user-assigned-institutions/${userId}/`);
    if (res.ok) {
      const data = await res.json();
      assignedInsts = data.assigned_institutions || [];
    }
  } catch {}
  
  container.innerHTML = allCenters.map(c => {
    const checked = assignedInsts.includes(c.id) ? 'checked' : '';
    return `
      <div class="multi-select-item">
        <input type="checkbox" class="checkbox" id="edit-inst-${c.id}" value="${c.id}" ${checked} />
        <label for="edit-inst-${c.id}" style="cursor:pointer;flex:1;">${c.institute_name}</label>
      </div>
    `;
  }).join('');
}

function previewEditSignature() {
  const file = document.getElementById('edit-user-signature').files[0];
  const preview = document.getElementById('edit-signature-preview');
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  } else {
    preview.style.display = 'none';
  }
}

async function updateUser() {
  const userId = document.getElementById('edit-user-id').value;
  const username = document.getElementById('edit-user-username').value;
  const errEl = document.getElementById('edit-user-modal-error');
  
  const fullName = document.getElementById('edit-user-fullname').value.trim();
  const qualification = document.getElementById('edit-user-qualification').value.trim();
  const role = document.getElementById('edit-user-role').value;
  
  if (role === 'Doctor' && (!fullName || !qualification)) {
    errEl.textContent = 'Full name and qualification are required for doctors.';
    errEl.style.display = 'inline-flex';
    return;
  }
  
  const profileData = new FormData();
  profileData.append('user_id', userId);
  profileData.append('username', username);
  profileData.append('full_name', fullName);
  profileData.append('designation', document.getElementById('edit-user-designation').value.trim());
  profileData.append('qualification', qualification);
  profileData.append('contact_number', document.getElementById('edit-user-contact').value.trim());
  profileData.append('bmdc_reg_no', document.getElementById('edit-user-bmdc').value.trim());
  
  profileData.append('can_assign_doctors', document.getElementById('edit-perm-assign-doctors').checked);
  profileData.append('can_write_reports', document.getElementById('edit-perm-write-reports').checked);
  profileData.append('can_manage_templates', document.getElementById('edit-perm-manage-templates').checked);
  profileData.append('can_view_images', document.getElementById('edit-perm-view-images').checked);
  
  const signatureFile = document.getElementById('edit-user-signature').files[0];
  if (signatureFile) {
    profileData.append('signature', signatureFile);
  }
  
  if (role === 'Doctor') {
    const selectedInsts = Array.from(document.querySelectorAll('#edit-institution-multi-select input:checked'))
      .map(cb => cb.value);
    profileData.append('assigned_institutions', JSON.stringify(selectedInsts));
  }
  
  const res = await fetch('/api/update-user-profile/', {
    method: 'POST',
    headers: { 'Authorization': `Token ${getToken()}` },
    body: profileData
  });
  
  const data = await res.json();
  
  if (res.ok) {
    const selectedGroupId = document.getElementById('edit-user-group').value;
    saveUserGroupAssignment(parseInt(userId), selectedGroupId, fullName);
    toast('User profile updated successfully!', 'success');
    closeModal('edit-user-modal');
    loadUsers();
  } else {
    errEl.textContent = data.error || 'Failed to update user profile.';
    errEl.style.display = 'inline-flex';
  }
}

function deleteUser(userId, username) {
  openConfirm('Delete User?', `Delete user "${username}"? This cannot be undone.`, async () => {
    const res = await api(`/api/users/${userId}/`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      toast('User deleted.', 'success');
      loadUsers();
      loadDashboard();
    } else {
      toast('Failed to delete user.', 'error');
    }
  });
}

let allCentersUsersMap = {};
let currentCentersPage = 1;
let centersPerPage = 25;
let filteredCenters = [];

async function loadCenters() {
  document.getElementById('centers-table-body').innerHTML = '<tr><td colspan="5" class="loading">Loading centers</td></tr>';
  try {
    const [centersRes, usersRes] = await Promise.all([
      api('/api/centers/'),
      api('/api/users/')
    ]);
    if (!centersRes.ok) throw new Error();
    allCenters = await centersRes.json();
    allCentersUsersMap = {};
    if (usersRes.ok) {
      const users = await usersRes.json();
      users.forEach(u => { allCentersUsersMap[u.id] = u.username; });
    }
    allCenters.forEach(c => {
      if (!Array.isArray(c.allowed_users)) {
        c.allowed_users = [];
      }
    });
    filteredCenters = [...allCenters];
    currentCentersPage = 1;
    renderCentersWithPagination();
  } catch {
    document.getElementById('centers-table-body').innerHTML = '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--red);">Failed to load centers</td></tr>';
  }
}

function renderCentersWithPagination() {
  const total = filteredCenters.length;
  const totalPages = Math.ceil(total / centersPerPage);
  const startIndex = (currentCentersPage - 1) * centersPerPage;
  const endIndex = Math.min(startIndex + centersPerPage, total);
  const centersToShow = filteredCenters.slice(startIndex, endIndex);

  renderCenters(centersToShow, allCentersUsersMap);

  if (total > 10) {
    document.getElementById('centers-pagination-container').style.display = 'block';
    document.getElementById('centers-pagination-info').textContent = `Showing ${startIndex + 1}-${endIndex} of ${total} centers`;
    renderCentersPaginationButtons(totalPages);
  } else {
    document.getElementById('centers-pagination-container').style.display = 'none';
  }
}

function renderCentersPaginationButtons(totalPages) {
  const container = document.getElementById('centers-pagination-buttons');
  let html = '';

  html += `<button class="pagination-btn" onclick="goToCentersPage(${currentCentersPage - 1})" ${currentCentersPage === 1 ? 'disabled' : ''}>‹</button>`;

  const maxButtons = 7;
  let startPage = Math.max(1, currentCentersPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToCentersPage(1)">1</button>`;
    if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentCentersPage ? 'active' : ''}" onclick="goToCentersPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">...</span>`;
    html += `<button class="pagination-btn" onclick="goToCentersPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" onclick="goToCentersPage(${currentCentersPage + 1})" ${currentCentersPage === totalPages ? 'disabled' : ''}>›</button>`;

  container.innerHTML = html;
}

function goToCentersPage(page) {
  const totalPages = Math.ceil(filteredCenters.length / centersPerPage);
  if (page < 1 || page > totalPages) return;
  currentCentersPage = page;
  renderCentersWithPagination();
}

function changeCentersPerPage() {
  centersPerPage = parseInt(document.getElementById('centers-items-per-page').value);
  currentCentersPage = 1;
  renderCentersWithPagination();
}

function searchCenters() {
  const query = document.getElementById('center-search-input').value.toLowerCase();
  filteredCenters = allCenters.filter(c => {
    const instituteName = (c.institute_name || '').toLowerCase();
    const username = (c.user ? (allCentersUsersMap[c.user] || '') : '').toLowerCase();
    return !query || instituteName.includes(query) || username.includes(query);
  });
  currentCentersPage = 1;
  renderCentersWithPagination();
}

function renderCenters(centers, usersMap) {
  usersMap = usersMap || {};
  const tbody = document.getElementById('centers-table-body');
  if (!allCenters.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">🏢</div><div class="empty-title">No centers yet</div><div class="empty-text">Click "New Center" to create one.</div></div></td></tr>';
    return;
  }
  if (!centers.length) {
    tbody.innerHTML = '';
    return;
  }
  tbody.innerHTML = centers.map(c => {
    const isEnabled = c.is_default;
    const enableToggle = `<button class="btn btn-${isEnabled ? 'warning' : 'success'} btn-xs" onclick="toggleCenterActive(${c.id}, ${isEnabled}, '${(c.institute_name || '').replace(/'/g, "\\'")}')">
      ${isEnabled ? 'Disable' : 'Enable'}
    </button>`;
    const loginUsername = c.user ? (usersMap[c.user] || `User #${c.user}`) : '<span style="color:var(--text3);">—</span>';
    const instituteName = (c.institute_name || '').replace(/'/g, "\\'");
    return `<tr>
    <td><span style="font-weight:500;color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="openEditCenterModal(${c.id})">${c.institute_name || '—'}</span></td>
    <td><span style="color:var(--text2);">${loginUsername}</span></td>
    <td>${enableToggle}</td>
    <td><button class="btn btn-primary btn-xs" onclick="viewUploadHistory(${c.id}, '${instituteName}')">View</button></td>
    <td><button class="btn btn-danger btn-xs" onclick="deleteCenter(${c.id}, '${instituteName}')">Delete</button></td>
  </tr>`;
  }).join('');
}

async function toggleCenterActive(centerId, currentStatus, name) {
  const action = currentStatus ? 'disable' : 'enable';
  openConfirm(
    `${action.charAt(0).toUpperCase() + action.slice(1)} Center`,
    `Are you sure you want to ${action} center "${name}"?`,
    async () => {
      try {
        const res = await api(`/api/centers/${centerId}/`, {
          method: 'PATCH',
          body: JSON.stringify({ is_default: !currentStatus })
        });
        if (res.ok) {
          showToast(`Center ${action}d successfully`, 'success');
          loadCenters();
        } else {
          showToast(`Failed to ${action} center`, 'error');
        }
      } catch (e) {
        showToast(`Error ${action}ing center`, 'error');
      }
    }
  );
}

let uploadHistoryAllRows = [];
let uploadHistoryPage = 1;
let uploadHistoryPerPage = 25;

async function viewUploadHistory(centerId, instituteName) {
  const center = allCenters.find(c => c.id === centerId);
  if (!center) return;

  document.getElementById('upload-history-modal-title').textContent = `Upload History — ${instituteName}`;
  document.getElementById('upload-history-table-body').innerHTML = '<tr><td colspan="3" class="loading">Loading...</td></tr>';
  document.getElementById('upload-history-pagination').style.display = 'none';
  openModal('upload-history-modal');

  try {
    const centerNames = center.center_names || [];
    let allRows = [];

    for (const cn of centerNames) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const params = new URLSearchParams({ center_name: cn, page: String(page) });
        const res = await api(`/api/dicom-list/?${params.toString()}`);
        if (!res.ok) break;
        const data = await res.json();
        allRows = allRows.concat(data.results || []);
        hasMore = !!data.next;
        page++;
      }
    }

    if (!allRows.length) {
      document.getElementById('upload-history-table-body').innerHTML = '<tr><td colspan="3"><div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">No uploads found</div></div></td></tr>';
      return;
    }

    allRows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    uploadHistoryAllRows = allRows;
    uploadHistoryPage = 1;
    uploadHistoryPerPage = parseInt(document.getElementById('upload-history-per-page').value) || 25;
    renderUploadHistoryPage();
  } catch {
    document.getElementById('upload-history-table-body').innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--red);">Failed to load upload history</td></tr>';
  }
}

function renderUploadHistoryPage() {
  const total = uploadHistoryAllRows.length;
  const totalPages = Math.ceil(total / uploadHistoryPerPage);
  const start = (uploadHistoryPage - 1) * uploadHistoryPerPage;
  const end = Math.min(start + uploadHistoryPerPage, total);
  const rows = uploadHistoryAllRows.slice(start, end);

  document.getElementById('upload-history-table-body').innerHTML = rows.map(row => {
    const centerDisplay = row.center_name || '—';
    const uploaded = row.created_at ? new Date(row.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const sizeMb = (row.file_size_mb != null) ? row.file_size_mb + ' MB' : '—';
    return `<tr>
      <td>${centerDisplay}</td>
      <td style="font-family:var(--mono);font-size:12px;">${uploaded}</td>
      <td>${sizeMb}</td>
    </tr>`;
  }).join('');

  const paginationEl = document.getElementById('upload-history-pagination');
  if (total > uploadHistoryPerPage) {
    paginationEl.style.display = 'block';
    document.getElementById('upload-history-pagination-info').textContent = `Showing ${start + 1}–${end} of ${total}`;
    renderUploadHistoryPaginationButtons(totalPages);
  } else {
    paginationEl.style.display = 'none';
  }
}

function renderUploadHistoryPaginationButtons(totalPages) {
  const container = document.getElementById('upload-history-pagination-buttons');
  let html = '';

  html += `<button class="pagination-btn" onclick="goToUploadHistoryPage(${uploadHistoryPage - 1})" ${uploadHistoryPage === 1 ? 'disabled' : ''}>‹</button>`;

  const maxButtons = 5;
  let startPage = Math.max(1, uploadHistoryPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToUploadHistoryPage(1)">1</button>`;
    if (startPage > 2) html += `<span class="pagination-ellipsis">…</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === uploadHistoryPage ? 'active' : ''}" onclick="goToUploadHistoryPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">…</span>`;
    html += `<button class="pagination-btn" onclick="goToUploadHistoryPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" onclick="goToUploadHistoryPage(${uploadHistoryPage + 1})" ${uploadHistoryPage === totalPages ? 'disabled' : ''}>›</button>`;

  container.innerHTML = html;
}

function goToUploadHistoryPage(page) {
  const totalPages = Math.ceil(uploadHistoryAllRows.length / uploadHistoryPerPage);
  if (page < 1 || page > totalPages) return;
  uploadHistoryPage = page;
  renderUploadHistoryPage();
}

function changeUploadHistoryPerPage() {
  uploadHistoryPerPage = parseInt(document.getElementById('upload-history-per-page').value);
  uploadHistoryPage = 1;
  renderUploadHistoryPage();
}

function deleteCenter(id, name) {
  openConfirm('Delete Center?', `Delete "${name}"? This cannot be undone.`, async () => {
    const res = await api(`/api/centers/${id}/`, { method: 'DELETE' });
    if (res.status === 204 || res.ok) { toast('Center deleted.', 'success'); loadCenters(); loadDashboard(); }
    else { toast('Failed to delete center.', 'error'); }
  });
}

function saveCenterAllowedUsers(centerId, usernames) {
}

function getCenterAllowedUsers(centerId) {
  return null;
}

async function buildCenterUserList(containerId, selectedUsernames) {
  const container = document.getElementById(containerId);
  container.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:13px;">Loading users...</div>';
  let users = [];
  try {
    const res = await api('/api/users/');
    if (res.ok) {
      const all = await res.json();
      users = all.filter(u => {
        const role = (u.userprofile && u.userprofile.role_name) || '';
        return role === 'SubAdmin' || role === 'Doctor';
      });
    }
  } catch {}
  if (!users.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:13px;">No eligible users found.</div>';
    return;
  }
  container.dataset.users = JSON.stringify(users.map(u => ({ id: u.id, username: u.username, role: (u.userprofile && u.userprofile.role_name) || '' })));
  renderCenterUserGrid(containerId, users, selectedUsernames);
}

function renderCenterUserGrid(containerId, users, selectedUsernames) {
  const container = document.getElementById(containerId);
  if (!users.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:13px;">No users found.</div>';
    return;
  }

  const cols = 5;
  const rows = [];
  for (let i = 0; i < users.length; i += cols) {
    rows.push(users.slice(i, i + cols));
  }

  container.innerHTML = rows.map((row, rowIdx) => {
    const cells = row.map(u => {
      const checked = selectedUsernames.includes(u.username) ? 'checked' : '';
      const safeId = 'cu_' + containerId + '_' + u.id;
      const roleTag = u.role ? ` <span style="font-size:10px;color:var(--text3);">(${u.role})</span>` : '';
      return `<div class="user-grid-cell">
        <input type="checkbox" id="${safeId}" value="${u.username}" ${checked} />
        <label for="${safeId}">${u.username}${roleTag}</label>
      </div>`;
    });
    while (cells.length < cols) {
      cells.push('<div class="user-grid-cell"></div>');
    }
    return `<div class="user-grid-row">${cells.join('')}</div>`;
  }).join('');
}

function filterCenterUserGrid(containerId, query) {
  const container = document.getElementById(containerId);
  const raw = container.dataset.users;
  if (!raw) return;
  let users = JSON.parse(raw);
  const q = query.trim().toLowerCase();
  if (q) {
    users = users.filter(u => u.username.toLowerCase().includes(q));
  }
  const checked = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  renderCenterUserGrid(containerId, users, checked);
  container.dataset.users = raw;
}

function openEditCenterModal(id) {
  const center = allCenters.find(c => c.id === id);
  if (!center) return;
  document.getElementById('edit-center-id').value = id;
  document.getElementById('edit-institute-name').value = center.institute_name || '';
  document.getElementById('edit-center-names').value = (center.center_names || []).join(', ');
  document.getElementById('edit-center-enabled').checked = center.is_default !== false;
  document.getElementById('edit-center-error').style.display = 'none';
  buildCenterUserList('edit-center-user-list', center.allowed_users || []);
  openModal('edit-center-modal');
}

async function updateCenter() {
  const id = document.getElementById('edit-center-id').value;
  const institute_name = document.getElementById('edit-institute-name').value.trim();
  const centerNamesInput = document.getElementById('edit-center-names').value.trim();
  const isEnabled = document.getElementById('edit-center-enabled').checked;
  const errEl = document.getElementById('edit-center-error');

  if (!institute_name) {
    errEl.textContent = 'Institute name is required.';
    errEl.style.display = 'inline-flex';
    return;
  }

  const allowedUsers = Array.from(document.querySelectorAll('#edit-center-user-list input[type="checkbox"]:checked')).map(cb => cb.value);

  const res = await api(`/api/centers/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ institute_name, is_default: isEnabled, allowed_users: allowedUsers })
  });

  if (!res.ok) {
    errEl.textContent = 'Failed to update center.';
    errEl.style.display = 'inline-flex';
    return;
  }

  if (centerNamesInput) {
    const newNames = centerNamesInput.split(',').map(n => n.trim()).filter(n => n);
    const center = allCenters.find(c => c.id === parseInt(id));
    const existingNames = center ? (center.center_names || []) : [];

    for (const name of newNames) {
      if (!existingNames.includes(name)) {
        await api('/api/center-names/', {
          method: 'POST',
          body: JSON.stringify({ center: id, name })
        });
      }
    }
  }

  const centerIdx = allCenters.findIndex(c => c.id === parseInt(id));
  if (centerIdx !== -1) {
    allCenters[centerIdx].allowed_users = allowedUsers;
  }

  toast('Center updated successfully!', 'success');
  closeModal('edit-center-modal');
  loadCenters();
}

async function openCreateCenterModal() {
  document.getElementById('new-institute').value = '';
  document.getElementById('new-center-names').value = '';
  document.getElementById('new-center-enabled').checked = true;
  document.getElementById('create-center-error').style.display = 'none';
  buildCenterUserList('new-center-user-list', []);
  openModal('create-center-modal');
}

async function createCenter() {
  const institute_name = document.getElementById('new-institute').value.trim();
  const centerNamesInput = document.getElementById('new-center-names').value.trim();
  const isEnabled = document.getElementById('new-center-enabled').checked;
  const errEl = document.getElementById('create-center-error');
  
  if (!institute_name) {
    errEl.textContent = 'Institute name is required.';
    errEl.style.display = 'inline-flex';
    return;
  }
  
  const allowedUsers = Array.from(document.querySelectorAll('#new-center-user-list input[type="checkbox"]:checked')).map(cb => cb.value);
  
  const payload = { institute_name, is_default: isEnabled, allowed_users: allowedUsers };
  
  const res = await api('/api/centers/', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  
  if (res.ok) {
    const centerId = data.id;
    
    if (centerNamesInput) {
      const centerNames = centerNamesInput.split(',').map(n => n.trim()).filter(n => n);
      for (const name of centerNames) {
        await api('/api/center-names/', {
          method: 'POST',
          body: JSON.stringify({ center: centerId, name })
        });
      }
    }
    
    toast('Center created!', 'success');
    closeModal('create-center-modal');
    loadCenters();
    loadDashboard();
  } else {
    errEl.textContent = data.detail || 'Failed to create center.';
    errEl.style.display = 'inline-flex';
  }
}

let allDicom = [], allDoctorsList = [], dicomCurrentPage = 1, dicomRowsPerPage = 50;

async function loadDoctorsList() {
  try {
    const res = await api('/api/doctors/');
    if (res.ok) {
      const d = await res.json();
      allDoctorsList = d.doctors || [];
      const sel = document.getElementById('dicom-assign-doctor');
      
      const groups = await loadGroupsFromStorage();
      let html = '<option value="">Select Doctor / Group</option>';
      
      if (groups.length) {
        html += '<optgroup label="── Groups ──">';
        groups.forEach(group => {
          html += `<option value="__group__${group.id}" data-group-id="${group.id}">${group.name}</option>`;
        });
        html += '</optgroup>';
      }
      
      if (allDoctorsList.length) {
        html += '<optgroup label="── Individual Doctors ──">';
        allDoctorsList.forEach(doc => {
          html += `<option value="${doc.name}">${doc.name}</option>`;
        });
        html += '</optgroup>';
      }
      
      sel.innerHTML = html;
    }
  } catch {}
}

async function loadDicom() {
  const resultsCard = document.getElementById('dicom-results-card');
  if (resultsCard) resultsCard.style.display = 'none';
  document.getElementById('dicom-count').textContent = '';
  await loadDoctorsList();
  try {
    const centersRes = await api('/api/centers/');
    if (centersRes.ok) {
      const centers = await centersRes.json();
      populateDicomInstituteFilter(centers);
    }
  } catch {}
}

function populateDicomInstituteFilter(centers) {
  const institutes = [...new Set((centers || []).map(c => c.institute_name).filter(Boolean))].sort();
  const sel = document.getElementById('dicom-institute-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Institutes</option>' +
    institutes.map(i => `<option value="${i}"${i === current ? ' selected' : ''}>${i}</option>`).join('');
}

async function filterDicom() {
  const q = (document.getElementById('dicom-search').value || '').trim();
  const idQ = (document.getElementById('dicom-id-filter').value || '').trim();
  const st = document.getElementById('dicom-status-filter').value;
  const inst = document.getElementById('dicom-institute-filter').value;
  const mod = document.getElementById('dicom-modality-filter').value;
  const fromDate = document.getElementById('dicom-date-from').value;
  const toDate = document.getElementById('dicom-date-to').value;
  const emergencyOnly = document.getElementById('dicom-emergency-filter').checked;

  const params = new URLSearchParams();
  if (q) params.set('patient_name__icontains', q);
  if (idQ) params.set('patient_id__icontains', idQ);
  if (st) params.set('status', st);
  if (mod) params.set('modality__in', mod);
  if (emergencyOnly) params.set('is_emergency', 'true');
  if (inst) params.set('institute_name', inst);
  if (fromDate) params.set('date_from', fromDate.replace(/-/g, ''));
  if (toDate) params.set('date_to', toDate.replace(/-/g, ''));
  params.set('page', '1');
  params.set('page_size', '2000');

  document.getElementById('dicom-results-card').style.display = 'block';
  document.getElementById('dicom-count').textContent = 'Loading...';
  document.getElementById('dicom-table-body').innerHTML = '<tr><td colspan="9" class="loading">Loading...</td></tr>';

  try {
    const res = await api(`/api/dicom-list/?${params.toString()}`);
    if (!res.ok) throw new Error();
    const data = await res.json();

    allDicom = data.results || [];
    dicomCurrentPage = 1;
    renderDicom();
  } catch {
    document.getElementById('dicom-count').textContent = 'Failed to load.';
    document.getElementById('dicom-table-body').innerHTML = '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--red);">Failed to load results</td></tr>';
  }
}

function clearDicomFilters() {
  document.getElementById('dicom-search').value = '';
  document.getElementById('dicom-id-filter').value = '';
  document.getElementById('dicom-date-from').value = '';
  document.getElementById('dicom-date-to').value = '';
  document.getElementById('dicom-status-filter').value = '';
  document.getElementById('dicom-institute-filter').value = '';
  document.getElementById('dicom-modality-filter').value = '';
  document.getElementById('dicom-emergency-filter').checked = false;
  allDicom = [];
  dicomCurrentPage = 1;
  document.getElementById('dicom-results-card').style.display = 'none';
  document.getElementById('dicom-count').textContent = '';
}

function toggleAllDicomRows(masterCb) {
  document.querySelectorAll('.dicom-row-cb').forEach(cb => { cb.checked = masterCb.checked; });
  updateDicomAssignPanel();
}

function updateDicomAssignPanel() {
  const checked = document.querySelectorAll('.dicom-row-cb:checked');
  const bulkPanel = document.getElementById('dicom-bulk-panel');
  const bulkCount = document.getElementById('dicom-bulk-count');
  if (bulkPanel) bulkPanel.style.display = checked.length ? 'block' : 'none';
  if (bulkCount) bulkCount.textContent = `${checked.length} selected`;
  if (checked.length === 0) {
    const masterCb = document.getElementById('dicom-select-all');
    if (masterCb) masterCb.checked = false;
  }
}

function getSelectedDicomIds() {
  return Array.from(document.querySelectorAll('.dicom-row-cb:checked')).map(cb => parseInt(cb.value));
}

function selectDicomByModality() {
  const mod = document.getElementById('dicom-bulk-modality').value || document.getElementById('dicom-modality-filter').value;
  if (!mod) { toast('Pick a modality first to select by it.', 'error'); return; }
  document.querySelectorAll('.dicom-row-cb').forEach(cb => {
    const row = allDicom.find(d => String(d.id) === cb.value);
    cb.checked = !!(row && row.modality === mod);
  });
  updateDicomAssignPanel();
}

async function bulkDeleteDicom() {
  const ids = getSelectedDicomIds();
  if (!ids.length) { toast('No studies selected.', 'error'); return; }

  openConfirm(
    'Delete Selected Studies?',
    `This will permanently delete ${ids.length} selected stud${ids.length > 1 ? 'ies' : 'y'}. This cannot be undone.`,
    async () => {
      const results = await Promise.all(ids.map(id => api(`/api/dicom-images/${id}/`, { method: 'DELETE' }).then(r => r.status === 204 || r.ok).catch(() => false)));
      const deleted = results.filter(Boolean).length;
      const failed = ids.length - deleted;
      toast(`Deleted ${deleted} stud${deleted !== 1 ? 'ies' : 'y'}${failed ? `, ${failed} failed` : ''}.`, failed ? 'error' : 'success');
      filterDicom();
    }
  );
}

async function bulkApplyDicomEdit() {
  const ids = getSelectedDicomIds();
  if (!ids.length) { toast('No studies selected.', 'error'); return; }

  const modality = document.getElementById('dicom-bulk-modality').value;
  const status = document.getElementById('dicom-bulk-status').value;
  if (!modality && !status) { toast('Choose a modality or status to apply.', 'error'); return; }

  const tasks = [];
  if (status) {
    ids.forEach(id => tasks.push(api(`/api/dicom-images/${id}/update_status/`, { method: 'PATCH', body: JSON.stringify({ status }) }).then(r => r.ok).catch(() => false)));
  }
  if (modality) {
    ids.forEach(id => tasks.push(api(`/api/dicom-images/${id}/`, { method: 'PATCH', body: JSON.stringify({ modality }) }).then(r => r.ok).catch(() => false)));
  }

  const results = await Promise.all(tasks);
  const okCount = results.filter(Boolean).length;
  const failCount = results.length - okCount;
  toast(`Updated ${ids.length} stud${ids.length > 1 ? 'ies' : 'y'}${failCount ? `, ${failCount} operations failed` : ''}.`, failCount ? 'error' : 'success');
  document.getElementById('dicom-bulk-modality').value = '';
  document.getElementById('dicom-bulk-status').value = '';
  filterDicom();
}

async function assignSelectedStudies() {
  const selectedVal = document.getElementById('dicom-assign-doctor').value;
  if (!selectedVal) { toast('Please select a doctor or group first.', 'error'); return; }
  const checkedBoxes = Array.from(document.querySelectorAll('.dicom-row-cb:checked'));
  const ids = checkedBoxes.map(cb => parseInt(cb.value));
  if (!ids.length) { toast('No studies selected.', 'error'); return; }

  let assignLabel = '';
  let doctorNames = [];
  let isGroup = false;

  if (selectedVal.startsWith('__group__')) {
    const groupId = selectedVal.replace('__group__', '');
    const groups = await loadGroupsFromStorage();
    const group = groups.find(g => g.id === groupId);
    if (!group) { toast('Group not found.', 'error'); return; }
    assignLabel = group.name;
    isGroup = true;

    const groupMap = await loadUserGroupMap();
    let usersInGroup = allUsers.filter(u => groupMap[String(u.id)] === groupId);

    if (!usersInGroup.length) {
      try {
        const res = await api('/api/users/');
        if (res.ok) {
          const fetched = await res.json();
          fetched.forEach(u => {
            if (!u.userprofile) u.userprofile = {};
            u.userprofile.group_id = groupMap[String(u.id)] || '';
          });
          usersInGroup = fetched.filter(u => groupMap[String(u.id)] === groupId);
        }
      } catch {}
    }

    const doctorUsers = usersInGroup.filter(u => {
      const role = (u.userprofile && u.userprofile.role_name) || '';
      return role === 'Doctor';
    });

    if (!doctorUsers.length) { toast(`Group "${group.name}" has no doctors assigned.`, 'error'); return; }
    doctorNames = doctorUsers.map(u => (u.userprofile && u.userprofile.full_name) || u.username);
  } else {
    assignLabel = selectedVal;
    doctorNames = [selectedVal];
  }

  if (isGroup) {
    const res = await api('/api/dicom-images/assign_doctors/', {
      method: 'POST',
      body: JSON.stringify({ image_ids: ids, doctor_names: doctorNames })
    });
    if (res.ok) {
      toast(`Assigned ${ids.length} stud${ids.length > 1 ? 'ies' : 'y'} to group "${assignLabel}".`, 'success');
      filterDicom();
    } else {
      const err = await res.json().catch(() => ({}));
      toast(err.error || 'Failed to assign studies.', 'error');
    }
    return;
  }

  const res = await api('/api/dicom-images/assign_doctors/', {
    method: 'POST',
    body: JSON.stringify({ image_ids: ids, doctor_names: doctorNames })
  });
  if (res.ok) {
    toast(`Assigned ${ids.length} stud${ids.length > 1 ? 'ies' : 'y'} to ${assignLabel}.`, 'success');
    filterDicom();
  } else {
    const err = await res.json().catch(() => ({}));
    toast(err.error || 'Failed to assign studies.', 'error');
  }
}

async function renderDicom() {
  const statusColors = { 'Not Assigned': 'gray', 'Unreported': 'yellow', 'Draft': 'blue', 'Reviewed': 'purple', 'Reported': 'green' };
  const tbody = document.getElementById('dicom-table-body');
  const total = allDicom.length;
  const totalPages = Math.max(1, Math.ceil(total / dicomRowsPerPage));
  if (dicomCurrentPage > totalPages) dicomCurrentPage = totalPages;

  const start = (dicomCurrentPage - 1) * dicomRowsPerPage;
  const pageData = allDicom.slice(start, start + dicomRowsPerPage);

  const masterCb = document.getElementById('dicom-select-all');
  if (masterCb) masterCb.checked = false;
  const bulkPanel = document.getElementById('dicom-bulk-panel');
  if (bulkPanel) bulkPanel.style.display = 'none';

  document.getElementById('dicom-count').textContent = `${total} records found`;

  const knownGroups = await loadGroupsFromStorage();

  if (!total) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🖼</div><div class="empty-title">No studies found</div></div></td></tr>';
    renderDicomPagination(0, 1);
    return;
  }

  tbody.innerHTML = pageData.map(d => {
    const sc = statusColors[d.status] || 'gray';
    const date = d.formatted_study_date || d.study_date || '—';
    const assignedList = d.assigned_doctors_list || [];
    let assignedDisplay = '<span style="color:var(--text3);">—</span>';
    if (assignedList.length) {
      assignedDisplay = assignedList.map(name => {
        const matchedGroup = knownGroups.find(g => g.name === name);
        if (matchedGroup) {
          return `<span class="badge badge-purple" style="margin:1px;">${name}</span>`;
        }
        return `<span style="font-size:12px;">${name}</span>`;
      }).join(' ');
    }
    const institute = d.institute_name || '—';
    const patientNameEsc = (d.patient_name || '').replace(/'/g, "\\'");
    const patientIdEsc = (d.patient_id || '').replace(/'/g, "\\'");
    return `<tr>
      <td><input type="checkbox" class="dicom-row-cb" value="${d.id}" onchange="updateDicomAssignPanel()" /></td>
      <td><span style="font-weight:500;color:var(--text);">${d.patient_name || '—'}</span></td>
      <td><span class="tag">${d.patient_id || '—'}</span></td>
      <td><span class="badge badge-purple">${d.modality || '—'}</span></td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${assignedDisplay}</td>
      <td style="font-size:12px;">${institute}</td>
      <td style="font-family:var(--mono);font-size:12px;">${date}</td>
      <td><span class="badge badge-${sc}" style="cursor:pointer;" onclick="openStatusModal(${d.id}, '${d.status}')">${d.status || '—'}</span></td>
      <td><div class="actions-cell">
        <button class="btn btn-ghost btn-xs" onclick="openEditStudyModal(${d.id})">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="deleteStudyAllImages('${patientIdEsc}', '${patientNameEsc}')">Delete</button>
      </div></td>
    </tr>`;
  }).join('');

  renderDicomPagination(total, totalPages);
}

function renderDicomPagination(total, totalPages) {
  let container = document.getElementById('dicom-pagination');
  if (!container) {
    const cardBody = document.querySelector('#dicom-results-card .card-body');
    container = document.createElement('div');
    container.id = 'dicom-pagination';
    container.className = 'pagination-container';
    cardBody.appendChild(container);
  }

  if (total === 0) { container.style.display = 'none'; return; }

  const startIndex = (dicomCurrentPage - 1) * dicomRowsPerPage;
  const endIndex = Math.min(startIndex + dicomRowsPerPage, total);

  container.style.display = 'block';

  let html = '<div class="pagination-wrapper">';
  html += `<div class="pagination-info"><span id="dicom-pagination-info">Showing ${startIndex + 1}-${endIndex} of ${total} records</span></div>`;
  html += '<div class="pagination-controls">';
  html += '<div class="items-per-page"><label>Items per page:</label>';
  html += `<select onchange="dicomRowsPerPage=parseInt(this.value);dicomCurrentPage=1;renderDicom();">`;
  html += [25, 50, 100, 200].map(n => `<option value="${n}"${n === dicomRowsPerPage ? ' selected' : ''}>${n}</option>`).join('');
  html += '</select></div>';
  html += '<div class="pagination-buttons" id="dicom-pagination-buttons"></div>';
  html += '</div></div>';

  container.innerHTML = html;

  renderDicomPaginationButtons(totalPages);
}

function renderDicomPaginationButtons(totalPages) {
  const container = document.getElementById('dicom-pagination-buttons');
  if (!container) return;

  let html = '';

  html += `<button class="pagination-btn" onclick="goToDicomPage(${dicomCurrentPage - 1})" ${dicomCurrentPage === 1 ? 'disabled' : ''}>‹</button>`;

  const maxButtons = 7;
  let startPage = Math.max(1, dicomCurrentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToDicomPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === dicomCurrentPage ? 'active' : ''}" onclick="goToDicomPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
    html += `<button class="pagination-btn" onclick="goToDicomPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" onclick="goToDicomPage(${dicomCurrentPage + 1})" ${dicomCurrentPage === totalPages ? 'disabled' : ''}>›</button>`;

  container.innerHTML = html;
}

function goToDicomPage(page) {
  const totalPages = Math.ceil(allDicom.length / dicomRowsPerPage);
  if (page < 1 || page > totalPages) return;
  dicomCurrentPage = page;
  renderDicom();
}

let currentDicomId = null;

function openStatusModal(dicomId, currentStatus) {
  currentDicomId = dicomId;
  document.getElementById('status-select').value = currentStatus;
  document.getElementById('status-reported-by').value = '';
  document.getElementById('status-modal-error').style.display = 'none';
  openModal('update-status-modal');
}

async function submitStatusUpdate() {
  const newStatus = document.getElementById('status-select').value;
  const reportedBy = document.getElementById('status-reported-by').value.trim();
  const errEl = document.getElementById('status-modal-error');
  if (!newStatus) { errEl.textContent = 'Please select a status.'; errEl.style.display = 'inline-flex'; return; }
  const body = { status: newStatus };
  if (reportedBy) body.reported_by = reportedBy;
  const res = await api(`/api/dicom-images/${currentDicomId}/update_status/`, { method: 'PATCH', body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) {
    toast('Status updated successfully.', 'success');
    closeModal('update-status-modal');
    filterDicom();
  } else {
    errEl.textContent = data.error || data.detail || 'Failed to update status.';
    errEl.style.display = 'inline-flex';
  }
}

function openEditStudyModal(dicomId) {
  const study = allDicom.find(d => d.id === dicomId);
  if (!study) return;
  document.getElementById('edit-study-id').value = dicomId;
  document.getElementById('edit-study-patient-name').value = study.patient_name || '';
  document.getElementById('edit-study-patient-id').value = study.patient_id || '';
  document.getElementById('edit-study-institute').value = study.institute_name || '';
  document.getElementById('edit-study-center').value = study.center_name || '';
  document.getElementById('edit-study-modality').value = study.modality || '';
  document.getElementById('edit-study-status').value = study.status || 'Not Assigned';
  document.getElementById('edit-study-description').value = study.study_description || '';
  document.getElementById('edit-study-referring').value = study.referring_physician || '';
  document.getElementById('edit-study-reported-by').value = study.reported_by || '';
  document.getElementById('edit-study-error').style.display = 'none';
  openModal('edit-study-modal');
}

async function submitEditStudy() {
  const dicomId = parseInt(document.getElementById('edit-study-id').value);
  const errEl = document.getElementById('edit-study-error');

  const originalStudy = allDicom.find(d => d.id === dicomId);
  const originalPatientId = originalStudy ? originalStudy.patient_id : null;

  const payload = {
    patient_name: document.getElementById('edit-study-patient-name').value.trim(),
    patient_id: document.getElementById('edit-study-patient-id').value.trim(),
    center_name: document.getElementById('edit-study-center').value.trim(),
    modality: document.getElementById('edit-study-modality').value,
    status: document.getElementById('edit-study-status').value,
    study_description: document.getElementById('edit-study-description').value.trim(),
    referring_physician: document.getElementById('edit-study-referring').value.trim(),
    reported_by: document.getElementById('edit-study-reported-by').value.trim()
  };

  if (!payload.patient_name) {
    errEl.textContent = 'Patient name is required.';
    errEl.style.display = 'inline-flex';
    return;
  }

  try {
    let allIds = [];
    if (originalPatientId) {
      let page = 1;
      while (true) {
        const params = new URLSearchParams({ patient_id: originalPatientId, page: String(page), page_size: '500' });
        const r = await api(`/api/dicom-images/?${params.toString()}`);
        if (!r.ok) break;
        const d = await r.json();
        const results = d.results || [];
        results.forEach(img => { if (img.patient_id === originalPatientId) allIds.push(img.id); });
        if (!d.next) break;
        page++;
      }
    }

    if (!allIds.length) allIds = [dicomId];

    let failed = 0;
    for (const id of allIds) {
      const r = await api(`/api/dicom-images/${id}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      if (!r.ok) failed++;
    }

    if (failed === 0) {
      toast(`Updated ${allIds.length} image(s) successfully.`, 'success');
      closeModal('edit-study-modal');
      filterDicom();
    } else {
      const data = await api(`/api/dicom-images/${dicomId}/`, { method: 'PATCH', body: JSON.stringify(payload) }).then(r => r.json()).catch(() => ({}));
      errEl.textContent = data.detail || data.error || `Failed to update ${failed} image(s).`;
      errEl.style.display = 'inline-flex';
    }
  } catch (e) {
    errEl.textContent = 'An error occurred while saving.';
    errEl.style.display = 'inline-flex';
  }
}

async function deleteStudyAllImages(patientId, patientName) {
  if (!patientId) { toast('Cannot identify patient for deletion.', 'error'); return; }

  openConfirm(
    'Delete All Patient Images?',
    `This will permanently delete all images for patient "${patientName}" (ID: ${patientId}), including all modalities. This cannot be undone.`,
    async () => {
      try {
        let allIds = [];
        let page = 1;
        const pageFetches = [];
        const firstParams = new URLSearchParams({ patient_id: patientId, page: '1', page_size: '2000' });
        const firstRes = await api(`/api/dicom-images/?${firstParams.toString()}`);
        if (!firstRes.ok) { toast('Failed to fetch patient images.', 'error'); return; }
        const firstData = await firstRes.json();
        (firstData.results || []).forEach(img => { if (img.patient_id === patientId) allIds.push(img.id); });

        if (firstData.next) {
          const totalPages = Math.ceil((firstData.count || allIds.length) / 2000);
          for (let p = 2; p <= totalPages; p++) {
            const params = new URLSearchParams({ patient_id: patientId, page: String(p), page_size: '2000' });
            pageFetches.push(api(`/api/dicom-images/?${params.toString()}`).then(r => r.ok ? r.json() : { results: [] }));
          }
          const extraPages = await Promise.all(pageFetches);
          extraPages.forEach(data => (data.results || []).forEach(img => { if (img.patient_id === patientId) allIds.push(img.id); }));
        }

        if (!allIds.length) {
          toast('No images found for this patient.', 'error');
          return;
        }

        const results = await Promise.all(allIds.map(id => api(`/api/dicom-images/${id}/`, { method: 'DELETE' }).then(r => r.status === 204 || r.ok).catch(() => false)));
        const deleted = results.filter(Boolean).length;
        const failed = allIds.length - deleted;

        if (failed === 0) {
          toast(`Deleted ${deleted} image(s) for "${patientName}".`, 'success');
        } else {
          toast(`Deleted ${deleted}, failed ${failed} image(s).`, 'error');
        }
        filterDicom();
        loadDashboard();
      } catch (e) {
        toast('An error occurred during deletion.', 'error');
      }
    }
  );
}

let allTemplates = [], editingTemplateId = null;

const TEMPLATE_MODALITY_OPTIONS = {
  'CT TEMPLATES': ['CT'],
  'MRI TEMPLATES': ['MR'],
  'X-RAY TEMPLATES': ['CR', 'RF', 'DX', 'MG', 'DR', 'PX']
};

function fillTemplateModalityOptions(bodyPart, selected) {
  const sel = document.getElementById('tpl-modality');
  const options = TEMPLATE_MODALITY_OPTIONS[bodyPart] || [];
  if (!options.length) {
    sel.innerHTML = '<option value="">Select Body Part first</option>';
    return;
  }
  sel.innerHTML = '<option value="">Select Modality</option>' +
    options.map(m => `<option value="${m}">${m}</option>`).join('');
  if (selected && options.includes(selected)) {
    sel.value = selected;
  }
}

document.getElementById('tpl-body-part').addEventListener('change', function() {
  fillTemplateModalityOptions(this.value, '');
});

async function loadTemplates() {
  document.getElementById('templates-table-body').innerHTML = '<tr><td colspan="7" class="loading">Loading templates</td></tr>';
  try {
    const res = await api('/api/manage-templates/');
    if (!res.ok) throw new Error();
    const data = await res.json();
    allTemplates = data.templates || [];
    renderTemplates(allTemplates);
  } catch {
    document.getElementById('templates-table-body').innerHTML = '<tr><td colspan="7" style="padding:20px;text-align:center;color:var(--red);">Failed to load templates</td></tr>';
  }
}

function renderTemplates(templates) {
  const tbody = document.getElementById('templates-table-body');
  if (!templates.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No templates yet</div><div class="empty-text">Click "New Template" to create one.</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = templates.map(t => {
    const date = t.created_at ? new Date(t.created_at).toLocaleDateString() : '—';
    return `<tr>
      <td><span class="badge badge-blue">${t.body_part}</span></td>
      <td>${t.modality || '—'}</td>
      <td><span style="font-weight:500;color:var(--text);">${t.template_name}</span></td>
      <td>${t.created_by_username || '<span style="color:var(--text3);">System</span>'}</td>
      <td>${t.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
      <td style="font-size:12px;color:var(--text3);">${date}</td>
      <td><div class="actions-cell">
        <button class="btn btn-ghost btn-xs" onclick="openEditTemplate(${t.id})">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="deleteTemplate(${t.id}, '${(t.template_name || '').replace(/'/g,"\\'")}')">Delete</button>
      </div></td>
    </tr>`;
  }).join('');
}


function goToCreateTemplate() {
  document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelector(".nav-item[data-page=templates]").classList.add("active");
  document.getElementById("templates-page").classList.add("active");
  document.getElementById("page-title").textContent = "Report Templates";
  document.getElementById("page-subtitle").textContent = "Manage report templates";
  loadTemplates();
  openCreateTemplateModal();
}
function openCreateTemplateModal() {
  editingTemplateId = null;
  document.getElementById('tpl-modal-title').textContent = 'New Template';
  document.getElementById('tpl-body-part').value = '';
  fillTemplateModalityOptions('', '');
  document.getElementById('tpl-name').value = '';
  document.getElementById('tpl-content').value = '';
  document.getElementById('tpl-active').checked = true;
  document.getElementById('tpl-modal-error').style.display = 'none';
  openModal('template-modal');
}

function openEditTemplate(id) {
  const t = allTemplates.find(x => x.id === id);
  if (!t) return;
  editingTemplateId = id;
  document.getElementById('tpl-modal-title').textContent = 'Edit Template';
  document.getElementById('tpl-body-part').value = t.body_part || '';
  fillTemplateModalityOptions(t.body_part || '', t.modality || '');
  document.getElementById('tpl-name').value = t.template_name || '';
  document.getElementById('tpl-content').value = t.content || '';
  document.getElementById('tpl-active').checked = t.is_active !== false;
  document.getElementById('tpl-modal-error').style.display = 'none';
  openModal('template-modal');
}

async function saveTemplate() {
  const body_part = document.getElementById('tpl-body-part').value.trim();
  const modality = document.getElementById('tpl-modality').value.trim();
  const template_name = document.getElementById('tpl-name').value.trim();
  const content = document.getElementById('tpl-content').value.trim();
  const is_active = document.getElementById('tpl-active').checked;
  const errEl = document.getElementById('tpl-modal-error');
  if (!body_part || !modality || !template_name || !content) { errEl.textContent = 'Body part, modality, name and content are required.'; errEl.style.display = 'inline-flex'; return; }
  const payload = { body_part, modality, template_name, content, is_active };
  let res;
  if (editingTemplateId) {
    res = await api('/api/manage-templates/', { method: 'PUT', body: JSON.stringify({ ...payload, id: editingTemplateId }) });
  } else {
    res = await api('/api/manage-templates/', { method: 'POST', body: JSON.stringify(payload) });
  }
  const data = await res.json();
  if (res.ok) {
    toast(editingTemplateId ? 'Template updated!' : 'Template created!', 'success');
    closeModal('template-modal');
    loadTemplates();
    loadDashboard();
  } else {
    errEl.textContent = data.detail || data.error || 'Failed to save template.';
    errEl.style.display = 'inline-flex';
  }
}

function deleteTemplate(id, name) {
  openConfirm('Delete Template?', `Delete "${name}"? This cannot be undone.`, async () => {
    const res = await api('/api/manage-templates/', { method: 'DELETE', body: JSON.stringify({ id }) });
    if (res.ok || res.status === 204) { toast('Template deleted.', 'success'); loadTemplates(); loadDashboard(); }
    else { toast('Failed to delete template.', 'error'); }
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open, .confirm-dialog.open').forEach(m => m.classList.remove('open'));
});

let allGroups = [];
let editingGroupId = null;
let userGroupMapCache = {};

async function loadGroupsFromStorage() {
  try {
    const res = await api('/api/doctor-groups/');
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return [];
}

async function saveUserGroupAssignment(userId, groupId, userName) {
  userGroupMapCache[String(userId)] = groupId || '';

  if (!userName) {
    const user = allUsers.find(u => u.id === userId);
    userName = (user && user.userprofile && user.userprofile.full_name) || (user && user.username) || '';
  }
  if (!userName) return;

  const groups = await loadGroupsFromStorage();

  for (const group of groups) {
    const members = (group.members || []).slice();
    const inGroup = members.includes(userName);

    if (group.id === groupId && !inGroup) {
      members.push(userName);
      await api(`/api/doctor-groups/${group.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members })
      });
      const idx = allGroups.findIndex(g => g.id === group.id);
      if (idx !== -1) allGroups[idx].members = members;
    } else if (group.id !== groupId && inGroup) {
      const updated = members.filter(m => m !== userName);
      await api(`/api/doctor-groups/${group.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: updated })
      });
      const idx = allGroups.findIndex(g => g.id === group.id);
      if (idx !== -1) allGroups[idx].members = updated;
    }
  }
}

async function loadUserGroupMap() {
  const groups = await loadGroupsFromStorage();
  const map = {};
  try {
    const res = await api('/api/users/');
    if (!res.ok) return userGroupMapCache;
    const users = await res.json();
    groups.forEach(group => {
      const members = group.members || [];
      users.forEach(u => {
        const name = (u.userprofile && u.userprofile.full_name) || u.username || '';
        if (members.includes(name)) {
          map[String(u.id)] = group.id;
        }
      });
    });
  } catch {}
  Object.assign(userGroupMapCache, map);
  return map;
}

async function populateGroupDropdown(selectId, selectedGroupId) {
  const groups = await loadGroupsFromStorage();
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">No Group</option>' +
    groups.filter(g => g.enabled !== false).map(g => `<option value="${g.id}"${g.id === selectedGroupId ? ' selected' : ''}>${g.name}</option>`).join('');
}

async function loadGroups() {
  document.getElementById('groups-table-body').innerHTML = '<tr><td colspan="5" class="loading">Loading groups…</td></tr>';
  allGroups = await loadGroupsFromStorage();
  renderGroups(allGroups);
}

function filterGroups() {
  const q = document.getElementById('group-search').value.toLowerCase();
  const filtered = allGroups.filter(g => (g.name || '').toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q));
  renderGroups(filtered);
}

function renderGroups(groups) {
  const tbody = document.getElementById('groups-table-body');
  if (!groups.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No groups yet</div><div class="empty-text">Click "New Group" to create a doctor group.</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = groups.map(g => {
    const enabledBadge = g.enabled !== false
      ? `<span class="badge badge-green">Enabled</span>`
      : `<span class="badge badge-gray">Disabled</span>`;
    const toggleLabel = g.enabled !== false ? 'Disable' : 'Enable';
    const toggleCls = g.enabled !== false ? 'btn-warning' : 'btn-success';
    const safeName = (g.name || '').replace(/'/g, "\\'");
    const memberCount = (g.members || []).length;
    return `<tr>
      <td><span style="font-weight:600;color:var(--primary);cursor:pointer;text-decoration:underline;" onclick="openEditGroupModal('${g.id}')">${g.name}</span></td>
      <td><span style="font-weight:600;">${memberCount}</span></td>
      <td>${enabledBadge}</td>
      <td style="color:var(--text2);font-size:13px;">${g.description || '<span style="color:var(--text3);">—</span>'}</td>
      <td><div class="actions-cell">
        <button class="btn ${toggleCls} btn-xs" onclick="toggleGroupEnabled('${g.id}', ${g.enabled !== false})">${toggleLabel}</button>
        <button class="btn btn-danger btn-xs" onclick="deleteGroup('${g.id}', '${safeName}')">Delete</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function toggleGroupEnabled(id, currentlyEnabled) {
  try {
    const res = await api(`/api/doctor-groups/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentlyEnabled })
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = allGroups.findIndex(g => g.id === id);
    if (idx !== -1) allGroups[idx] = updated;
    renderGroups(allGroups);
    toast(`Group ${!currentlyEnabled ? 'enabled' : 'disabled'}.`, 'success');
  } catch {
    toast('Failed to update group.', 'error');
  }
}

function openCreateGroupModal() {
  editingGroupId = null;
  document.getElementById('group-name').value = '';
  document.getElementById('group-description').value = '';
  document.getElementById('group-enabled').checked = true;
  document.getElementById('group-modal-error').style.display = 'none';
  document.getElementById('group-modal-title').textContent = 'Create New Group';
  document.getElementById('group-modal-save-btn').textContent = 'Save Group';
  openModal('create-group-modal');
}

function openEditGroupModal(groupId) {
  const group = allGroups.find(g => g.id === groupId);
  if (!group) return;
  editingGroupId = groupId;
  document.getElementById('group-name').value = group.name || '';
  document.getElementById('group-description').value = group.description || '';
  document.getElementById('group-enabled').checked = group.enabled !== false;
  document.getElementById('group-modal-error').style.display = 'none';
  document.getElementById('group-modal-title').textContent = 'Edit Group';
  document.getElementById('group-modal-save-btn').textContent = 'Update Group';
  openModal('create-group-modal');
}

async function saveGroup() {
  const name = document.getElementById('group-name').value.trim();
  const description = document.getElementById('group-description').value.trim();
  const enabled = document.getElementById('group-enabled').checked;
  const errEl = document.getElementById('group-modal-error');
  if (!name) {
    errEl.textContent = 'Group name is required.';
    errEl.style.display = 'inline-flex';
    return;
  }
  try {
    if (editingGroupId) {
      const res = await api(`/api/doctor-groups/${editingGroupId}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, enabled })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errEl.textContent = err.error || 'Failed to update group.';
        errEl.style.display = 'inline-flex';
        return;
      }
      const updated = await res.json();
      const idx = allGroups.findIndex(g => g.id === editingGroupId);
      if (idx !== -1) allGroups[idx] = updated;
      toast('Group updated!', 'success');
      closeModal('create-group-modal');
      renderGroups(allGroups);
    } else {
      const res = await api('/api/doctor-groups/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, enabled })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errEl.textContent = err.error || 'Failed to create group.';
        errEl.style.display = 'inline-flex';
        return;
      }
      const newGroup = await res.json();
      allGroups.push(newGroup);
      toast('Group created!', 'success');
      closeModal('create-group-modal');
      renderGroups(allGroups);
    }
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'inline-flex';
  }
}

function deleteGroup(id, name) {
  openConfirm('Delete Group?', `Delete "${name}"? This cannot be undone.`, async () => {
    try {
      const res = await api(`/api/doctor-groups/${id}/`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      allGroups = allGroups.filter(g => g.id !== id);
      toast('Group deleted.', 'success');
      renderGroups(allGroups);
    } catch {
      toast('Failed to delete group.', 'error');
    }
  });
}

let managingGroupId = null;

async function openManageMembersModal(groupId, groupName) {
  managingGroupId = groupId;
  document.getElementById('members-modal-group-name').textContent = groupName;
  document.getElementById('members-modal-error').style.display = 'none';

  const container = document.getElementById('members-doctor-list');
  container.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:13px;">Loading doctors...</div>';
  openModal('manage-members-modal');

  let doctors = [];
  try {
    const res = await api('/api/doctors/');
    if (res.ok) {
      const d = await res.json();
      doctors = (d.doctors || []).map(doc => doc.name).filter(Boolean);
    }
  } catch {}

  const group = allGroups.find(g => g.id === groupId);
  const currentMembers = (group && group.members) || [];

  if (!doctors.length) {
    container.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:13px;">No doctors found.</div>';
    return;
  }

  container.innerHTML = doctors.map(name => {
    const checked = currentMembers.includes(name) ? 'checked' : '';
    const safeId = 'mcb_' + name.replace(/\W/g, '_');
    return `<div class="multi-select-item">
      <input type="checkbox" class="checkbox" id="${safeId}" value="${name}" ${checked} />
      <label class="permission-label" for="${safeId}" style="cursor:pointer;">${name}</label>
    </div>`;
  }).join('');
}

async function saveGroupMembers() {
  const checked = Array.from(document.querySelectorAll('#members-doctor-list input[type="checkbox"]:checked')).map(cb => cb.value);
  try {
    const res = await api(`/api/doctor-groups/${managingGroupId}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: checked })
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    const idx = allGroups.findIndex(g => g.id === managingGroupId);
    if (idx !== -1) allGroups[idx] = updated;
    toast('Members saved!', 'success');
    closeModal('manage-members-modal');
    renderGroups(allGroups);
  } catch {
    document.getElementById('members-modal-error').textContent = 'Failed to save members.';
    document.getElementById('members-modal-error').style.display = 'inline-flex';
  }
}

let allSessions = [];

async function loadSessions() {
  document.getElementById('sessions-table-body').innerHTML = '<tr><td colspan="6" class="loading">Loading sessions</td></tr>';
  try {
    const res = await api('/api/active-sessions/');
    if (!res.ok) throw new Error();
    const data = await res.json();
    allSessions = data.sessions || [];
    renderSessions(allSessions);
  } catch {
    document.getElementById('sessions-table-body').innerHTML = '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--red);">Failed to load sessions</td></tr>';
  }
}

function renderSessions(sessions) {
  const tbody = document.getElementById('sessions-table-body');
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">No active sessions</div><div class="empty-text">No users are currently logged in.</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = sessions.map(s => {
    const loginTime = s.login_time ? new Date(s.login_time).toLocaleString() : '—';
    const lastActivity = s.last_activity ? new Date(s.last_activity).toLocaleString() : '—';
    const isMe = currentUser && currentUser.id === s.user_id;
    return `<tr>
      <td><span style="font-weight:500;color:var(--text);">${s.username}${isMe ? ' <span class="badge badge-blue" style="font-size:10px;">You</span>' : ''}</span></td>
      <td><span class="badge badge-purple">${s.role}</span></td>
      <td><span class="tag">${s.client_ip}</span></td>
      <td style="font-size:12px;color:var(--text3);">${loginTime}</td>
      <td style="font-size:12px;color:var(--text3);">${lastActivity}</td>
      <td>
        ${isMe ? '<span style="color:var(--text3);font-size:12px;">—</span>' : `<button class="btn btn-danger btn-xs" onclick="killSession(${s.user_id}, '${(s.username || '').replace(/'/g, "\\'")}')">Kill Session</button>`}
      </td>
    </tr>`;
  }).join('');
}

function killSession(userId, username) {
  openConfirm('Disconnect User?', `Force logout "${username}"? Their session will be terminated immediately.`, async () => {
    const res = await api('/api/kill-session/', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
    if (res.ok) {
      toast(`${username} has been disconnected.`, 'success');
      loadSessions();
    } else {
      toast('Failed to disconnect user.', 'error');
    }
  });
}

loadCurrentUser();
loadDashboard();

const ALERT_TYPES = [
  { key: 'new_study', label: 'New Study Alert' },
  { key: 'new_image', label: 'New Image Added Alert' },
  { key: 'emergency', label: 'Emergency Study Alert' },
  { key: 'report_done', label: 'Report Done Alert' },
  { key: 'report_delay', label: 'Reporting Delay SMS Alert' }
];

const SMS_RECIPIENTS = [
  { key: 'client_center', label: 'Client Center' },
  { key: 'ref_physician', label: 'Ref. Physician' },
  { key: 'others', label: 'Others' }
];

let alertSettings = {};

function buildAlertUI() {
  const container = document.getElementById('alert-types-list');
  if (!container) return;
  container.innerHTML = '';
  ALERT_TYPES.forEach(type => {
    const saved = alertSettings[type.key] || {};
    const block = document.createElement('div');
    block.className = 'alert-type-block';
    block.innerHTML = `
      <div class="alert-type-header" onclick="toggleAlertType('${type.key}', event)">
        <input type="checkbox" id="alert-chk-${type.key}" ${saved.enabled ? 'checked' : ''} onclick="event.stopPropagation(); toggleAlertType('${type.key}', event, true)" />
        <span>${type.label}</span>
      </div>
      <div class="alert-channel-panel ${saved.enabled ? 'open' : ''}" id="alert-panel-${type.key}">
        ${buildSMSBlock(type.key, saved)}
        ${buildEmailBlock(type.key, saved)}
      </div>
    `;
    container.appendChild(block);
  });
}

function buildSMSBlock(typeKey, saved) {
  const smsEnabled = saved.sms && saved.sms.enabled;
  const recipientRows = SMS_RECIPIENTS.map(r => {
    const rSaved = (saved.sms && saved.sms.recipients && saved.sms.recipients[r.key]) || {};
    const numbersVal = Array.isArray(rSaved.numbers) ? rSaved.numbers.join('\n') : (rSaved.numbers || '');
    return `
      <div class="alert-recipient-row">
        <div class="alert-recipient-label">
          <input type="checkbox" id="alert-sms-${typeKey}-${r.key}" ${rSaved.enabled ? 'checked' : ''} disabled />
          <label for="alert-sms-${typeKey}-${r.key}">${r.label}</label>
        </div>
        <div class="alert-msg-col">
          <label>Message Format</label>
          <textarea id="alert-sms-${typeKey}-${r.key}-msg" placeholder="Message format..." disabled>${rSaved.message || ''}</textarea>
        </div>
        <div class="alert-num-col">
          <label>Numbers <span style="font-weight:400;color:var(--text3);font-size:10px;">(one per line)</span></label>
          <textarea id="alert-sms-${typeKey}-${r.key}-numbers" placeholder="017XXXXXXXX&#10;018XXXXXXXX" disabled>${numbersVal}</textarea>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="alert-channel-section">
      <div class="alert-channel-header alert-channel-disabled">
        <input type="checkbox" id="alert-sms-chk-${typeKey}" ${smsEnabled ? 'checked' : ''} disabled />
        <span>SMS</span>
      </div>
      <div class="alert-channel-fields ${smsEnabled ? 'open' : ''}" id="sms-fields-${typeKey}">
        ${recipientRows}
      </div>
    </div>`;
}

function buildEmailBlock(typeKey, saved) {
  const emailEnabled = saved.email && saved.email.enabled;
  const emailRecipients = [
    { key: 'client', label: 'Client Center' },
    { key: 'doctor', label: 'Ref. Physician' },
    { key: 'others', label: 'Others' }
  ];

  const rows = emailRecipients.map(r => {
    const msgVal = (saved.email && saved.email[r.key + 'Message']) || '';
    const addrRaw = (saved.email && saved.email[r.key + 'Addresses']);
    let addrVal = '';
    if (Array.isArray(addrRaw)) {
      addrVal = addrRaw.join('\n');
    } else if (typeof addrRaw === 'string' && addrRaw.trim()) {
      addrVal = addrRaw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean).join('\n');
    }
    const checked = (saved.email && saved.email[r.key]) ? 'checked' : '';
    return `
      <div class="alert-recipient-row">
        <div class="alert-recipient-label">
          <input type="checkbox" id="alert-email-${typeKey}-${r.key}" ${checked} />
          <label for="alert-email-${typeKey}-${r.key}">${r.label}</label>
        </div>
        <div class="alert-msg-col">
          <label>E-Mail Format</label>
          <textarea id="alert-email-${typeKey}-${r.key}-msg" placeholder="Email message format...">${msgVal}</textarea>
        </div>
        <div class="alert-num-col">
          <label>E-Mail Id <span style="font-weight:400;color:var(--text3);font-size:10px;">(one per line)</span></label>
          <textarea id="alert-email-${typeKey}-${r.key}-addr" placeholder="email@example.com&#10;other@example.com" onblur="normalizeEmailAddresses(this)">${addrVal}</textarea>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="alert-channel-section">
      <div class="alert-channel-header" onclick="toggleChannel('email-fields-${typeKey}', event)">
        <input type="checkbox" id="alert-email-chk-${typeKey}" ${emailEnabled ? 'checked' : ''} onclick="event.stopPropagation(); toggleChannel('email-fields-${typeKey}', event, true)" />
        <span>E-Mail</span>
      </div>
      <div class="alert-channel-fields ${emailEnabled ? 'open' : ''}" id="email-fields-${typeKey}">
        ${rows}
      </div>
    </div>`;
}

function toggleAlertType(typeKey, event, fromCheckbox) {
  const chk = document.getElementById(`alert-chk-${typeKey}`);
  const panel = document.getElementById(`alert-panel-${typeKey}`);
  if (!fromCheckbox) chk.checked = !chk.checked;
  panel.classList.toggle('open', chk.checked);
}

function toggleChannel(fieldId, event, fromCheckbox) {
  const fields = document.getElementById(fieldId);
  const prefix = fieldId.startsWith('sms') ? 'alert-sms-chk-' : 'alert-email-chk-';
  const suffix = fieldId.startsWith('sms') ? fieldId.replace('sms-fields-', '') : fieldId.replace('email-fields-', '');
  const chk = document.getElementById(prefix + suffix);
  if (!fromCheckbox && chk) chk.checked = !chk.checked;
  if (fields) fields.classList.toggle('open', chk ? chk.checked : true);
}

function normalizeEmailAddresses(textarea) {
  const lines = textarea.value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  textarea.value = lines.join('\n');
}

function splitLines(val) {
  if (!val) return [];
  return val.split('\n').map(s => s.trim()).filter(Boolean);
}

function collectAlertSettings() {
  const result = {};
  ALERT_TYPES.forEach(type => {
    const enabled = document.getElementById(`alert-chk-${type.key}`)?.checked || false;
    const smsEnabled = document.getElementById(`alert-sms-chk-${type.key}`)?.checked || false;
    const emailEnabled = document.getElementById(`alert-email-chk-${type.key}`)?.checked || false;

    const recipients = {};
    SMS_RECIPIENTS.forEach(r => {
      recipients[r.key] = {
        enabled: document.getElementById(`alert-sms-${type.key}-${r.key}`)?.checked || false,
        message: document.getElementById(`alert-sms-${type.key}-${r.key}-msg`)?.value || '',
        numbers: splitLines(document.getElementById(`alert-sms-${type.key}-${r.key}-numbers`)?.value)
      };
    });

    const emailRecipients = ['client', 'doctor', 'others'];
    const emailData = { enabled: emailEnabled };
    emailRecipients.forEach(r => {
      emailData[r] = document.getElementById(`alert-email-${type.key}-${r}`)?.checked || false;
      emailData[r + 'Message'] = document.getElementById(`alert-email-${type.key}-${r}-msg`)?.value || '';
      emailData[r + 'Addresses'] = splitLines(document.getElementById(`alert-email-${type.key}-${r}-addr`)?.value);
    });

    result[type.key] = { enabled, sms: { enabled: smsEnabled, recipients }, email: emailData };
  });
  return result;
}

function saveAlertSettings() {
  alertSettings = collectAlertSettings();
  try { localStorage.setItem('pacs_alert_settings', JSON.stringify(alertSettings)); } catch (e) {}
  showToast('Alert settings saved successfully.', 'success');
}

function loadAlertSettings() {
  try {
    const stored = localStorage.getItem('pacs_alert_settings');
    if (stored) alertSettings = JSON.parse(stored);
  } catch (e) { alertSettings = {}; }
  buildAlertUI();
}

document.querySelectorAll('.nav-item').forEach(item => {
  if (item.getAttribute('data-page') === 'alerts') {
    item.addEventListener('click', () => { loadAlertSettings(); });
  }
});

let cpuHistory = [];
let memHistory = [];
const MAX_HISTORY = 30;
let serverRefreshTimer = null;
let drivePieInstances = {};

function stopServerRefresh() {
  if (serverRefreshTimer) {
    clearInterval(serverRefreshTimer);
    serverRefreshTimer = null;
  }
}

async function loadServerInfo() {
  const icon = document.getElementById('server-refresh-icon');
  if (icon) icon.textContent = '⟳';

  try {
    const res = await api('/api/server-info/');
    if (!res.ok) {
      renderServerError('Could not fetch server info. Make sure the /api/server-info/ endpoint is available.');
      if (icon) icon.textContent = '↻';
      return;
    }
    const data = await res.json();
    renderServerSystem(data);
    renderServerCPU(data);
    renderServerMemory(data);
    renderServerDrives(data);

    const now = new Date();
    const el = document.getElementById('server-last-updated');
    if (el) el.textContent = 'Last updated: ' + now.toLocaleTimeString();
  } catch (e) {
    renderServerError('Failed to connect to server info endpoint: ' + e.message);
  }

  if (icon) icon.textContent = '↻';
}

function renderServerError(msg) {
  ['server-system-body', 'server-cpu-body', 'server-mem-body', 'server-drives-body'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:13px;padding:8px 0;">${msg}</div>`;
  });
}

function renderServerSystem(data) {
  const el = document.getElementById('server-system-body');
  if (!el) return;
  const rows = [
    ['Operating System', data.os_name || '—'],
    ['OS Version', data.os_version || '—'],
    ['Hostname', data.hostname || '—'],
    ['Architecture', data.architecture || '—'],
    ['Boot Time', data.boot_time || '—'],
  ];
  el.innerHTML = rows.map(([label, val]) => `
    <div class="server-info-row">
      <span class="server-info-label">${label}</span>
      <span class="server-info-value">${val}</span>
    </div>`).join('');
}

function renderServerCPU(data) {
  const el = document.getElementById('server-cpu-body');
  if (!el) return;

  const usage = typeof data.cpu_usage === 'number' ? data.cpu_usage : 0;
  cpuHistory.push(usage);
  if (cpuHistory.length > MAX_HISTORY) cpuHistory.shift();

  const usageColor = usage > 85 ? 'var(--red)' : usage > 60 ? 'var(--yellow)' : 'var(--green)';

  el.innerHTML = `
    <div class="server-info-row">
      <span class="server-info-label">CPU Model</span>
      <span class="server-info-value">${data.cpu_model || '—'}</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Physical Cores</span>
      <span class="server-info-value">${data.cpu_physical_cores ?? '—'}</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Logical Cores</span>
      <span class="server-info-value">${data.cpu_logical_cores ?? '—'}</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Max Frequency</span>
      <span class="server-info-value">${data.cpu_max_freq ? data.cpu_max_freq + ' MHz' : '—'}</span>
    </div>
    <div class="usage-bar-wrap" style="margin-top:14px;">
      <div class="usage-bar-label">
        <span>CPU Usage</span>
        <span style="color:${usageColor};font-weight:700;">${usage.toFixed(1)}%</span>
      </div>
      <div class="usage-bar-track">
        <div class="usage-bar-fill cpu" style="width:${usage}%;"></div>
      </div>
    </div>
    <div style="margin-top:14px;font-size:12px;color:var(--text3);font-weight:600;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:4px;">Usage History</div>
    <div class="history-canvas-wrap">
      <canvas id="cpu-history-canvas" height="60"></canvas>
    </div>`;

  drawHistoryChart('cpu-history-canvas', cpuHistory, '#3d7eff', 'rgba(61,126,255,0.15)');
}

function renderServerMemory(data) {
  const el = document.getElementById('server-mem-body');
  if (!el) return;

  const usedPct = typeof data.memory_used_percent === 'number' ? data.memory_used_percent : 0;
  memHistory.push(usedPct);
  if (memHistory.length > MAX_HISTORY) memHistory.shift();

  const memColor = usedPct > 85 ? 'var(--red)' : usedPct > 65 ? 'var(--yellow)' : 'var(--green)';

  el.innerHTML = `
    <div class="server-info-row">
      <span class="server-info-label">Total RAM</span>
      <span class="server-info-value">${data.memory_total_gb ? data.memory_total_gb + ' GB' : '—'}</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Used</span>
      <span class="server-info-value">${data.memory_used_gb ? data.memory_used_gb + ' GB' : '—'}</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Free</span>
      <span class="server-info-value">${data.memory_free_gb ? data.memory_free_gb + ' GB' : '—'}</span>
    </div>
    <div class="server-info-row">
      <span class="server-info-label">Available</span>
      <span class="server-info-value">${data.memory_available_gb ? data.memory_available_gb + ' GB' : '—'}</span>
    </div>
    <div class="usage-bar-wrap" style="margin-top:14px;">
      <div class="usage-bar-label">
        <span>Memory Usage</span>
        <span style="color:${memColor};font-weight:700;">${usedPct.toFixed(1)}%</span>
      </div>
      <div class="usage-bar-track">
        <div class="usage-bar-fill mem" style="width:${usedPct}%;"></div>
      </div>
    </div>
    <div style="margin-top:14px;font-size:12px;color:var(--text3);font-weight:600;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:4px;">Usage History</div>
    <div class="history-canvas-wrap">
      <canvas id="mem-history-canvas" height="60"></canvas>
    </div>`;

  drawHistoryChart('mem-history-canvas', memHistory, '#16a34a', 'rgba(22,163,74,0.15)');
}

function renderServerDrives(data) {
  const el = document.getElementById('server-drives-body');
  if (!el) return;

  const drives = data.drives || [];
  if (!drives.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;">No drive information available.</div>';
    return;
  }

  Object.keys(drivePieInstances).forEach(k => {
    if (drivePieInstances[k] && drivePieInstances[k].destroy) drivePieInstances[k].destroy();
  });
  drivePieInstances = {};

  const colors = ['#3d7eff','#16a34a','#ea580c','#7c3aed','#ca8a04','#dc2626','#0891b2'];

  el.innerHTML = drives.map((drive, idx) => {
    const color = colors[idx % colors.length];
    const usedPct = drive.used_percent || 0;
    const freePct = drive.free_percent || 0;
    const driveId = 'pie-' + (drive.mountpoint || drive.device || idx).replace(/[^a-zA-Z0-9]/g, '_');
    return `
      <div class="drive-card">
        <div class="drive-card-header">
          <div class="drive-letter" style="background:${color}22;color:${color};">${(drive.mountpoint || drive.device || '?')[0].toUpperCase()}</div>
          <div>
            <div class="drive-name">${drive.mountpoint || drive.device || 'Drive'}</div>
            <div class="drive-total">Total: ${drive.total_gb} GB</div>
          </div>
        </div>
        <div class="drive-pie-wrap">
          <canvas id="${driveId}" width="120" height="120"></canvas>
        </div>
        <div class="drive-stats">
          <div class="drive-stat">
            <div class="drive-stat-val" style="color:${color};">${drive.used_gb} GB</div>
            <div class="drive-stat-lbl">Used (${usedPct.toFixed(2)}%)</div>
          </div>
          <div class="drive-stat">
            <div class="drive-stat-val" style="color:var(--green);">${drive.free_gb} GB</div>
            <div class="drive-stat-lbl">Free (${freePct.toFixed(2)}%)</div>
          </div>
        </div>
        <div class="usage-bar-wrap" style="margin-top:10px;">
          <div class="usage-bar-track">
            <div class="usage-bar-fill disk-used" style="width:${usedPct}%;background:${color};"></div>
          </div>
        </div>
      </div>`;
  }).join('');

  setTimeout(() => {
    drives.forEach((drive, idx) => {
      const color = colors[idx % colors.length];
      const driveId = 'pie-' + (drive.mountpoint || drive.device || idx).replace(/[^a-zA-Z0-9]/g, '_');
      const canvas = document.getElementById(driveId);
      if (!canvas) return;
      drawPieChart(canvas, drive.used_percent || 0, drive.free_percent || 0, color);
    });
  }, 50);
}

function drawHistoryChart(canvasId, data, lineColor, fillColor) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth || 300;
  const h = canvas.height;
  canvas.width = w;

  ctx.clearRect(0, 0, w, h);

  if (!data.length) return;

  const padTop = 4, padBottom = 4, padLeft = 2, padRight = 2;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  ctx.fillStyle = fillColor;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';

  const points = data.map((val, i) => ({
    x: padLeft + (i / (MAX_HISTORY - 1)) * chartW,
    y: padTop + chartH - (val / 100) * chartH
  }));

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.lineTo(points[points.length - 1].x, padTop + chartH);
  ctx.lineTo(points[0].x, padTop + chartH);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 0.5;
  [25, 50, 75].forEach(pct => {
    const y = padTop + chartH - (pct / 100) * chartH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + chartW, y);
    ctx.stroke();
  });
}

function drawPieChart(canvas, usedPct, freePct, usedColor) {
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r = Math.min(cx, cy) - 6;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const total = usedPct + freePct;
  const usedAngle = (usedPct / total) * Math.PI * 2;
  const freeAngle = (freePct / total) * Math.PI * 2;
  const start = -Math.PI / 2;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, start, start + usedAngle);
  ctx.closePath();
  ctx.fillStyle = usedColor;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, start + usedAngle, start + usedAngle + freeAngle);
  ctx.closePath();
  ctx.fillStyle = '#e5e7eb';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.fillStyle = usedColor;
  ctx.font = 'bold 13px DM Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(usedPct.toFixed(1) + '%', cx, cy);
}

document.querySelectorAll('.nav-item').forEach(item => {
  if (item.getAttribute('data-page') !== 'server') return;
  item.addEventListener('click', () => {
    stopServerRefresh();
    serverRefreshTimer = setInterval(loadServerInfo, 5000);
  });
});

document.querySelectorAll('.nav-item').forEach(item => {
  const page = item.getAttribute('data-page');
  if (page && page !== 'server') {
    item.addEventListener('click', stopServerRefresh);
  }
});

function openChangePasswordModal(userId, username) {
  document.getElementById('change-password-user-id').value = userId;
  document.getElementById('change-password-input').value = '';
  document.getElementById('change-password-error').style.display = 'none';
  openModal('change-password-modal');
}

async function submitChangePassword() {
  const userId = document.getElementById('change-password-user-id').value;
  const newPassword = document.getElementById('change-password-input').value;
  const errorEl = document.getElementById('change-password-error');

  if (!newPassword) {
    errorEl.textContent = 'Please enter a password';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const res = await api('/api/change-user-password/', {
      method: 'POST',
      body: JSON.stringify({
        user_id: parseInt(userId),
        new_password: newPassword
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      showToast('Password changed successfully', 'success');
      closeModal('change-password-modal');
    } else {
      errorEl.textContent = data.error || 'Failed to change password';
      errorEl.style.display = 'block';
    }
  } catch (e) {
    errorEl.textContent = 'An error occurred';
    errorEl.style.display = 'block';
  }
}

async function toggleUserActive(userId, currentStatus, username) {
  const action = currentStatus ? 'disable' : 'enable';
  const confirmMsg = `Are you sure you want to ${action} user "${username}"?`;

  openConfirm(
    `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
    confirmMsg,
    async () => {
      try {
        const res = await api('/api/toggle-user-active/', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            is_active: !currentStatus
          })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          showToast(`User ${action}d successfully`, 'success');
          loadUsers();
        } else {
          showToast(data.error || `Failed to ${action} user`, 'error');
        }
      } catch (e) {
        showToast(`Error ${action}ing user`, 'error');
      }
    }
  );
}

function searchUsers() {
  const query = document.getElementById('user-search-input').value.toLowerCase();
  
  filteredUsers = allUsers.filter(u => {
    const profile = u.userprofile || {};
    const matchQuery = !query || 
                       (u.username || '').toLowerCase().includes(query) || 
                       (profile.full_name || '').toLowerCase().includes(query);
    return matchQuery;
  });
  
  currentUsersPage = 1;
  renderUsersWithPagination();
}

function renderUsersWithPagination() {
  const totalUsers = filteredUsers.length;
  const totalPages = Math.ceil(totalUsers / usersPerPage);
  const startIndex = (currentUsersPage - 1) * usersPerPage;
  const endIndex = Math.min(startIndex + usersPerPage, totalUsers);
  const usersToShow = filteredUsers.slice(startIndex, endIndex);

  renderUsers(usersToShow);

  if (totalUsers > 10) {
    document.getElementById('users-pagination-container').style.display = 'block';
    document.getElementById('users-pagination-info').textContent = 
      `Showing ${startIndex + 1}-${endIndex} of ${totalUsers} users`;
    renderUsersPaginationButtons(totalPages);
  } else {
    document.getElementById('users-pagination-container').style.display = 'none';
  }
}

function renderUsersPaginationButtons(totalPages) {
  const container = document.getElementById('users-pagination-buttons');
  let html = '';

  html += `<button class="pagination-btn" onclick="goToUsersPage(${currentUsersPage - 1})" ${currentUsersPage === 1 ? 'disabled' : ''}>‹</button>`;

  const maxButtons = 7;
  let startPage = Math.max(1, currentUsersPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToUsersPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === currentUsersPage ? 'active' : ''}" onclick="goToUsersPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
    html += `<button class="pagination-btn" onclick="goToUsersPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" onclick="goToUsersPage(${currentUsersPage + 1})" ${currentUsersPage === totalPages ? 'disabled' : ''}>›</button>`;

  container.innerHTML = html;
}

function goToUsersPage(page) {
  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
  if (page < 1 || page > totalPages) return;
  currentUsersPage = page;
  renderUsersWithPagination();
}

function changeUsersPerPage() {
  usersPerPage = parseInt(document.getElementById('users-items-per-page').value);
  currentUsersPage = 1;
  renderUsersWithPagination();
}

let mgmtReportsData = [];
let mgmtCurrentPage = 1;
let mgmtPerPage = 25;

async function initMgmtReports() {
  await Promise.all([loadMgmtCentres(), loadMgmtDoctors()]);
}

async function loadMgmtCentres() {
  try {
    const res = await api('/api/centers/');
    if (!res.ok) return;
    const centers = await res.json();
    const sel = document.getElementById('mgmt-centre-filter');
    sel.innerHTML = '<option value="">All Institutes</option>';
    centers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.institute_name || '';
      opt.textContent = c.institute_name || 'Unnamed';
      sel.appendChild(opt);
    });
  } catch (e) {}
}

async function loadMgmtDoctors() {
  try {
    const res = await api('/api/doctors/');
    if (!res.ok) return;
    const data = await res.json();
    const doctors = data.doctors || data;
    const sel = document.getElementById('mgmt-doctor-filter');
    sel.innerHTML = '<option value="">All</option>';
    doctors.forEach(d => {
      const name = d.name || d.full_name || d.username || d;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  } catch (e) {}
}

async function searchMgmtReports() {
  const params = buildMgmtParams();
  const tbody = document.getElementById('mgmt-reports-table-body');
  tbody.innerHTML = '<tr><td colspan="12" class="loading">Loading...</td></tr>';
  document.getElementById('mgmt-pagination-container').style.display = 'none';

  try {
    const doctor = document.getElementById('mgmt-doctor-filter').value;
    const reportStart = document.getElementById('mgmt-report-start').value;
    const reportEnd = document.getElementById('mgmt-report-end').value;
    const serverStart = document.getElementById('mgmt-server-start').value;
    const serverEnd = document.getElementById('mgmt-server-end').value;

    const qs = new URLSearchParams({ page: '1', page_size: '2000', ...params }).toString();
    const res = await api(`/api/dicom-list/?${qs}`);
    if (!res.ok) { showToast('Failed to load records', 'error'); return; }
    const data = await res.json();
    const allResults = data.results || [];

    mgmtReportsData = allResults.filter(r => {
      if (doctor && (r.reported_by || '').trim() !== doctor.trim()) return false;

      if (reportStart || reportEnd) {
        const reportedStatuses = ['Reported', 'Reviewed', 'Draft'];
        if (!reportedStatuses.includes(r.status)) return false;
        const rdt = r.updated_at ? new Date(r.updated_at) : null;
        if (!rdt) return false;
        if (reportStart && rdt < new Date(reportStart)) return false;
        if (reportEnd && rdt > new Date(reportEnd + 'T23:59:59')) return false;
      }

      if (serverStart || serverEnd) {
        const sdt = r.created_at ? new Date(r.created_at) : null;
        if (serverStart && (!sdt || sdt < new Date(serverStart))) return false;
        if (serverEnd && (!sdt || sdt > new Date(serverEnd + 'T23:59:59'))) return false;
      }

      return true;
    });

    mgmtCurrentPage = 1;
    renderMgmtReports();
  } catch (e) {
    console.error('Error fetching management records:', e);
    showToast('Error fetching records', 'error');
  }
}

function buildMgmtParams() {
  const p = {};
  const scanStart = document.getElementById('mgmt-scan-start').value;
  const scanEnd = document.getElementById('mgmt-scan-end').value;
  const centre = document.getElementById('mgmt-centre-filter').value;
  const status = document.getElementById('mgmt-status-filter').value;
  const modality = document.getElementById('mgmt-modality-filter').value;

  if (scanStart) p.date_from = scanStart.replace(/-/g, '');
  if (scanEnd) p.date_to = scanEnd.replace(/-/g, '');
  if (centre) p.institute_name = centre;
  if (status) p.status = status;
  if (modality) p.modality__in = modality;
  return p;
}




function formatMgmtDateTime(dateStr, timeStr) {
  if (!dateStr) return '';
  try {
    const d = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    if (!timeStr) return d;
    const t = timeStr.replace(/(\d{2})(\d{2})(\d{2}).*/, '$1:$2:$3');
    return `${d}/${t}`;
  } catch (e) { return dateStr; }
}

function formatCreatedAt(str) {
  if (!str) return '';
  try {
    const d = new Date(str);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (e) { return str; }
}

function calcTransmissionTime(scanDate, scanTime, createdAt) {
  if (!scanDate || !createdAt) return '';
  try {
    const scanStr = `${scanDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}T${(scanTime || '000000').replace(/(\d{2})(\d{2})(\d{2}).*/, '$1:$2:$3')}`;
    const scan = new Date(scanStr);
    const recv = new Date(createdAt);
    const diff = Math.abs(recv - scan);
    const hrs = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  } catch (e) { return ''; }
}

function getStatusLabel(status) {
  const validStatuses = ['Reported', 'Reviewed', 'Draft', 'Unreported', 'Not Assigned'];
  return validStatuses.includes(status) ? status : '';
}

function renderMgmtReports() {
  const tbody = document.getElementById('mgmt-reports-table-body');

  if (!mgmtReportsData.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text3);">No records found.</td></tr>';
    document.getElementById('mgmt-pagination-container').style.display = 'none';
    return;
  }

  const total = mgmtReportsData.length;
  const totalPages = Math.ceil(total / mgmtPerPage);
  const start = (mgmtCurrentPage - 1) * mgmtPerPage;
  const end = Math.min(start + mgmtPerPage, total);
  const slice = mgmtReportsData.slice(start, end);

  tbody.innerHTML = slice.map((r, i) => {
    const sno = start + i + 1;
    const radiologist = r.reported_by || '';
    const centre = r.institute_name || r.center_name || '';
    const scanDt = formatMgmtDateTime(r.study_date, r.study_time);
    const serverDt = formatCreatedAt(r.created_at);
    const reportDt = r.updated_at ? formatCreatedAt(r.updated_at) : '';
    const transmission = calcTransmissionTime(r.study_date, r.study_time, r.created_at);
    const statusLabel = getStatusLabel(r.status);
    return `<tr>
      <td style="text-align:center;">${sno}</td>
      <td>${radiologist}</td>
      <td>${centre}</td>
      <td>${r.patient_name || ''}</td>
      <td>${r.patient_id || ''}</td>
      <td>${r.study_description || r.series_description || ''}</td>
      <td>${r.modality || ''}</td>
      <td style="white-space:nowrap;">${scanDt}</td>
      <td style="white-space:nowrap;">${serverDt}</td>
      <td>${statusLabel}</td>
      <td style="white-space:nowrap;">${reportDt}</td>
      <td style="white-space:nowrap;">${transmission}</td>
    </tr>`;
  }).join('');

  if (total > 10) {
    document.getElementById('mgmt-pagination-container').style.display = 'block';
    document.getElementById('mgmt-pagination-info').textContent = `Showing ${start + 1}-${end} of ${total} records`;
    renderMgmtPaginationButtons(totalPages);
  } else {
    document.getElementById('mgmt-pagination-container').style.display = 'none';
  }
}

function renderMgmtPaginationButtons(totalPages) {
  const container = document.getElementById('mgmt-pagination-buttons');
  let html = '';

  html += `<button class="pagination-btn" onclick="goToMgmtPage(${mgmtCurrentPage - 1})" ${mgmtCurrentPage === 1 ? 'disabled' : ''}>‹</button>`;

  const maxButtons = 7;
  let startPage = Math.max(1, mgmtCurrentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="goToMgmtPage(1)">1</button>`;
    if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="pagination-btn ${i === mgmtCurrentPage ? 'active' : ''}" onclick="goToMgmtPage(${i})">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">...</span>`;
    html += `<button class="pagination-btn" onclick="goToMgmtPage(${totalPages})">${totalPages}</button>`;
  }

  html += `<button class="pagination-btn" onclick="goToMgmtPage(${mgmtCurrentPage + 1})" ${mgmtCurrentPage === totalPages ? 'disabled' : ''}>›</button>`;

  container.innerHTML = html;
}

function goToMgmtPage(page) {
  const totalPages = Math.ceil(mgmtReportsData.length / mgmtPerPage);
  if (page < 1 || page > totalPages) return;
  mgmtCurrentPage = page;
  renderMgmtReports();
}

function changeMgmtPerPage() {
  mgmtPerPage = parseInt(document.getElementById('mgmt-items-per-page').value);
  mgmtCurrentPage = 1;
  renderMgmtReports();
}

function printMgmtReportHTML() {
  if (!mgmtReportsData.length) { showToast('No data to print', 'error'); return; }
  const rows = mgmtReportsData.map((r, i) => {
    const sno = i + 1;
    const scanDt = formatMgmtDateTime(r.study_date, r.study_time);
    const serverDt = formatCreatedAt(r.created_at);
    const reportDt = r.updated_at ? formatCreatedAt(r.updated_at) : '';
    const transmission = calcTransmissionTime(r.study_date, r.study_time, r.created_at);
    const statusLabel = getStatusLabel(r.status);
    const centre = r.institute_name || r.center_name || '';
    return `<tr>
      <td>${sno}</td><td>${r.reported_by||''}</td><td>${centre}</td>
      <td>${r.patient_name||''}</td><td>${r.patient_id||''}</td>
      <td>${r.study_description||r.series_description||''}</td>
      <td>${r.modality||''}</td><td>${scanDt}</td><td>${serverDt}</td>
      <td>${statusLabel}</td><td>${reportDt}</td><td>${transmission}</td>
    </tr>`;
  }).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Management Report</title>
  <style>body{font-family:Arial,sans-serif;font-size:11px;padding:20px;}
  h2{margin-bottom:12px;font-size:14px;}
  table{border-collapse:collapse;width:100%;}
  th{background:#2c3e6b;color:#fff;padding:7px 8px;text-align:left;font-size:11px;white-space:nowrap;}
  td{padding:6px 8px;border-bottom:1px solid #ddd;white-space:nowrap;}
  tr:nth-child(even){background:#f5f7fb;}
  @media print{button{display:none;}}
  </style></head><body>
  <h2>Management Report &mdash; Total Records: ${mgmtReportsData.length}</h2>
  <table><thead><tr>
    <th>S.No.</th><th>Radiologist</th><th>Reporting Center</th><th>Patient Name</th>
    <th>Patient ID</th><th>Body Part</th><th>Modality</th><th>Scan Date/Time</th>
    <th>Server Receive Date/Time</th><th>Report Status</th><th>Report Date/Time</th><th>Transmission Time</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <br/><button onclick="window.print()">Print</button>
  </body></html>`);
  win.document.close();
}

function exportMgmtReportExcel() {
  if (!mgmtReportsData.length) { showToast('No data to export', 'error'); return; }
  const headers = ['S.No.','Radiologist','Reporting Center','Patient Name','Patient ID','Body Part','Modality','Scan Date/Time','Server Receive Date/Time','Report Status','Report Date/Time','Transmission Time'];
  const rows = mgmtReportsData.map((r, i) => {
    const centre = r.institute_name || r.center_name || '';
    return [
      i+1, r.reported_by||'', centre, r.patient_name||'', r.patient_id||'',
      r.study_description||r.series_description||'', r.modality||'',
      formatMgmtDateTime(r.study_date, r.study_time),
      formatCreatedAt(r.created_at), getStatusLabel(r.status),
      r.updated_at ? formatCreatedAt(r.updated_at) : '',
      calcTransmissionTime(r.study_date, r.study_time, r.created_at)
    ];
  });
  let csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `management_report_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function openBillingInvoice() {
  showToast('Billing Invoice feature coming soon', 'info');
}
