const baseUrl = window.location.origin;
let allPatients = [];
let filteredPatients = []; 
let token = sessionStorage.getItem('token') || localStorage.getItem('token');
let currentPage = parseInt(sessionStorage.getItem('doctorCurrentPage')) || 1;
let itemsPerPage = 10;
let totalPages = 1;
let totalCount = 0;
let loggedInDoctorName = '';
let autoRefreshInterval = null;
const AUTO_REFRESH_MS = 10000;
const FOCUS_REFRESH_GAP_MS = 3000;
let fetchSeq = 0;
let inFlight = 0;
let lastFetchAt = 0;
let appliedFilters = null;
let pendingCenterValue = '';
let centersLoaded = false;
let centersValidated = false;
const centerCatalog = new Map();
let userPermissions = {
  can_assign_doctors: false,
  can_write_reports: false,
  can_manage_templates: false
};

function showNoReportsMessage(text) {
  let el = document.getElementById('no-reports-msg');
  const patientList = document.getElementById('patient-list');
  if (!patientList) return;
  if (!el) {
    el = document.createElement('div');
    el.id = 'no-reports-msg';
    el.style.padding = '18px';
    el.style.margin = '8px 12px';
    el.style.borderRadius = '6px';
    el.style.background = '#fff8c6';
    el.style.color = '#333';
    el.style.fontSize = '16px';
    el.style.textAlign = 'center';
    el.style.border = '1px solid #f0e68c';
    patientList.parentNode.insertBefore(el, patientList);
  }
  el.textContent = text;
  el.style.display = 'block';
}

function hideNoReportsMessage() {
  const el = document.getElementById('no-reports-msg');
  if (el) el.style.display = 'none';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attrJs(value) {
  return escapeHtml(String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

function calcAge(birthDate) {
  if (!birthDate) return 0;
  const m = String(birthDate).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return 0;
  const today = new Date();
  let age = today.getFullYear() - parseInt(m[1], 10);
  const month = today.getMonth() + 1 - parseInt(m[2], 10);
  if (month < 0 || (month === 0 && today.getDate() < parseInt(m[3], 10))) age--;
  return Math.max(0, age);
}

async function loadDoctorSession() {
  if (!token) {
    window.location.href = 'login.html';
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/api/current-user/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      window.location.href = 'login.html';
      return null;
    }

    const data = await response.json();

    if (!data.success) {
      return null;
    }

    if (data.role !== 'Doctor') {
      if (data.role === 'SubAdmin') {
        window.location.href = 'index.html';
      } else if (data.role === 'Center') {
        window.location.href = 'institute.html';
      } else {
        window.location.href = 'login.html';
      }
      return null;
    }

    if (data.permissions) {
      userPermissions = data.permissions;
    }

    return data;
  } catch (error) {
    console.error('Error checking doctor access:', error);
    window.location.href = 'login.html';
    return null;
  }
}


function updateUIBasedOnPermissions() {
  const assignPanel = document.getElementById('assign-panel');
  if (assignPanel) {
    if (userPermissions.can_assign_doctors) {
      assignPanel.style.display = 'block';
      loadDoctors();
    } else {
      assignPanel.style.display = 'none';
    }
  }
}


async function assignSelectedStudies() {
  const selectedCheckboxes = document.querySelectorAll('.row-checkbox:checked');
  const assignSelect = document.getElementById('assign-doctors');
  
  if (selectedCheckboxes.length === 0) {
    alert('Please select at least one study to assign');
    return;
  }
  
  if (!assignSelect || assignSelect.selectedOptions.length === 0) {
    alert('Please select at least one doctor to assign');
    return;
  }
  
  const imageIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.dataset.patientPk));
  const selectedOptions = Array.from(assignSelect.selectedOptions);
  const doctorNames = [];
  const groupsFromDB = await getGroupsFromDB();
  selectedOptions.forEach(option => {
    if (option.value.startsWith('__group__')) {
      const groupId = option.value.replace('__group__', '');
      const group = groupsFromDB.find(g => g.id === groupId);
      if (group) {
        if (!doctorNames.includes(group.name)) doctorNames.push(group.name);
        (group.members || []).forEach(m => { if (!doctorNames.includes(m)) doctorNames.push(m); });
      }
    } else {
      if (!doctorNames.includes(option.value)) doctorNames.push(option.value);
    }
  });
  
  try {
    const response = await fetch(`${baseUrl}/api/dicom-images/assign_doctors/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_ids: imageIds,
        doctor_names: doctorNames
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      alert(`Successfully assigned doctors to ${result.updated_images} studies`);
      
      selectedCheckboxes.forEach(cb => cb.checked = false);
      const selectAll = document.getElementById('select-all');
      if (selectAll) selectAll.checked = false;
      assignSelect.selectedIndex = -1;
      
      await fetchAssignedStudies(loggedInDoctorName, currentPage, true);
    } else {
      alert(result.error || 'Assignment failed');
    }
    
  } catch (error) {
    console.error('Error assigning doctors:', error);
    alert('Error assigning doctors: ' + error.message);
  }
}

async function loadDoctors() {
  try {
    const response = await fetch(`${baseUrl}/api/doctors/`, {
      headers: { 
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch doctors');
    }
    
    const data = await response.json();
    
    if (data.success && data.doctors) {
      const assignSelect = document.getElementById('assign-doctors');
      if (assignSelect) {
        assignSelect.innerHTML = '';

        data.doctors.forEach(doctor => {
          const option = document.createElement('option');
          option.value = doctor.name;
          option.textContent = `${doctor.name} ${doctor.designation ? '(' + doctor.designation + ')' : ''}`;
          assignSelect.appendChild(option);
        });

        const groups = await getGroupsFromDB();
        groups.forEach(group => {
          const option = document.createElement('option');
          option.value = '__group__' + group.id;
          option.textContent = group.name;
          option.dataset.groupMembers = JSON.stringify(group.members || []);
          assignSelect.appendChild(option);
        });
      }
    }
  } catch (err) {
    console.error('Error loading doctors:', err);
  }
}

let cachedGroupsDoctor = null;

async function getGroupsFromDB() {
  try {
    const res = await fetch(`${baseUrl}/api/doctor-groups/`, {
      headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return [];
    const groups = await res.json();
    cachedGroupsDoctor = groups.filter(g => g.enabled !== false);
    return cachedGroupsDoctor;
  } catch {
    return [];
  }
}

const WAIT_GIF_WINDOW_MS = 25000;
let serverClockOffset = 0;
let receivingStudies = new Set();

function syncServerClock(res) {
  const header = res && res.headers ? res.headers.get('Date') : null;
  const serverNow = header ? new Date(header).getTime() : NaN;
  if (!isNaN(serverNow)) serverClockOffset = serverNow - Date.now();
}

function detectReceivingStudies(rows) {
  const latest = {};
  rows.forEach(r => {
    const uid = r.studyUID;
    const t = new Date(r.createdAt).getTime();
    if (!uid || isNaN(t)) return;
    if (!latest[uid] || t > latest[uid]) latest[uid] = t;
  });
  const serverNow = Date.now() + serverClockOffset;
  receivingStudies = new Set(Object.keys(latest).filter(uid => serverNow - latest[uid] < WAIT_GIF_WINDOW_MS));
}

function waitGifHtml(studyUID) {
  if (!receivingStudies.has(studyUID)) return '';
  return `<img class="study-wait-gif" src="images/wait_hover.gif" alt="" title="Receiving new study..." width="17" height="19" style="margin-left:4px;vertical-align:middle;">`;
}

function collectFilters() {
  const val = id => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  return {
    name: val('patient-name').trim(),
    id: val('patient-id').trim(),
    status: val('status') || 'All',
    center: val('center') || 'ALL',
    emergency: !!(document.getElementById('emergency') && document.getElementById('emergency').checked),
    start: val('scan-start-date'),
    end: val('scan-end-date'),
    modalities: Array.from(document.querySelectorAll('.modality-checkbox:checked')).map(cb => cb.value)
  };
}

function persistFilters(f) {
  sessionStorage.setItem('doctorStatusFilter', f.status);
  sessionStorage.setItem('doctorNameFilter', f.name);
  sessionStorage.setItem('doctorIdFilter', f.id);
  sessionStorage.setItem('doctorStartDate', f.start);
  sessionStorage.setItem('doctorEndDate', f.end);
  sessionStorage.setItem('doctorCenterFilter', f.center);
  sessionStorage.setItem('doctorEmergency', f.emergency ? 'true' : 'false');
  sessionStorage.setItem('doctorModalities', JSON.stringify(f.modalities));
}

function restoreFilters() {
  const set = (id, key) => {
    const el = document.getElementById(id);
    const saved = sessionStorage.getItem(key);
    if (el && saved !== null) el.value = saved;
  };
  set('status', 'doctorStatusFilter');
  set('patient-name', 'doctorNameFilter');
  set('patient-id', 'doctorIdFilter');
  set('scan-start-date', 'doctorStartDate');
  set('scan-end-date', 'doctorEndDate');
  const emergency = document.getElementById('emergency');
  if (emergency) emergency.checked = sessionStorage.getItem('doctorEmergency') === 'true';
  try {
    const mods = JSON.parse(sessionStorage.getItem('doctorModalities') || 'null');
    if (Array.isArray(mods)) {
      document.querySelectorAll('.modality-checkbox').forEach(cb => {
        cb.checked = mods.includes(cb.value);
      });
      syncModalityAll();
    }
  } catch (e) {}
  pendingCenterValue = sessionStorage.getItem('doctorCenterFilter') || '';
}

function syncModalityAll() {
  const all = document.getElementById('modality-all');
  if (!all) return;
  const boxes = Array.from(document.querySelectorAll('.modality-checkbox'));
  all.checked = boxes.length > 0 && boxes.every(cb => cb.checked);
}

function buildStudiesQuery(doctorName, page, withCenters) {
  const f = appliedFilters || collectFilters();
  const params = new URLSearchParams();
  params.set('doctor_name', doctorName);
  params.set('page', String(page));
  params.set('page_size', String(itemsPerPage));
  if (f.name) params.set('patient_name', f.name);
  if (f.id) params.set('patient_id', f.id);
  if (f.status && f.status !== 'All') params.set('status', f.status);
  if (f.center && f.center !== 'ALL') params.set('center_name', f.center);
  if (f.emergency) params.set('emergency', 'true');
  const totalModalities = document.querySelectorAll('.modality-checkbox').length;
  if (f.modalities.length && f.modalities.length < totalModalities) {
    params.set('modality', f.modalities.join(','));
  }
  if (f.start) params.set('start_date', f.start);
  if (f.end) params.set('end_date', f.end);
  if (withCenters) params.set('centers', '1');
  return params.toString();
}

function mapStudyRow(dicom) {
  let age = typeof dicom.age === 'number' ? dicom.age : calcAge(dicom.patient_birth_date);

  let scanDateTime = '';
  try {
    if (dicom.study_date && dicom.study_time) {
      const year = String(dicom.study_date).substring(0, 4);
      const month = String(dicom.study_date).substring(4, 6);
      const day = String(dicom.study_date).substring(6, 8);
      const timeString = String(dicom.study_time);
      const hours = timeString.substring(0, 2);
      const minutes = timeString.substring(2, 4);
      const seconds = timeString.length >= 6 ? timeString.substring(4, 6) : '00';
      scanDateTime = `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
    } else if (dicom.study_date) {
      const year = String(dicom.study_date).substring(0, 4);
      const month = String(dicom.study_date).substring(4, 6);
      const day = String(dicom.study_date).substring(6, 8);
      scanDateTime = `${day}-${month}-${year}`;
    } else {
      scanDateTime = 'Date not available';
    }
  } catch (error) {
    scanDateTime = dicom.study_date || 'Date not available';
  }

  const reportFile = dicom.report_file;
  const reportUrl = reportFile ? (reportFile.startsWith('http') ? reportFile : `${baseUrl}/media/${reportFile}`) : null;
  const displayInstitute = dicom.institute_name || dicom.center_name || 'Unknown';

  let assignedDoctorsArray = [];
  if (dicom.assigned_doctors) {
    if (typeof dicom.assigned_doctors === 'string') {
      assignedDoctorsArray = dicom.assigned_doctors.split(',').map(d => d.trim()).filter(d => d);
    } else if (Array.isArray(dicom.assigned_doctors)) {
      assignedDoctorsArray = dicom.assigned_doctors;
    }
  } else if (dicom.assigned_doctors_list && Array.isArray(dicom.assigned_doctors_list)) {
    assignedDoctorsArray = dicom.assigned_doctors_list;
  }

  return {
    id: dicom.id,
    dbId: dicom.id,
    name: dicom.patient_name || 'Unknown',
    patient_id: dicom.patient_id || '',
    age: age,
    sex: dicom.patient_sex || '',
    body_part: dicom.study_description || dicom.series_description || '',
    modality: dicom.modality || '',
    center: dicom.center_name || 'Default',
    institute_name: displayInstitute,
    scan_datetime: scanDateTime,
    receive_datetime: formatReceiveDateTime(dicom.received_at || dicom.created_at) || scanDateTime,
    status: dicom.status || 'Unreported',
    locked: dicom.is_emergency || false,
    dicom_file_path: dicom.file_path,
    reported_by: dicom.reported_by || '',
    studyUID: dicom.study_instance_uid || dicom.study_uid || dicom.StudyInstanceUID || '',
    report_file: reportFile,
    report_url: reportUrl,
    images: dicom.images || dicom.image_urls || [],
    thumbnailUrl: dicom.thumbnail_url || '',
    assignedDoctors: assignedDoctorsArray,
    assigned_doctors: dicom.assigned_doctors || '',
    group: assignedDoctorsArray.join(', '),
    referring_physician: dicom.referring_physician || '',
    patient_history: dicom.patient_history || '',
    referral_file: dicom.referral_file || '',
    createdAt: dicom.created_at || '',
    uploads: [{
      id: dicom.id,
      status: dicom.status || 'Unreported',
      dicom_file: dicom.file_path ? `${baseUrl}/media/${dicom.file_path}` : null,
      report_pdf: reportUrl
    }]
  };
}

function updateEmptyMessage() {
  const status = appliedFilters ? appliedFilters.status : 'All';
  if (totalCount === 0 && status === 'Unreported') {
    showNoReportsMessage('No more unreported studies for today.');
  } else {
    hideNoReportsMessage();
  }
}

async function fetchAssignedStudies(doctorName, page = currentPage, maintainPage = true, silent = false) {
  if (!doctorName) return;
  const seq = ++fetchSeq;
  const withCenters = !centersLoaded;
  if (!silent) window.QueryBar?.start();
  inFlight++;
  try {
    const res = await fetch(`${baseUrl}/api/dicom-images/by_doctor/?${buildStudiesQuery(doctorName, page, withCenters)}`, {
      headers: { 'Authorization': `Token ${token}` }
    });

    if (seq !== fetchSeq) return;

    if (res.status === 401) {
      stopAutoRefresh();
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      window.location.href = 'login.html';
      return;
    }

    if (!res.ok) throw new Error('Failed to fetch assigned studies');

    syncServerClock(res);
    const responseData = await res.json();

    if (seq !== fetchSeq) return;
    if (!responseData.success) throw new Error(responseData.error || 'Failed to fetch assigned studies');

    totalCount = responseData.count || 0;
    totalPages = responseData.total_pages || (totalCount ? Math.ceil(totalCount / itemsPerPage) : 1);

    if (totalCount > 0 && page > totalPages) {
      currentPage = totalPages;
      sessionStorage.setItem('doctorCurrentPage', currentPage);
      inFlight--;
      try {
        await fetchAssignedStudies(doctorName, totalPages, true, silent);
      } finally {
        inFlight++;
      }
      return;
    }

    currentPage = totalCount === 0 ? 1 : Math.max(1, page);
    sessionStorage.setItem('doctorCurrentPage', currentPage);
    lastFetchAt = Date.now();

    const rows = [];
    const seen = new Set();
    (responseData.images || []).forEach(dicom => {
      if (seen.has(dicom.id)) return;
      seen.add(dicom.id);
      rows.push(mapStudyRow(dicom));
    });

    allPatients = rows;
    filteredPatients = rows;

    detectReceivingStudies(rows);
    loadPatients(rows);
    createPaginationControls();
    updateEmptyMessage();

    if (Array.isArray(responseData.centers)) {
      centersLoaded = true;
      responseData.centers.forEach(c => registerCenter(c.institute_name, c.center_name));
    }
    rows.forEach(r => registerCenter(r.institute_name, r.center));
    populateCenterDropdown();

    if (!centersValidated && centersLoaded) {
      centersValidated = true;
      const select = document.getElementById('center');
      if (select && appliedFilters && select.value !== appliedFilters.center) {
        appliedFilters.center = select.value;
        sessionStorage.setItem('doctorCenterFilter', select.value);
        currentPage = 1;
        sessionStorage.setItem('doctorCurrentPage', currentPage);
        inFlight--;
        try {
          await fetchAssignedStudies(doctorName, 1, true, silent);
        } finally {
          inFlight++;
        }
      }
    }
  } catch (err) {
    console.error('Error fetching assigned studies:', err);
    if (!silent && seq === fetchSeq) {
      alert('Error fetching assigned studies: ' + err.message);
    }
  } finally {
    inFlight--;
    if (!silent) window.QueryBar?.end();
  }
}

function registerCenter(institute, center) {
  if (!institute) return;
  if (!centerCatalog.has(institute)) centerCatalog.set(institute, new Set());
  if (center) centerCatalog.get(institute).add(center);
}

function populateCenterDropdown() {
  const centerSelect = document.getElementById('center');
  if (!centerSelect) return;

  const wanted = [['ALL', 'All Centers']];
  Array.from(centerCatalog.keys()).sort().forEach(institute => {
    const first = Array.from(centerCatalog.get(institute))[0];
    if (first) wanted.push([first, institute]);
  });

  const allOption = centerSelect.querySelector('option[value="ALL"]');
  if (allOption) wanted[0][1] = allOption.textContent;

  const current = Array.from(centerSelect.options).map(o => [o.value, o.textContent]);
  const unchanged = current.length === wanted.length &&
    current.every((o, i) => o[0] === wanted[i][0] && o[1] === wanted[i][1]);
  if (unchanged) return;

  const currentValue = pendingCenterValue || centerSelect.value;
  centerSelect.innerHTML = '';

  wanted.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    centerSelect.appendChild(option);
  });

  if (currentValue && wanted.some(o => o[0] === currentValue)) {
    centerSelect.value = currentValue;
    pendingCenterValue = '';
  } else if (centersLoaded) {
    centerSelect.value = 'ALL';
    pendingCenterValue = '';
  } else {
    centerSelect.value = 'ALL';
  }
}

document.getElementById('modality-all')?.addEventListener('change', (event) => {
  const isChecked = event.target.checked;
  document.querySelectorAll('.modality-checkbox').forEach(checkbox => {
    checkbox.checked = isChecked;
  });
});

document.querySelectorAll('.modality-checkbox').forEach(checkbox => {
  checkbox.addEventListener('change', syncModalityAll);
});

['patient-name', 'patient-id'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchPatients();
      }
    });
  }
});

function isSearchPanelEmpty(f) {
  const totalModalities = document.querySelectorAll('.modality-checkbox').length;
  return !f.name && !f.id && f.status === 'All' && f.center === 'ALL' && !f.emergency &&
    !f.start && !f.end && f.modalities.length === totalModalities;
}

function clearSavedFilters() {
  ['doctorStatusFilter', 'doctorNameFilter', 'doctorIdFilter', 'doctorStartDate',
   'doctorEndDate', 'doctorCenterFilter', 'doctorEmergency', 'doctorModalities']
    .forEach(key => sessionStorage.removeItem(key));
}

function resetPanelInputs() {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  setValue('patient-name', '');
  setValue('patient-id', '');
  setValue('status', 'All');
  setValue('center', 'ALL');
  setValue('scan-start-date', '');
  setValue('scan-end-date', '');
  const emergency = document.getElementById('emergency');
  if (emergency) emergency.checked = false;
  document.querySelectorAll('.modality-checkbox').forEach(cb => { cb.checked = true; });
  syncModalityAll();
}

function reloadKeepingPage() {
  clearSavedFilters();
  sessionStorage.setItem('doctorCurrentPage', currentPage);
  resetPanelInputs();
  window.location.reload();
}

async function searchPatients() {
  const filters = collectFilters();

  if (isSearchPanelEmpty(filters)) {
    reloadKeepingPage();
    return;
  }

  if (filters.start && filters.end && filters.start > filters.end) {
    alert('Start date cannot be after end date');
    return;
  }

  appliedFilters = filters;
  persistFilters(filters);

  currentPage = 1;
  sessionStorage.setItem('doctorCurrentPage', currentPage);

  await fetchAssignedStudies(loggedInDoctorName, currentPage, true);
}

function refreshStudies() {
  reloadKeepingPage();
}

function generateImageThumbnails(study) {
  if (!study.images || !Array.isArray(study.images) || study.images.length === 0) {
    if (study.thumbnailUrl) {
      return `<img src="${study.thumbnailUrl}" alt="Preview" class="study-table-img" onerror="this.style.display='none'" />`;
    }
    return '<span style="color:#999; font-size:12px;">No img</span>';
  }
  
  const thumbnailsHtml = study.images.slice(0, 3).map((img, imgIndex) => {
    const imgUrl = typeof img === 'string' ? img : (img.thumbnail_url || img.url || '#');
    return `<img src="${imgUrl}" alt="Preview ${imgIndex + 1}" class="study-table-img" onerror="this.style.display='none'" />`;
  }).join('');
  
  const moreCount = study.images.length > 3 ? 
    `<span style="color:#666; font-size:11px;">+${study.images.length - 3} more</span>` : '';
  
  return `<div class="img-thumbnails">${thumbnailsHtml}${moreCount}</div>`;
}

function generateDoctorsList(study, canRemove = false) {
  const assignedDoctorsArray = study.assignedDoctors || [];
  const assignedDoctorsString = study.group || study.assigned_doctors || '';

  let doctorsList = [];

  if (assignedDoctorsArray.length > 0) {
    doctorsList = assignedDoctorsArray;
  } else if (assignedDoctorsString) {
    doctorsList = assignedDoctorsString.split(',').map(d => d.trim()).filter(d => d);
  }

  if (doctorsList.length === 0) {
    return '—';
  }

  const knownGroups = cachedGroupsDoctor || [];
  const groupNames = knownGroups.map(g => g.name);
  const groupMatches = knownGroups.filter(g => doctorsList.includes(g.name));

  if (groupMatches.length > 0) {
    const membersCoveredByGroups = new Set();
    groupMatches.forEach(g => (g.members || []).forEach(m => membersCoveredByGroups.add(m)));

    const parts = [];
    groupMatches.forEach(g => {
      if (canRemove) {
        parts.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0;padding:3px 5px;background:#e8d5f5;border-radius:3px;">
          <span style="font-weight:600;color:#6a0dad;">👥 ${escapeHtml(g.name)}</span>
          <button onclick="removeSingleDoctor(${study.id}, '${attrJs(g.name)}')" style="background:#ff4444;color:white;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:12px;margin-left:5px;">×</button>
        </div>`);
      } else {
        parts.push(`<div style="margin:3px 0;padding:3px 5px;background:#e8d5f5;border-radius:3px;">
          <span style="font-weight:600;color:#6a0dad;">👥 ${escapeHtml(g.name)}</span>
        </div>`);
      }
    });

    doctorsList.forEach(doctor => {
      if (!groupNames.includes(doctor) && !membersCoveredByGroups.has(doctor)) {
        if (canRemove) {
          parts.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0;padding:3px 5px;background:#f0f0f0;border-radius:3px;">
            <span>${escapeHtml(doctor)}</span>
            <button onclick="removeSingleDoctor(${study.id}, '${attrJs(doctor)}')" style="background:#ff4444;color:white;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:12px;margin-left:5px;">×</button>
          </div>`);
        } else {
          parts.push(`<div style="margin:3px 0;padding:3px 5px;background:#f0f0f0;border-radius:3px;">
            <span>${escapeHtml(doctor)}</span>
          </div>`);
        }
      }
    });
    return parts.join('');
  }

  if (canRemove) {
    return doctorsList.map(doctor => {
      return `<div style="display: flex; justify-content: space-between; align-items: center; margin: 3px 0; padding: 3px 5px; background: #f0f0f0; border-radius: 3px;">
        <span>${escapeHtml(doctor)}</span>
        <button onclick="removeSingleDoctor(${study.id}, '${attrJs(doctor)}')" style="background: #ff4444; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px; margin-left: 5px;">×</button>
      </div>`;
    }).join('');
  } else {
    return doctorsList.map(doctor => {
      return `<div style="margin: 3px 0; padding: 3px 5px; background: #f0f0f0; border-radius: 3px;">
        <span>${escapeHtml(doctor)}</span>
      </div>`;
    }).join('');
  }
}

async function removeSingleDoctor(imageId, doctorName) {
  const confirmed = confirm(`Remove ${doctorName} from this study?`);
  if (!confirmed) {
    return;
  }
  
  try {
    const response = await fetch(`${baseUrl}/api/dicom-images/remove_single_doctor/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_id: imageId,
        doctor_name: doctorName
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      await fetchAssignedStudies(loggedInDoctorName, currentPage, true);
    } else {
      throw new Error(result.error || 'Removal failed');
    }
    
  } catch (error) {
    console.error('Error removing doctor:', error);
    alert('Error removing doctor: ' + error.message);
  }
}

function loadPatients(data) {
  const patientListDiv = document.getElementById('patient-list');
  const patientTableBody = document.getElementById('patient-table-body');
  const tableHead = document.querySelector('#patient-list table thead tr');
  
  {
    if (!tableHead.querySelector('th:first-child input[type="checkbox"]')) {
      const checkboxTh = document.createElement('th');
      checkboxTh.innerHTML = '<input type="checkbox" id="select-all" />';
      tableHead.insertBefore(checkboxTh, tableHead.firstChild);
      
      const selectAll = document.getElementById('select-all');
      if (selectAll) {
        selectAll.addEventListener('change', () => {
          const checkboxes = document.querySelectorAll('.row-checkbox');
          checkboxes.forEach(cb => {
            cb.checked = selectAll.checked;
          });
        });
      }
    }
  }
  
  if (!tableHead.querySelector('th:last-child')?.textContent.includes('Assigned To')) {
    const assignedTh = document.createElement('th');
    assignedTh.textContent = 'Assigned To';
    tableHead.appendChild(assignedTh);
  }
  
  const existingRows = new Map();
  Array.from(patientTableBody.children).forEach(row => {
    if (row.dataset.rowKey) {
      existingRows.set(row.dataset.rowKey, row);
    } else if (!row.classList.contains('series-detail-row')) {
      row.remove();
    }
  });

  const orderedNodes = [];

  data.forEach((p, index) => {
    const status = p.status;
    const timestamp = new Date().getTime();
    const dicomUrl = p.uploads[0]?.dicom_file ? `${p.uploads[0].dicom_file}?t=${timestamp}` : '';
    const studyUID = p.studyUID || '';
    const hasReport = p.report_url ? true : false;
    
    const imagesThumbnails = generateImageThumbnails(p);
    const doctorsList = generateDoctorsList(p, userPermissions.can_assign_doctors);

    let rowHTML = '';
    
    rowHTML += `<td><input type="checkbox" class="row-checkbox" data-patient-pk="${p.id}" data-study-uid="${escapeHtml(studyUID)}" /></td>`;
    
    rowHTML += `
      <td>
        <button class="action-btn view-btn" data-dicom-url="${escapeHtml(dicomUrl)}" data-study-uid="${escapeHtml(studyUID)}" data-patient-id="${p.id}"><img src="images/view.png" alt="View" width="32" height="32"></button>
      </td>
      <td><button class="action-btn" title="${((p.patient_history || '').trim() !== '' || p.referral_file) ? 'History uploaded' : 'No history'}" onclick="openHistory('${attrJs(p.patient_id)}')">${historyIconHtml((p.patient_history || '').trim() !== '' || !!p.referral_file)}</button></td>
      <td>${escapeHtml(p.name)}${studyUID ? `<span class="series-toggle" title="Show series" data-study-uid="${escapeHtml(studyUID)}" data-body-part="${escapeHtml(p.body_part || '')}">+</span>` : ''}${waitGifHtml(studyUID)}</td>
      <td>${escapeHtml(p.patient_id)}</td>
      <td>${p.age}</td>
      <td>${escapeHtml(p.sex)}</td>
      <td>${escapeHtml(p.body_part)}</td>
      <td>${escapeHtml(p.modality)}</td>
      <td>${escapeHtml(p.institute_name)}</td>
      <td>${escapeHtml(p.receive_datetime || p.scan_datetime)}</td>
      <td class="refd-by-cell" data-id="${p.id}" data-value="${escapeHtml(p.referring_physician || '')}"><span class="refd-by-text" style="cursor:pointer;" onclick="startEditRefBy(this)">${p.referring_physician ? escapeHtml(p.referring_physician) : '<em style=\'color:#bbb\'>—</em>'}</span></td>
      <td>
        <select class="status-select" data-id="${p.id}" data-upload-id="${p.uploads[0]?.id || ''}" disabled style="background-color: ${status === 'Reported' ? '#d4edda' : status === 'Reviewed' ? '#fff3cd' : status === 'Draft' ? '#d1ecf1' : '#f8d7da'}; cursor: not-allowed;">
          <option value="Unreported" ${status === 'Unreported' ? 'selected' : ''}>Unreported</option>
          <option value="Draft" ${status === 'Draft' ? 'selected' : ''}>Draft</option>
          <option value="Reviewed" ${status === 'Reviewed' ? 'selected' : ''}>Reviewed</option>
          <option value="Reported" ${status === 'Reported' ? 'selected' : ''}>Reported</option>
        </select>
      </td>
      <td style="text-align:center;">${hasReport ? `<a href="#" class="preview-btn" style="color:#0000ee;text-decoration:underline;" data-report-url="${escapeHtml(p.report_url)}" data-study-uid="${escapeHtml(p.studyUID)}">View</a>` : ''}</td>
      <td>${doctorsList}</td>
    `;
    
    const key = String(p.id);
    const signature = rowHTML.replace(/\?t=\d+/g, '') + (p.locked ? '|emergency' : '');
    const previous = existingRows.get(key);

    if (previous && previous.dataset.rowSig === signature) {
      orderedNodes.push(previous);
      const detail = previous.nextElementSibling;
      if (detail && detail.classList.contains('series-detail-row')) {
        orderedNodes.push(detail);
      }
      return;
    }

    const tr = document.createElement('tr');
    if (p.locked) tr.classList.add('emergency-case');
    tr.dataset.rowKey = key;
    tr.dataset.rowSig = signature;
    tr.innerHTML = rowHTML;

    if (previous) {
      const oldBox = previous.querySelector('.row-checkbox');
      const newBox = tr.querySelector('.row-checkbox');
      if (oldBox && newBox && oldBox.checked) newBox.checked = true;
    }

    bindRowActions(tr);
    orderedNodes.push(tr);
  });

  const keepSet = new Set(orderedNodes);
  let ref = patientTableBody.firstChild;
  orderedNodes.forEach(node => {
    if (node === ref) {
      ref = ref.nextSibling;
    } else {
      patientTableBody.insertBefore(node, ref);
    }
  });
  Array.from(patientTableBody.children).forEach(row => {
    if (!keepSet.has(row)) row.remove();
  });

  if (data.length === 0) {
    patientListDiv.style.display = 'block';
    const table = patientListDiv.querySelector('table');
    if (table) table.style.display = 'table';
  } else {
    patientListDiv.style.display = 'block';
  }
}

const REPORT_BAR_CSS = "body{padding-top:56px;font-family:'Segoe UI',Arial,sans-serif;}.report-bar{position:fixed;top:0;left:0;right:0;height:52px;z-index:1000;box-sizing:border-box;background:#0062C2;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 24px;box-shadow:0 1px 3px rgba(0,0,0,0.25);font-family:'Segoe UI',Arial,sans-serif;}.report-bar .title{font-size:16px;font-weight:600;letter-spacing:0.3px;}.report-bar .actions{display:flex;gap:10px;}.report-bar button{display:inline-flex;align-items:center;gap:7px;padding:8px 18px;border:none;border-radius:3px;font:600 14px 'Segoe UI',Arial,sans-serif;cursor:pointer;}.report-bar .btn-print{background:#4FBA5B;color:#fff;}.report-bar .btn-print:hover{background:#43a64e;}.report-bar .btn-download{background:#fff;color:#0062C2;}.report-bar .btn-download:hover{background:#e8f1fb;}.report-bar svg{width:16px;height:16px;fill:currentColor;}";
const REPORT_PRINT_ICON = '<svg viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>';
const REPORT_DOWNLOAD_ICON = '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

function buildReportBar(d, win, onDownload) {
  const bar = d.createElement('div');
  bar.className = 'report-bar';
  const title = d.createElement('div');
  title.className = 'title';
  title.textContent = 'Report';
  const actions = d.createElement('div');
  actions.className = 'actions';
  const printBtn = d.createElement('button');
  printBtn.className = 'btn-print';
  printBtn.innerHTML = `${REPORT_PRINT_ICON}<span>Print</span>`;
  printBtn.onclick = () => win.print();
  actions.appendChild(printBtn);
  if (onDownload) {
    const downloadBtn = d.createElement('button');
    downloadBtn.className = 'btn-download';
    downloadBtn.innerHTML = `${REPORT_DOWNLOAD_ICON}<span>Download</span>`;
    downloadBtn.onclick = onDownload;
    actions.appendChild(downloadBtn);
  }
  bar.appendChild(title);
  bar.appendChild(actions);
  d.body.appendChild(bar);
}

function cleanReportHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  tpl.content.querySelectorAll('script,iframe,object,embed').forEach(el => el.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });
  const box = document.createElement('div');
  box.appendChild(tpl.content);
  return box.innerHTML;
}

function escapeReportText(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function openReportPopup() {
  const w = Math.min(900, screen.availWidth || 900);
  const h = Math.min(950, screen.availHeight || 950);
  const left = Math.max(0, Math.round(((screen.availWidth || w) - w) / 2));
  const top = Math.max(0, Math.round(((screen.availHeight || h) - h) / 2));
  const features = `popup=yes,toolbar=no,menubar=no,location=no,status=no,resizable=yes,scrollbars=yes,width=${w},height=${h},left=${left},top=${top}`;
  const win = window.open('', `reportView_${Date.now()}`, features);
  if (win) {
    try {
      win.document.open();
      win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report</title></head><body style="font-family:Arial,sans-serif;padding:20px;">Loading report...</body></html>');
      win.document.close();
    } catch (e) {}
  }
  return win;
}

function renderReportPopup(win, reports) {
  const items = reports.filter(r => r.report_content && String(r.report_content).trim() !== '');
  if (!items.length) return false;
  const sections = items.map((r, i) => {
    const metaParts = [];
    if (r.reported_by) metaParts.push(`Reported by: ${escapeReportText(r.reported_by)}`);
    if (r.created_at) metaParts.push(escapeReportText(r.created_at));
    const meta = items.length > 1 || metaParts.length
      ? `<div class="meta">${items.length > 1 ? `<strong>Report ${i + 1}</strong> ` : ''}${metaParts.join(' | ')}</div>`
      : '';
    return `<div class="report">${meta}<div class="body">${cleanReportHtml(r.report_content)}</div></div>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report</title><style>
    body{font-family:Calibri,Arial,sans-serif;background:#e9ecef;margin:0;padding:20px;color:#000;}
    .report{background:#fff;max-width:794px;margin:0 auto 20px;padding:40px 50px;box-shadow:0 2px 8px rgba(0,0,0,0.25);font-size:14px;line-height:1.5;}
    .meta{border-bottom:1px solid #ccc;padding-bottom:8px;margin-bottom:16px;font-size:13px;color:#444;}
    .body img{max-width:100%;}
    .body table{border-collapse:collapse;max-width:100%;}
    .body td,.body th{border:1px solid #999;padding:4px 6px;}
    .ql-align-center{text-align:center;}.ql-align-right{text-align:right;}.ql-align-justify{text-align:justify;}
    .ql-indent-1{padding-left:3em;}.ql-indent-2{padding-left:6em;}.ql-indent-3{padding-left:9em;}
    @media print{body{background:#fff;padding:0 !important;}.report{box-shadow:none;margin:0;max-width:none;}.report-bar{display:none !important;}}
    ${REPORT_BAR_CSS}
  </style></head><body>${sections}</body></html>`;
  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
    const fileUrl = (items.find(r => r.report_file) || {}).report_file;
    buildReportBar(win.document, win, fileUrl ? () => {
      const a = win.document.createElement('a');
      a.href = fileUrl;
      a.download = decodeURIComponent(fileUrl.split('?')[0].split('/').pop() || 'report.docx');
      win.document.body.appendChild(a);
      a.click();
      a.remove();
    } : null);
    win.focus();
    return true;
  } catch (e) {
    return false;
  }
}

function loadReportLib(urls) {
  return urls.reduce((chain, url) => chain.then(ok => {
    if (ok) return true;
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve(true);
      s.onerror = () => { s.remove(); resolve(false); };
      document.head.appendChild(s);
    });
  }), Promise.resolve(false));
}

async function ensureDocxPreview() {
  if (!window.JSZip) {
    await loadReportLib(['./script/jszip.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js']);
  }
  if (!window.docx || !window.docx.renderAsync) {
    await loadReportLib(['./script/docx-preview.min.js', 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/dist/docx-preview.min.js']);
  }
  return !!(window.JSZip && window.docx && window.docx.renderAsync);
}

async function prepareReportDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const frames = [];
  const docFile = zip.file('word/document.xml');
  if (!docFile) return { data: buffer, frames };
  const parser = new DOMParser();
  const doc = parser.parseFromString(await docFile.async('string'), 'application/xml');
  const relMap = {};
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const rels = parser.parseFromString(await relsFile.async('string'), 'application/xml');
    Array.from(rels.getElementsByTagName('Relationship')).forEach(r => {
      relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    });
  }
  const framed = Array.from(doc.getElementsByTagName('w:framePr'));
  for (const fp of framed) {
    const para = fp.parentNode && fp.parentNode.parentNode;
    if (!para || para.nodeName !== 'w:p' || !para.parentNode) continue;
    const x = parseInt(fp.getAttribute('w:x'), 10) || 0;
    const y = parseInt(fp.getAttribute('w:y'), 10) || 0;
    let frame = frames.find(f => f.x === x && f.y === y);
    if (!frame) {
      frame = { x, y, image: '', imageWidthPt: 0, text: '' };
      frames.push(frame);
    }
    const blip = para.getElementsByTagName('a:blip')[0];
    if (blip) {
      const target = relMap[blip.getAttribute('r:embed')];
      const imgFile = target ? zip.file('word/' + target.replace(/^\/?(word\/)?/, '')) : null;
      if (imgFile) {
        const ext = (target.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        frame.image = `data:${mime};base64,${await imgFile.async('base64')}`;
        const extent = para.getElementsByTagName('wp:extent')[0];
        if (extent) frame.imageWidthPt = (parseInt(extent.getAttribute('cx'), 10) || 0) / 12700;
      }
    }
    const text = Array.from(para.getElementsByTagName('w:t')).map(t => t.textContent).join('');
    if (text) frame.text = text;
    para.parentNode.removeChild(para);
  }
  const floated = Array.from(doc.getElementsByTagName('w:tblpPr'));
  for (const fp of floated) {
    const tbl = fp.parentNode && fp.parentNode.parentNode;
    if (!tbl || tbl.nodeName !== 'w:tbl' || !tbl.parentNode) continue;
    const num = (el, attr) => el ? (parseInt(el.getAttribute(attr), 10) || 0) : 0;
    const box = {
      x: parseInt(fp.getAttribute('w:tblpX'), 10) || 0,
      y: parseInt(fp.getAttribute('w:tblpY'), 10) || 0,
      w: num(tbl.getElementsByTagName('w:tblW')[0], 'w:w'),
      h: num(tbl.getElementsByTagName('w:trHeight')[0], 'w:val'),
      bordered: tbl.getElementsByTagName('w:tblBorders').length > 0,
      image: '',
      imageWidthPt: 0,
      text: ''
    };
    const blip = tbl.getElementsByTagName('a:blip')[0];
    if (blip) {
      const target = relMap[blip.getAttribute('r:embed')];
      const imgFile = target ? zip.file('word/' + target.replace(/^\/?(word\/)?/, '')) : null;
      if (imgFile) {
        const ext = (target.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        box.image = `data:${mime};base64,${await imgFile.async('base64')}`;
        const extent = tbl.getElementsByTagName('wp:extent')[0];
        if (extent) box.imageWidthPt = (parseInt(extent.getAttribute('cx'), 10) || 0) / 12700;
      }
    }
    frames.push(box);
    tbl.parentNode.removeChild(tbl);
  }
  if (!frames.length) return { data: buffer, frames };
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  return { data: await zip.generateAsync({ type: 'arraybuffer' }), frames };
}

function normalizeReportLines(root) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const bodyRun = doc.querySelector('section.docx article span[style*="font-family"]');
  const bodyFont = bodyRun ? bodyRun.style.fontFamily : '';
  const naturalOf = (size, family) => {
    const probe = doc.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;line-height:normal;font-size:${size};font-family:${family};`;
    probe.textContent = 'Xgy';
    doc.body.appendChild(probe);
    const ratio = probe.getBoundingClientRect().height / (parseFloat(size) || 16);
    probe.remove();
    return ratio > 0.8 ? ratio : 1.2;
  };
  root.querySelectorAll('section.docx p').forEach(p => {
    const inHeader = !!p.closest('header,footer');
    const runs = Array.from(p.querySelectorAll('span')).filter(s => s.style.fontSize && (s.textContent || '').length);
    if (runs.length) {
      let big = runs[0];
      let bigSize = parseFloat(big.style.fontSize) || 0;
      runs.forEach(r => {
        const size = parseFloat(r.style.fontSize) || 0;
        if (size > bigSize) { big = r; bigSize = size; }
      });
      p.style.fontSize = big.style.fontSize;
      if (big.style.fontFamily) p.style.fontFamily = big.style.fontFamily;
    }
    const isEmpty = !runs.length && !(p.textContent || '').trim() && !p.querySelector('img,svg,table');
    if (isEmpty) {
      p.style.fontSize = '11pt';
      if (bodyFont) p.style.fontFamily = bodyFont;
    }
    const cs = view.getComputedStyle(p);
    const fs = parseFloat(cs.fontSize);
    const natural = naturalOf(cs.fontSize, cs.fontFamily);
    let linePx = natural * fs;
    const lh = parseFloat(cs.lineHeight);
    if (cs.lineHeight !== 'normal' && lh && fs) {
      const mult = lh / fs;
      if (Math.abs(mult - 1) < 0.02) {
        p.style.lineHeight = 'normal';
      } else if (mult > 1.02 && mult < 3 && !inHeader && /^[\d.]*$/.test(p.style.lineHeight || '')) {
        p.style.lineHeight = (mult * natural).toFixed(3);
        linePx = mult * natural * fs;
      } else {
        linePx = lh;
      }
    }
    if (isEmpty && !inHeader) p.style.minHeight = linePx.toFixed(2) + 'px';
  });
  root.querySelectorAll('section.docx td, section.docx th').forEach(cell => {
    if (!cell.style.paddingTop) cell.style.paddingTop = '0';
    if (!cell.style.paddingBottom) cell.style.paddingBottom = '0';
  });
}

async function renderDocxPopup(win, reports) {
  const files = reports.map(r => r.report_file).filter(f => f && /\.docx(\?|$)/i.test(f));
  if (!files.length) return false;
  try {
    if (!(await ensureDocxPreview())) return false;
    const prepared = await Promise.all(files.map(async f => {
      const res = await fetch(f);
      if (!res.ok) throw new Error('docx unavailable');
      const original = await res.arrayBuffer();
      const result = await prepareReportDocx(original.slice(0));
      return Object.assign(result, { original, name: decodeURIComponent(f.split('?')[0].split('/').pop() || 'report.docx') });
    }));
    if (win.closed) return true;
    const d = win.document;
    d.open();
    d.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report</title><style>html,body{margin:0;background:#e9ecef;}.docx-wrapper{background:#e9ecef !important;padding:20px 0 !important;}${REPORT_BAR_CSS}@page{size:A4;margin:0;}@media print{*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}html,body{background:#fff !important;margin:0 !important;}.report-bar{display:none !important;}body{padding-top:0 !important;}.docx-wrapper{background:#fff !important;padding:0 !important;display:block !important;}.docx-wrapper > section.docx{box-shadow:none !important;margin:0 auto !important;min-height:0 !important;break-after:page;page-break-after:always;}.docx-wrapper > section.docx:last-child{break-after:auto;page-break-after:auto;}}</style></head><body></body></html>`);
    d.close();
    const first = prepared[0];
    buildReportBar(d, win, () => {
      const a = d.createElement('a');
      a.href = URL.createObjectURL(new Blob([first.original], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      a.download = first.name;
      d.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    for (const item of prepared) {
      const holder = d.createElement('div');
      d.body.appendChild(holder);
      await docx.renderAsync(item.data, holder, holder, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true
      });
      normalizeReportLines(holder);
      const page = holder.querySelector('section');
      if (page) {
        page.style.position = 'relative';
        item.frames.forEach(frame => {
          const box = d.createElement('div');
          box.style.cssText = `position:absolute;left:${frame.x / 20}pt;top:${frame.y / 20}pt;z-index:5;`;
          if (frame.w) {
            box.style.cssText += `box-sizing:border-box;width:${frame.w / 20}pt;${frame.h ? `height:${frame.h / 20}pt;` : ''}display:flex;align-items:center;justify-content:center;background:#fff;${frame.bordered ? 'border:1px solid #000;' : ''}`;
          }
          if (frame.image) {
            const img = d.createElement('img');
            img.src = frame.image;
            img.style.cssText = `display:block;width:${frame.imageWidthPt || 64.8}pt;height:auto;`;
            box.appendChild(img);
          }
          if (frame.text) {
            const label = d.createElement('div');
            label.textContent = frame.text;
            label.style.cssText = 'font:8pt Calibri,Arial,sans-serif;color:#0066cc;white-space:nowrap;margin-top:2pt;';
            box.appendChild(label);
          }
          page.appendChild(box);
        });
      }
    }
    win.focus();
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function pickLatestReport(reports) {
  const stamp = r => {
    const m = String(r.created_at || '').match(/^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return Infinity;
    return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
  };
  let best = null;
  let bestStamp = -Infinity;
  reports.forEach(r => {
    const t = stamp(r);
    if (best === null || t >= bestStamp) {
      best = r;
      bestStamp = t;
    }
  });
  return best;
}

async function showReportPopup(report, fallbackUrl) {
  const win = openReportPopup();
  if (win && await renderDocxPopup(win, [report])) {
    return;
  }
  if (win && renderReportPopup(win, [report])) {
    return;
  }
  const fileUrl = report.report_file || fallbackUrl;
  if (win) {
    if (fileUrl) {
      win.location.href = fileUrl;
    } else {
      win.close();
      alert('No report available');
    }
    return;
  }
  if (fileUrl) {
    window.open(fileUrl, '_blank');
  } else {
    alert('No report available');
  }
}

function openReportChooser(reports, onPick) {
  const existing = document.getElementById('combined-report-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'combined-report-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const linksHtml = reports.map((r, i) => {
    let label = `Report ${i+1}`;
    if (r.reported_by) label += ` - ${r.reported_by}`;
    if (r.created_at) label += ` (${r.created_at})`;
    return `<div style="margin:8px 0;"><a href="#" class="report-chooser-link" data-index="${i}" style="color:#0066cc;font-size:15px;text-decoration:none;padding:8px 12px;background:#f0f7ff;border:1px solid #cce;border-radius:4px;display:inline-block;">📄 ${label}</a></div>`;
  }).join('');
  modal.innerHTML = `<div style="background:#fff;border-radius:8px;padding:30px;min-width:360px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><strong style="font-size:17px;">Reports (${reports.length})</strong><button type="button" class="report-chooser-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666;">✕</button></div>${linksHtml}</div>`;
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  modal.querySelector('.report-chooser-close').addEventListener('click', function() { modal.remove(); });
  modal.querySelectorAll('.report-chooser-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const picked = reports[Number(this.dataset.index)];
      modal.remove();
      onPick(picked);
    });
  });
  document.body.appendChild(modal);
}

async function openReport(reportUrl, studyUid) {
  const win = openReportPopup();
  let reports = [];
  let allReports = [];
  if (studyUid && studyUid !== 'undefined' && studyUid !== '') {
    try {
      const res = await fetch(`${baseUrl}/api/study-reports/?study_uid=${encodeURIComponent(studyUid)}`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.reports && data.reports.length > 0) {
          if (data.reports.length > 1) {
            allReports = data.reports;
          } else {
            reports = [pickLatestReport(data.reports)];
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
  if (allReports.length > 1) {
    if (win) win.close();
    openReportChooser(allReports, picked => showReportPopup(picked, reportUrl));
    return;
  }
  if (win && reports.length && await renderDocxPopup(win, reports)) {
    return;
  }
  if (win && reports.length && renderReportPopup(win, reports)) {
    return;
  }
  const fileUrl = (reports.find(r => r.report_file) || {}).report_file || reportUrl;
  if (win) {
    if (fileUrl) {
      win.location.href = fileUrl;
    } else {
      win.close();
      alert('No report available');
    }
    return;
  }
  if (reports.length > 1) {
    openCombinedReportModal(reports);
  } else if (fileUrl) {
    window.open(fileUrl, '_blank');
  } else {
    alert('No report available');
  }
}

function bindRowActions(tr) {
  tr.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      openReport(this.dataset.reportUrl || '', this.dataset.studyUid || '');
    });
  });
  
  tr.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const dicomUrl = this.dataset.dicomUrl;
      const studyUID = this.dataset.studyUid;
      const patientId = this.dataset.patientId;
      openViewer(dicomUrl, studyUID, patientId);
    });
  });
}

function createPaginationControls() {
  let paginationContainer = document.getElementById('pagination-container');
  
  if (!paginationContainer) {
    paginationContainer = document.createElement('div');
    paginationContainer.id = 'pagination-container';
    paginationContainer.className = 'pagination-container';
    
    const patientList = document.getElementById('patient-list');
    if (patientList) {
      patientList.appendChild(paginationContainer);
    }
  }
  
  if (totalCount === 0) {
    paginationContainer.style.display = 'none';
    paginationContainer.dataset.sig = '';
    return;
  }
  
  paginationContainer.style.display = 'block';

  const paginationSig = `${currentPage}|${totalPages}|${totalCount}`;
  if (paginationContainer.dataset.sig === paginationSig && paginationContainer.children.length) {
    return;
  }
  paginationContainer.dataset.sig = paginationSig;
  
  paginationContainer.innerHTML = `
    <div class="pagination-wrapper">
      <div class="pagination-info">
        <span id="pagination-info-text"></span>
      </div>
      
      <div class="pagination-buttons">
        <button onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''} class="pagination-btn">⟪</button>
        <button onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="pagination-btn">⟨</button>
        <div class="page-numbers" id="page-numbers"></div>
        <button onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="pagination-btn">⟩</button>
        <button onclick="goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''} class="pagination-btn">⟫</button>
      </div>
    </div>
  `;

  generatePageNumbers();
  updatePaginationInfo();
}

function generatePageNumbers() {
  const pageNumbersContainer = document.getElementById('page-numbers');
  if (!pageNumbersContainer) return;
  
  pageNumbersContainer.innerHTML = '';
  
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);
  
  if (currentPage <= 3) {
    endPage = Math.min(5, totalPages);
  }
  if (currentPage > totalPages - 3) {
    startPage = Math.max(totalPages - 4, 1);
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const button = document.createElement('button');
    button.textContent = i;
    button.className = `pagination-btn page-btn ${i === currentPage ? 'active' : ''}`;
    button.onclick = () => goToPage(i);
    pageNumbersContainer.appendChild(button);
  }
}

function updatePaginationInfo() {
  const infoElement = document.getElementById('pagination-info-text');
  if (!infoElement) return;
  
  const startPatient = Math.min((currentPage - 1) * itemsPerPage + 1, totalCount);
  const endPatient = Math.min(currentPage * itemsPerPage, totalCount);
  
  if (totalCount === 0) {
    infoElement.textContent = 'No studies to show';
  } else {
    infoElement.textContent = `Showing ${startPatient}-${endPatient} of ${totalCount} studies`;
  }
}

function goToPage(page) {
  if (page < 1 || page > totalPages || page === currentPage) return;

  currentPage = page;
  sessionStorage.setItem('doctorCurrentPage', currentPage);
  const selectAll = document.getElementById('select-all');
  if (selectAll) selectAll.checked = false;
  fetchAssignedStudies(loggedInDoctorName, page, true);
}

function buildViewerWarning(names) {
  const list = names.map((name, i) => `${i + 1}. ${name}`).join('\n');
  return `Following users are currently viewing the study:\n\n${list}\n\nDo you really wish to load this study?`;
}

function confirmViewerWarning(win, names) {
  const message = buildViewerWarning(names);
  try {
    if (win && !win.closed) return win.confirm(message);
  } catch (e) {}
  return confirm(message);
}

async function loadSelectedStudies() {
  const checked = document.querySelectorAll('.row-checkbox:checked');
  if (!checked.length) {
    alert('Please select at least one study');
    return;
  }

  if (!userPermissions.can_view_images) {
    alert('You do not have permission to view images');
    return;
  }

  const uids = [];
  checked.forEach(cb => {
    const uid = cb.dataset.studyUid;
    if (uid && uid !== 'undefined' && !uids.includes(uid)) {
      uids.push(uid);
    }
  });

  if (!uids.length) {
    alert('No DICOM study available for the selected rows');
    return;
  }

  const screenW = screen.availWidth || window.screen.width;
  const screenH = screen.availHeight || window.screen.height;
  const features = `toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes,status=no,width=${screenW},height=${screenH},left=0,top=0`;

  const checkHeaders = { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' };
  const opened = uids.map(uid => {
    const win = window.open(`./viewer.html?study=${uid}`, '_blank', features);
    const req = win
      ? fetch(`${baseUrl}/api/viewer/check/?study_uid=${encodeURIComponent(uid)}`, { headers: checkHeaders })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      : null;
    return { win, req };
  });
  const blocked = opened.filter(o => !o.win).length;

  startAutoRefresh();

  for (const o of opened) {
    if (!o.req) continue;
    const data = await o.req;
    if (data && data.success && data.active_viewers && data.active_viewers.length > 0) {
      if (!confirmViewerWarning(o.win, data.active_viewers) && o.win && !o.win.closed) o.win.close();
    }
  }

  if (blocked) {
    alert('Some windows were blocked by the browser. Please allow popups for this site and try again.');
  }
}

async function openViewer(fileUrl, studyUID, patientId) {
  if (!fileUrl && !studyUID) {
    alert("No DICOM file available");
    return;
  }
  
  if (!userPermissions.can_view_images) {
    alert('You do not have permission to view images');
    return;
  }

  const hasStudy = studyUID && studyUID !== '' && studyUID !== 'undefined';
  const screenW = screen.availWidth || window.screen.width;
  const screenH = screen.availHeight || window.screen.height;
  const fullWindowFeatures = `toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes,status=no,width=${screenW},height=${screenH},left=0,top=0`;
  let viewerWindow = null;
  
  try {
    if (patientId) {
      sessionStorage.setItem('currentPatientId', patientId);
    }

    if (hasStudy) {
      const viewerUrl = `./viewer.html?study=${studyUID}`;
      viewerWindow = window.open(viewerUrl, "_blank", fullWindowFeatures);

      const viewersResponse = await fetch(`${baseUrl}/api/viewer/check/?study_uid=${studyUID}`, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (viewersResponse.ok) {
        const viewersData = await viewersResponse.json();
        if (viewersData.success && viewersData.active_viewers && viewersData.active_viewers.length > 0) {
          const userConfirmed = confirmViewerWarning(viewerWindow, viewersData.active_viewers);
          
          if (!userConfirmed) {
            if (viewerWindow && !viewerWindow.closed) viewerWindow.close();
            return;
          }
        }
      }

      if (!viewerWindow) window.open(viewerUrl, "_blank", fullWindowFeatures);
      startAutoRefresh();
      return;
    }
    
    if (fileUrl) {
      const cleanUrl = fileUrl.split("?")[0];
      let filename = '';
      
      if (cleanUrl.includes('/media/')) {
        filename = cleanUrl.split('/media/')[1];
      } else if (cleanUrl.includes('/dicom_files/')) {
        filename = 'dicom_files/' + cleanUrl.split('/dicom_files/')[1];
      } else {
        filename = cleanUrl.replace(baseUrl + '/', '');
      }
      
      const dicomUrl = `/dicom/${filename}/`;
      window.open(`/static/viewer.html?file=${encodeURIComponent(dicomUrl)}`, "_blank", fullWindowFeatures);
      startAutoRefresh();
    } else {
      alert("No valid DICOM file or study UID found");
    }
    
  } catch (error) {
    if (viewerWindow && !viewerWindow.closed) viewerWindow.close();
    console.error('Error opening DICOM viewer:', error);
    alert("Error opening DICOM viewer. Please check the file path.");
  }
}

function startEditRefBy(span) {
  const td = span.closest('td');
  const id = td.dataset.id;
  const currentValue = td.dataset.value || '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.style.cssText = 'width:100%;border:1px solid #4a90e2;padding:3px 5px;border-radius:3px;font-size:13px;box-sizing:border-box;';

  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  input.select();

  const save = async () => {
    const newValue = input.value.trim();
    await updateReferredBy(id, newValue);
    td.dataset.value = newValue;
    td.innerHTML = `<span class="refd-by-text" style="cursor:pointer;" onclick="startEditRefBy(this)">${newValue ? escapeHtml(newValue) : '<em style=\'color:#bbb\'>—</em>'}</span>`;
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      td.innerHTML = `<span class="refd-by-text" style="cursor:pointer;" onclick="startEditRefBy(this)">${currentValue ? escapeHtml(currentValue) : '<em style=\'color:#bbb\'>—</em>'}</span>`;
    }
  });
}

async function updateReferredBy(imageId, value) {
  try {
    const response = await fetch(`${baseUrl}/api/dicom-images/${imageId}/`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ referring_physician: value })
    });
    if (!response.ok) {
      throw new Error('Failed to update');
    }
  } catch (error) {
    console.error('Error updating Referred By:', error);
    alert('Failed to save Referred By: ' + error.message);
  }
}

function isEditingInTable() {
  const el = document.activeElement;
  return !!(el && el.tagName === 'INPUT' && el.type === 'text' && el.closest && el.closest('#patient-table-body'));
}

async function pollStudies() {
  if (!loggedInDoctorName || document.hidden || inFlight > 0 || isEditingInTable()) return;
  await fetchAssignedStudies(loggedInDoctorName, currentPage, true, true);
}

function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  autoRefreshInterval = setInterval(pollStudies, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

window.addEventListener('focus', () => {
  if (Date.now() - lastFetchAt < FOCUS_REFRESH_GAP_MS) return;
  pollStudies();
});

window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});

const HISTORY_YES_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="hyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6ff6a"/><stop offset="1" stop-color="#6fcf4c"/></linearGradient></defs><rect x="1.5" y="2.5" width="13" height="11" fill="url(#hyg)" stroke="#0a6a0a" stroke-width="1.4"/><rect x="3" y="9" width="10" height="3" fill="#5fbf4a"/><rect x="3" y="9" width="10" height="1" fill="#3f9f3a"/><rect x="4.5" y="5" width="7" height="1" fill="#c8ff9f"/></svg>';
const HISTORY_NO_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="hng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8e9fb"/><stop offset="1" stop-color="#7ea9dc"/></linearGradient></defs><path d="M2.5 1.5h8l3 3v10h-11z" fill="url(#hng)" stroke="#6c93c8" stroke-width="1"/><path d="M10.5 1.5v3h3" fill="#eef5fd" stroke="#6c93c8" stroke-width="1"/><path d="M4.5 6.5h5M4.5 8.5h4" stroke="#ffffff" stroke-width="1"/><path d="M8 14.5l1.5-3 3.5-3 1.5 1.5-3 3.5z" fill="#4a4f5a"/><path d="M12.8 8.5l1.5 1.5" stroke="#9aa0ab" stroke-width="1.2"/></svg>';

function historyIconHtml(hasHistory) {
  return hasHistory ? HISTORY_YES_SVG : HISTORY_NO_SVG;
}

function openHistory(patientId) {
  if (!patientId) return;
  const historyUrl = `./history.html?patient=${patientId}`;
  window.open(historyUrl, '_blank', 'width=950,height=900,scrollbars=yes,resizable=yes');
}

function logout() {
  stopAutoRefresh();
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('role');
  sessionStorage.removeItem('doctorCurrentPage');
  window.location.href = 'login.html';
}

window.addEventListener('DOMContentLoaded', async () => {
  // Show skeleton immediately — user sees activity right away
  showDoctorTableSkeleton();

  // Start session check and studies fetch together — don't wait for session before starting
  // We optimistically use the token from storage to start loading studies
  const savedPage = parseInt(sessionStorage.getItem('doctorCurrentPage'));
  if (savedPage > 0) currentPage = savedPage;

  restoreFilters();
  appliedFilters = collectFilters();
  appliedFilters.center = pendingCenterValue || 'ALL';

  const assignBtn = document.getElementById('assign-btn');
  if (assignBtn) {
    assignBtn.addEventListener('click', assignSelectedStudies);
  }

  // Session check runs first (it's fast and needed for doctor name)
  const sessionData = await loadDoctorSession();
  
  if (!sessionData) {
    return;
  }
  
  if (!token) {
    alert('Please login first');
    window.location.href = 'login.html';
    return;
  }
  
  try {
    loggedInDoctorName = sessionData.doctor_name || sessionData.full_name || sessionData.username;
    
    if (loggedInDoctorName) {
      document.getElementById('doctor-display-name').textContent = loggedInDoctorName;
      
      const dropdown = document.getElementById('doctor-name');
      if (dropdown) {
        dropdown.value = loggedInDoctorName;
      }
      
      updateUIBasedOnPermissions();
      
      await fetchAssignedStudies(loggedInDoctorName, currentPage, true);
      startAutoRefresh();
    } else {
      document.getElementById('doctor-display-name').textContent = 'Error loading name';
    }
  } catch (error) {
    console.error('Error during initialization:', error);
    document.getElementById('doctor-display-name').textContent = 'Error: ' + error.message;
  }
});

function showDoctorTableSkeleton() {
  const tbody = document.getElementById('patient-table-body');
  if (!tbody) return;
  const colCount = 14;
  const skeletonRow = `<tr class="skeleton-row">${Array(colCount).fill('<td><div class="skeleton-cell"></div></td>').join('')}</tr>`;
  tbody.innerHTML = Array(8).fill(skeletonRow).join('');
  document.getElementById('patient-list').style.display = 'block';

  if (!document.getElementById('skeleton-styles')) {
    const style = document.createElement('style');
    style.id = 'skeleton-styles';
    style.textContent = `
      .skeleton-cell {
        height: 16px;
        background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
        background-size: 200% 100%;
        animation: shimmer 1.2s infinite;
        border-radius: 4px;
        width: 80%;
        margin: auto;
      }
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    document.head.appendChild(style);
  }
}

let reportSavedTimer = null;

function handleReportSavedEvent() {
  clearTimeout(reportSavedTimer);
  reportSavedTimer = setTimeout(() => {
    fetchAssignedStudies(loggedInDoctorName, currentPage, true, true);
  }, 400);
}

const doctorRefreshChannel = new BroadcastChannel('doctor_refresh');
doctorRefreshChannel.addEventListener('message', async (e) => {
  const data = e.data || {};
  if (data.type === 'reportSaved' || data.type === 'refreshDoctor') {
    await handleReportSavedEvent(data);
  }
});

window.addEventListener('message', async (e) => {
  try {
    if (e.origin !== window.location.origin) return;
    const data = e.data || {};
    if (data.type === 'refreshDoctor' || data.type === 'reportSaved') {
      await handleReportSavedEvent(data);
    }
  } catch (err) {
    console.error(err);
  }
});
function openCombinedReportModal(reports) {
  const existing = document.getElementById('combined-report-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'combined-report-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
  
  let linksHtml = reports.map((r, i) => {
    let label = `Report ${i+1}`;
    if (r.reported_by) label += ` - ${r.reported_by}`;
    if (r.created_at) label += ` (${r.created_at})`;
    if (r.report_file) {
      return `<div style="margin:8px 0;"><a href="${r.report_file}" target="_blank" style="color:#0066cc;font-size:15px;text-decoration:none;padding:8px 12px;background:#f0f7ff;border:1px solid #cce;border-radius:4px;display:inline-block;">📄 ${label}</a></div>`;
    }
    return `<div style="margin:8px 0;color:#888;">📄 ${label} (no file)</div>`;
  }).join('');
  
  modal.innerHTML = `
    <div style="background:#fff;border-radius:8px;padding:30px;min-width:360px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <strong style="font-size:17px;">Reports (${reports.length})</strong>
        <button onclick="document.getElementById('combined-report-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666;">✕</button>
      </div>
      ${linksHtml}
    </div>
  `;
  
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.remove();
  });
  
  document.body.appendChild(modal);
}


function formatReceiveDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
