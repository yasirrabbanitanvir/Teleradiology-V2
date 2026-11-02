const baseUrl = window.location.origin;
let allStudies = [];
let token = sessionStorage.getItem('token') || localStorage.getItem('token');
let role = sessionStorage.getItem('role') || localStorage.getItem('role');
let availableDoctors = [];

let currentPage = parseInt(sessionStorage.getItem('currentPage')) || 1;
let itemsPerPage = 10;
let totalPages = 1;
let totalCount = 0;
let groupedPatients = {};

async function loadCurrentUser() {
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
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      window.location.href = 'login.html';
      return null;
    }

    const data = await response.json();

    if (!data.success) {
      return null;
    }

    const userRole = data.role;
    const currentPage = window.location.pathname;

    if (userRole === 'Doctor' && !currentPage.includes('doctor.html')) {
      window.location.href = 'doctor.html';
      return null;
    }

    if (userRole === 'SubAdmin' && !currentPage.includes('index.html')) {
      window.location.href = 'index.html';
      return null;
    }

    if (userRole === 'Center' && !currentPage.includes('institute.html')) {
      window.location.href = 'institute.html';
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error checking user role:', error);
    window.location.href = 'login.html';
    return null;
  }
}

function checkAuthentication() {
  if (!token) {
    alert('Please log in first');
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

const WAIT_GIF_WINDOW_MS = 25000;
const WAIT_GIF_POLL_MS = 4000;
let serverClockOffset = 0;
let receivingStudies = new Map();
let receivingPollTimer = null;

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
  receivingStudies = new Map();
  Object.keys(latest).forEach(uid => {
    if (serverNow - latest[uid] < WAIT_GIF_WINDOW_MS) {
      receivingStudies.set(uid, latest[uid] + WAIT_GIF_WINDOW_MS - serverClockOffset);
    }
  });
}

function waitGifHtml(studyUID) {
  const until = receivingStudies.get(studyUID);
  if (!until) return '';
  return `<img class="study-wait-gif" src="images/wait_hover.gif" alt="" title="Receiving new study..." data-until="${until}" width="17" height="19" style="margin-left:4px;vertical-align:middle;">`;
}

function scheduleReceivingPoll(refetch) {
  clearTimeout(receivingPollTimer);
  receivingPollTimer = null;
  if (!document.querySelector('.study-wait-gif')) return;
  receivingPollTimer = setTimeout(() => {
    if (document.querySelector('.row-checkbox:checked, .series-detail-row')) {
      const now = Date.now();
      document.querySelectorAll('.study-wait-gif').forEach(img => {
        if (now > Number(img.dataset.until)) img.remove();
      });
      scheduleReceivingPoll(refetch);
      return;
    }
    refetch();
  }, WAIT_GIF_POLL_MS);
}

function removeDuplicateStudies(studies) {
  const seen = new Set();
  const duplicatesRemoved = [];
  
  studies.forEach(study => {
    const uniqueKey = `${study.patientID || study.patient_id || ''}_${study.studyUID || study.study_instance_uid || study.id || ''}_${study.scanDateTime || study.study_date || ''}`;
    
    if (!seen.has(uniqueKey)) {
      seen.add(uniqueKey);
      duplicatesRemoved.push(study);
    }
  });
  
  return duplicatesRemoved;
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
      availableDoctors = data.doctors.map(doc => doc.name);
      
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
    alert('Failed to load doctors list');
  }
}

let cachedGroupsScript = null;

async function getGroupsFromDB() {
  try {
    const res = await fetch(`${baseUrl}/api/doctor-groups/`, {
      headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return [];
    const groups = await res.json();
    cachedGroupsScript = groups.filter(g => g.enabled !== false);
    return cachedGroupsScript;
  } catch {
    return [];
  }
}

async function fetchAndLoadStudies(maintainPage = false) {
  if (!checkAuthentication()) {
    return;
  }
  await searchStudies(maintainPage);
}

function populateCenterDropdown(centers) {
  const centerSelect = document.getElementById('center');
  if (!centerSelect) return;

  const currentValue = centerSelect.value;
  centerSelect.innerHTML = '<option value="ALL">All Centers</option>';

  const instituteMap = new Map();
  centers.forEach(c => {
    const institute = c.institute_name || c.center_name;
    if (institute && !instituteMap.has(institute)) {
      instituteMap.set(institute, c.center_name);
    }
  });

  Array.from(instituteMap.keys()).sort().forEach(institute => {
    const option = document.createElement('option');
    option.value = instituteMap.get(institute);
    option.textContent = institute;
    centerSelect.appendChild(option);
  });

  if (currentValue && Array.from(centerSelect.options).some(opt => opt.value === currentValue)) {
    centerSelect.value = currentValue;
  } else {
    centerSelect.value = 'ALL';
  }
}

async function loadCenterOptions() {
  try {
    const res = await fetch(`${baseUrl}/api/dicom-images/centers/`, {
      headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.centers) {
      populateCenterDropdown(data.centers);
    }
  } catch (err) {
    console.error('Error loading center options:', err);
  }
}

function goToPage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  sessionStorage.setItem('currentPage', currentPage);
  searchStudies(true);
}

function isSearchPanelEmpty() {
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 3);

  const nameQ = document.getElementById('patient-name')?.value.trim() || '';
  const idQ = document.getElementById('patient-id')?.value.trim() || '';
  const statusQ = document.getElementById('status')?.value || 'All';
  const centerQ = document.getElementById('center')?.value || 'ALL';
  const emergency = document.getElementById('emergency')?.checked || false;
  const startDate = document.getElementById('scan-start-date')?.value || '';
  const endDate = document.getElementById('scan-end-date')?.value || '';
  const allModalities = Array.from(document.querySelectorAll('.modality-checkbox')).every(cb => cb.checked);

  const startIsDefault = !startDate || startDate === fmt(past);
  const endIsDefault = !endDate || endDate === fmt(today);

  return !nameQ && !idQ && statusQ === 'All' && centerQ === 'ALL' && !emergency && allModalities && startIsDefault && endIsDefault;
}

async function searchStudies(maintainPage = false) {
  if (!maintainPage && isSearchPanelEmpty()) {
    sessionStorage.removeItem('currentPage');
    window.location.reload();
    return;
  }

  if (!checkAuthentication()) {
    return;
  }

  if (!maintainPage) {
    currentPage = 1;
    sessionStorage.setItem('currentPage', currentPage);
  }

  const nameQ = document.getElementById('patient-name')?.value.trim() || '';
  const idQ = document.getElementById('patient-id')?.value.trim() || '';
  const statusQ = document.getElementById('status')?.value || 'All';
  const centerQ = document.getElementById('center')?.value || 'ALL';
  const emergencyFilter = document.getElementById('emergency')?.checked || false;
  const selectedModalities = Array.from(document.querySelectorAll('.modality-checkbox:checked')).map(cb => cb.value);
  const startDate = document.getElementById('scan-start-date')?.value || '';
  const endDate = document.getElementById('scan-end-date')?.value || '';

  const params = new URLSearchParams();
  params.append('page', currentPage.toString());
  params.append('page_size', itemsPerPage.toString());

  if (nameQ) params.append('patient_name', nameQ);
  if (idQ) params.append('patient_id', idQ);
  if (statusQ !== 'All') params.append('status', statusQ);
  if (centerQ !== 'ALL') params.append('center_name', centerQ);
  if (emergencyFilter) params.append('emergency', 'true');
  if (selectedModalities.length > 0) params.append('modality', selectedModalities.join(','));
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);

  try {
    const [res, doctorsRes, groupsRes] = await Promise.all([
      fetch(`${baseUrl}/api/dicom-images/?${params.toString()}`, {
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json'
        }
      }),
      fetch(`${baseUrl}/api/doctors/`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      }),
      fetch(`${baseUrl}/api/doctor-groups/`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      })
    ]);

    if (res.status === 401) {
      alert('Session expired. Please log in again.');
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      sessionStorage.removeItem('currentPage');
      window.location.href = 'login.html';
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    syncServerClock(res);

    try {
      if (doctorsRes.ok) {
        const doctorsData = await doctorsRes.json();
        if (doctorsData.success && doctorsData.doctors) {
          availableDoctors = doctorsData.doctors.map(doc => doc.name);
          const assignSelect = document.getElementById('assign-doctors');
          if (assignSelect) {
            assignSelect.innerHTML = '';
            doctorsData.doctors.forEach(doctor => {
              const option = document.createElement('option');
              option.value = doctor.name;
              option.textContent = `${doctor.name} ${doctor.designation ? '(' + doctor.designation + ')' : ''}`;
              assignSelect.appendChild(option);
            });
            if (groupsRes.ok) {
              const groups = await groupsRes.json();
              cachedGroupsScript = groups.filter(g => g.enabled !== false);
              cachedGroupsScript.forEach(group => {
                const option = document.createElement('option');
                option.value = '__group__' + group.id;
                option.textContent = group.name;
                option.dataset.groupMembers = JSON.stringify(group.members || []);
                assignSelect.appendChild(option);
              });
            }
          }
        }
      }
    } catch (doctorErr) {
      console.error('Error loading doctors:', doctorErr);
    }

    const responseData = await res.json();

    let dicomImages;
    if (responseData.results && Array.isArray(responseData.results)) {
      dicomImages = responseData.results;
    } else if (Array.isArray(responseData)) {
      dicomImages = responseData;
    } else {
      throw new Error('Invalid response format from server');
    }

    let processedStudies = dicomImages.map(dicom => {

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

      return {
        id: dicom.id,
        patientName: dicom.patient_name || 'Unknown',
        patientID: dicom.patient_id || '',
        age: dicom.age || 0,
        sex: dicom.patient_sex || '',
        bodyPart: dicom.study_description || dicom.series_description || '',
        modality: dicom.modality || '',
        center: dicom.center_name || 'Default',
        institute: displayInstitute,
        scanDateTime: scanDateTime,
        receiveDateTime: formatReceiveDateTime(dicom.received_at || dicom.created_at) || scanDateTime,
        status: dicom.status || 'Not Assigned',
        reportedBy: dicom.reported_by || '',
        group: dicom.assigned_doctors || '',
        assignedDoctors: dicom.assigned_doctors_list || [],
        dicomFile: dicom.file_path ? `${baseUrl}/media/${dicom.file_path}` : '',
        reportPdf: reportUrl || '',
        locked: dicom.is_emergency || false,
        studyDescription: dicom.study_description || '',
        images: dicom.images || dicom.image_urls || [],
        thumbnailUrl: dicom.thumbnail_url || '',
        studyUID: dicom.study_instance_uid || dicom.study_uid || dicom.id,
        dbId: dicom.id,
        referredBy: dicom.referring_physician || '',
        patientHistory: dicom.patient_history || '',
        referralFile: dicom.referral_file || '',
        createdAt: dicom.created_at || ''
      };
    });

    detectReceivingStudies(processedStudies);

    allStudies = removeDuplicateStudies(processedStudies);
    allStudies.sort((a, b) => b.dbId - a.dbId);

    const groupedAll = {};
    allStudies.forEach(study => {
      const patientId = study.patientID || 'Unknown';
      if (!groupedAll[patientId]) {
        groupedAll[patientId] = {
          patientID: patientId,
          maxId: study.dbId,
          images: []
        };
      }
      groupedAll[patientId].images.push(study);
      if (study.dbId > groupedAll[patientId].maxId) {
        groupedAll[patientId].maxId = study.dbId;
      }
    });

    groupedPatients = Object.values(groupedAll).sort((a, b) => b.maxId - a.maxId);

    totalCount = typeof responseData.count === 'number' ? responseData.count : groupedPatients.length;
    totalPages = typeof responseData.total_pages === 'number' ? responseData.total_pages : 1;

    if (currentPage > totalPages && totalPages > 0) {
      currentPage = totalPages;
      sessionStorage.setItem('currentPage', currentPage);
    }
    if (currentPage < 1) {
      currentPage = 1;
      sessionStorage.setItem('currentPage', currentPage);
    }

    loadStudies();
    createPaginationControls();
    refreshLocks();
    scheduleReceivingPoll(() => fetchAndLoadStudies(true));

  } catch (err) {
    console.error('Error fetching studies:', err);
    alert('Error fetching studies: ' + err.message);
  }
}

function createPaginationControls() {
  let paginationContainer = document.getElementById('pagination-container');
  
  if (!paginationContainer) {
    paginationContainer = document.createElement('div');
    paginationContainer.id = 'pagination-container';
    paginationContainer.className = 'pagination-container';
    
    const table = document.querySelector('table');
    if (table && table.parentNode) {
      table.parentNode.insertBefore(paginationContainer, table.nextSibling);
    }
  }
  
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
  
  if (!document.getElementById('pagination-styles')) {
    addPaginationStyles();
  }
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
    infoElement.textContent = 'No patients to show';
  } else {
    infoElement.textContent = `Showing ${startPatient}-${endPatient} of ${totalCount} patients`;
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
      const study = allStudies.find(s => s.id === imageId);
      if (study) {
        study.assignedDoctors = study.assignedDoctors.filter(d => d !== doctorName);
        study.group = study.assignedDoctors.join(', ');
      }
      
      await fetchAndLoadStudies(true);
    } else {
      throw new Error(result.error || 'Removal failed');
    }
    
  } catch (error) {
    console.error('Error removing doctor:', error);
    alert('Error removing doctor: ' + error.message);
  }
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

function generateDoctorsList(study) {
  if (!study.assignedDoctors || study.assignedDoctors.length === 0) {
    return '—';
  }

  const knownGroups = cachedGroupsScript || [];
  const groupNames = knownGroups.map(g => g.name);
  const assignedSet = study.assignedDoctors;

  const groupMatches = knownGroups.filter(g => assignedSet.includes(g.name));
  if (groupMatches.length > 0) {
    const membersCoveredByGroups = new Set();
    groupMatches.forEach(g => (g.members || []).forEach(m => membersCoveredByGroups.add(m)));

    const parts = [];
    groupMatches.forEach(g => {
      parts.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0;padding:3px 5px;background:#e8d5f5;border-radius:3px;">
        <span style="font-weight:600;color:#6a0dad;">👥 ${g.name}</span>
        <button onclick="removeSingleDoctor(${study.id}, '${g.name}')" style="background:#ff4444;color:white;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:12px;margin-left:5px;">×</button>
      </div>`);
    });

    assignedSet.forEach(doctor => {
      if (!groupNames.includes(doctor) && !membersCoveredByGroups.has(doctor)) {
        parts.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0;padding:3px 5px;background:#f0f0f0;border-radius:3px;">
          <span>${doctor}</span>
          <button onclick="removeSingleDoctor(${study.id}, '${doctor}')" style="background:#ff4444;color:white;border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:12px;margin-left:5px;">×</button>
        </div>`);
      }
    });
    return parts.join('');
  }

  return study.assignedDoctors.map(doctor => {
    return `<div style="display: flex; justify-content: space-between; align-items: center; margin: 3px 0; padding: 3px 5px; background: #f0f0f0; border-radius: 3px;">
      <span>${doctor}</span>
      <button onclick="removeSingleDoctor(${study.id}, '${doctor}')" style="background: #ff4444; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px; margin-left: 5px;">×</button>
    </div>`;
  }).join('');
}

let studyLockCache = {};

function escapeLockHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ensureLockStyles() {
  if (document.getElementById('lock-styles')) return;
  const style = document.createElement('style');
  style.id = 'lock-styles';
  style.textContent = `
    .lock-box {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 170px;
      padding: 4px 2px;
      font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    .lock-head {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #475569;
    }
    .lock-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5);
      animation: lock-pulse 1.8s infinite;
    }
    @keyframes lock-pulse {
      0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.5); }
      70% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }
    .lock-count {
      min-width: 18px;
      padding: 1px 6px;
      border-radius: 999px;
      background: #e2e8f0;
      color: #334155;
      font-size: 10.5px;
      line-height: 1.5;
    }
    .lock-user {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 5px 4px 4px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 999px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
    }
    .lock-user:hover {
      border-color: #cbd5e1;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1);
    }
    .lock-avatar {
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .lock-name {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 130px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      font-size: 12.5px;
      font-weight: 500;
      color: #0f172a;
    }
    .lock-remove {
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: #94a3b8;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .lock-remove:hover {
      background: #fee2e2;
      color: #dc2626;
    }
    .lock-clear {
      align-self: center;
      padding: 3px 12px;
      border: 1px solid #fecaca;
      border-radius: 6px;
      background: #fef2f2;
      color: #dc2626;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .lock-clear:hover {
      background: #fee2e2;
      border-color: #fca5a5;
    }
  `;
  document.head.appendChild(style);
}

function lockInitials(name) {
  const skip = /^(dr|md|mr|mrs|ms|prof)\.?$/i;
  const parts = String(name).split(/\s+/).filter(p => p && !skip.test(p));
  const source = parts.length ? parts : String(name).split(/\s+/).filter(Boolean);
  const letters = source.slice(0, 2).map(p => p.charAt(0)).join('');
  return (letters || '?').toUpperCase();
}

function lockAvatarStyle(name) {
  let hash = 0;
  const text = String(name);
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360;
  }
  return `background:hsl(${hash},60%,91%);color:hsl(${hash},50%,30%);`;
}

function lockCellHtml(uid) {
  const viewers = studyLockCache[uid];
  if (!viewers || viewers.length === 0) return '';
  ensureLockStyles();

  const users = viewers.map(v => `
    <div class="lock-user">
      <span class="lock-avatar" style="${lockAvatarStyle(v.name)}">${escapeLockHtml(lockInitials(v.name))}</span>
      <span class="lock-name" title="${escapeLockHtml(v.name)}">${escapeLockHtml(v.name)}</span>
      <button class="lock-remove" title="Remove ${escapeLockHtml(v.name)}" onclick="removeStudyViewer('${uid}', ${v.user_id})">&times;</button>
    </div>`).join('');

  const clearAll = viewers.length > 1
    ? `<button class="lock-clear" onclick="removeStudyViewer('${uid}')">Remove all</button>`
    : '';

  return `<div class="lock-box">
    <div class="lock-head"><span class="lock-dot"></span>Viewing<span class="lock-count">${viewers.length}</span></div>
    ${users}
    ${clearAll}
  </div>`;
}

async function removeStudyViewer(uid, userId) {
  const all = userId === undefined || userId === null;
  const viewers = studyLockCache[uid] || [];
  const target = all ? null : viewers.find(v => v.user_id === userId);
  const message = all
    ? 'Remove all users currently viewing this study?'
    : `Remove ${target ? target.name : 'this user'} from this study?`;
  if (!confirm(message)) return;

  try {
    const body = { study_uid: uid };
    if (all) {
      body.include_self = true;
    } else {
      body.user_id = userId;
    }
    const res = await fetch(`${baseUrl}/api/viewer/kick-all/`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Removal failed');
    }
    delete studyLockCache[uid];
    await refreshLocks();
  } catch (error) {
    console.error('Error removing viewer:', error);
    alert('Error removing viewer: ' + error.message);
  }
}

async function refreshLocks() {
  const cells = document.querySelectorAll('.lock-cell');
  const uids = [...new Set(Array.from(cells).map(c => c.dataset.studyUid).filter(u => u && u !== 'undefined'))];
  if (uids.length === 0) return;

  await Promise.all(uids.map(async uid => {
    try {
      const res = await fetch(`${baseUrl}/api/viewer/check/?study_uid=${encodeURIComponent(uid)}&detailed=1`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      });
      if (!res.ok) return;
      const data = await res.json();
      studyLockCache[uid] = data.success ? (data.viewers || []) : [];
    } catch (e) {}
  }));

  document.querySelectorAll('.lock-cell').forEach(cell => {
    cell.innerHTML = lockCellHtml(cell.dataset.studyUid);
  });
}

function setDefaultDateRange() {
  const startInput = document.getElementById('scan-start-date');
  const endInput = document.getElementById('scan-end-date');
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 3);
  if (startInput && !startInput.value) startInput.value = fmt(past);
  if (endInput && !endInput.value) endInput.value = fmt(today);
}

function loadStudies() {
  const tbody = document.getElementById('study-table-body');
  if (!tbody) {
    console.error('Table body element not found');
    return;
  }
  
  tbody.innerHTML = '';
  
  const currentPatients = groupedPatients;
  
  currentPatients.forEach(patient => {
    const sortedImages = patient.images.sort((a, b) => b.dbId - a.dbId);
    
    sortedImages.forEach((s, index) => {
      const timestamp = new Date().getTime();
      const dicomFileUrl = s.dicomFile ? `${s.dicomFile}?t=${timestamp}` : '';
      const hasHistory = (s.patientHistory || '').trim() !== '' || !!s.referralFile;
      
      const imagesThumbnails = generateImageThumbnails(s);
      const doctorsList = generateDoctorsList(s);
      
      const tr = document.createElement('tr');
      if (s.locked) {
        tr.classList.add('emergency-case');
      }
      
      if (s.status === 'Reported') {
        tr.classList.add('reported-case');
      } else if (s.status === 'Not Assigned') {
        tr.classList.add('unassigned-case');
      }
      
      if (index === 0) {
        tr.classList.add('first-patient-row');
      }
      
      tr.innerHTML = `
        <td><input type="checkbox" class="row-checkbox" data-patient-pk="${s.id}" /></td>
        <td><button class="action-btn view-btn" onclick="openViewer('${dicomFileUrl}', '${s.studyUID}')" ${!dicomFileUrl ? 'disabled' : ''}><img src="images/view.png" alt="View" width="32" height="32"></button></td>
        <td><button class="action-btn" title="${hasHistory ? 'History uploaded' : 'No history'}" onclick="openHistory('${s.patientID}')">${historyIconHtml(hasHistory)}</button></td>
        <td>${s.patientName}${s.studyUID ? `<span class="series-toggle" title="Show series" data-study-uid="${s.studyUID}" data-body-part="${(s.bodyPart || '').replace(/"/g, '&quot;')}">+</span>` : ''}${waitGifHtml(s.studyUID)}</td>
        <td>${s.patientID}</td>
        <td>${s.age}</td>
        <td>${s.sex}</td>
        <td>${s.bodyPart}</td>
        <td>${s.modality}</td>
        <td>${s.institute}</td>
        <td>${s.receiveDateTime || s.scanDateTime}</td>
        <td class="refd-by-cell" data-id="${s.id}" data-value="${(s.referredBy || '').replace(/"/g, '&quot;')}"><span class="refd-by-text" style="cursor:pointer;" onclick="startEditRefBy(this)">${s.referredBy || '<em style=\'color:#bbb\'>—</em>'}</span></td>
        <td style="text-align:center;">${s.studyUID ? `<button class="action-btn zip-btn" title="Download Scan in ZIP Format" style="padding:0;background:none;border:none;cursor:pointer;" onclick="downloadStudyZip('${s.studyUID}', this)">${ZIP_ICON_SVG}</button>` : ''}</td>
        <td>
          <span class="status-badge status-${s.status.toLowerCase().replace(' ', '-')}">${s.status}</span>
        </td>
        <td style="text-align:center;"><button class="action-btn report-click-btn" title="Click for Report" style="padding:0;background:none;border:none;cursor:pointer;" onclick="clickForReport('${s.reportPdf ? s.reportPdf + '?t=' + timestamp : ''}', '${s.studyUID}', '${s.status}')">${s.status === 'Reported' ? REPORT_DONE_SVG : REPORT_PENDING_SVG}</button></td>
        <td style="text-align:center;">${s.status === 'Reported' ? `<a href="#" style="color:#0000ee;text-decoration:underline;" onclick="openReport('${s.reportPdf ? s.reportPdf + '?t=' + timestamp : ''}', '${s.studyUID}'); return false;">View</a>` : ''}</td>
        <td>${s.reportedBy}</td>
        <td title="${s.group}">${doctorsList}</td>
        <td class="lock-cell" style="text-align:center;" data-study-uid="${s.studyUID}">${lockCellHtml(s.studyUID)}</td>
      `;
      tbody.appendChild(tr);
    });
  });

  const selectAll = document.getElementById('select-all');
  if (selectAll) {
    selectAll.replaceWith(selectAll.cloneNode(true));
    const newSelectAll = document.getElementById('select-all');
    
    newSelectAll.addEventListener('change', () => {
      const checkboxes = document.querySelectorAll('.row-checkbox');
      const maxSelect = 20;
      checkboxes.forEach((cb, idx) => {
        if (idx < maxSelect) {
          cb.checked = newSelectAll.checked;
        }
      });
    });
  }
}

function addPaginationStyles() {
  const style = document.createElement('style');
  style.id = 'pagination-styles';
  style.textContent = `
    .pagination-container {
      margin-top: 20px;
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 15px 20px;
    }
    
    .pagination-wrapper {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 15px;
    }
    
    .pagination-info {
      color: #666;
      font-size: 14px;
    }
    
    .pagination-controls {
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
    }
    
    .pagination-buttons {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    
    .pagination-btn {
      padding: 8px 12px;
      border: 1px solid #ddd;
      background: white;
      color: #333;
      cursor: pointer;
      border-radius: 4px;
      font-size: 14px;
      transition: all 0.2s ease;
      min-width: 40px;
    }
    
    .pagination-btn:hover:not(:disabled) {
      background: #f5f5f5;
      border-color: #ccc;
    }
    
    .pagination-btn:disabled {
      background: #f9f9f9;
      color: #ccc;
      cursor: not-allowed;
      border-color: #eee;
    }
    
    .pagination-btn.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }
    
    .pagination-btn.active:hover {
      background: #0056b3;
      border-color: #0056b3;
    }
    
    .page-numbers {
      display: flex;
      gap: 2px;
    }
    
    .pagination-ellipsis {
      padding: 8px 4px;
      color: #999;
      font-size: 14px;
    }
    
    .img-thumbnails {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }
    
    .study-table-img {
      width: 40px;
      height: 40px;
      border-radius: 4px;
      object-fit: cover;
      border: 1px solid #ddd;
    }
    
    @media (max-width: 768px) {
      .pagination-wrapper {
        flex-direction: column;
        align-items: stretch;
        text-align: center;
      }
      
      .pagination-controls {
        justify-content: center;
        flex-wrap: wrap;
      }
      
      .pagination-buttons {
        flex-wrap: wrap;
        justify-content: center;
      }
    }
  `;
  document.head.appendChild(style);
}

document.addEventListener('DOMContentLoaded', function() {
  const modalityAll = document.getElementById('modality-all');
  if (modalityAll) {
    modalityAll.addEventListener('change', (event) => {
      const isChecked = event.target.checked;
      document.querySelectorAll('.modality-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
      });
    });
  }

  const assignBtn = document.getElementById('assign-btn');
  if (assignBtn) {
    assignBtn.addEventListener('click', assignSelectedStudies);
  }
});

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
        (group.members || []).forEach(m => { if (!doctorNames.includes(m)) doctorNames.push(m); });
      }
    } else {
      if (!doctorNames.includes(option.value)) doctorNames.push(option.value);
    }
  });

  if (doctorNames.length === 0) {
    alert('The selected group has no doctors assigned, or group data could not be loaded.');
    return;
  }


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
      document.getElementById('select-all').checked = false;
      assignSelect.selectedIndex = -1;
      
      await fetchAndLoadStudies(true);
    } else {
      alert(result.error || 'Assignment failed');
    }
    
  } catch (error) {
    console.error('Error assigning doctors:', error);
    alert('Error assigning doctors: ' + error.message);
  }
}

function refreshStudies() {
  window.location.reload();
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

  const imageMap = {};
  groupedPatients.forEach(patient => {
    patient.images.forEach(img => {
      imageMap[String(img.id)] = img;
    });
  });

  const uids = [];
  checked.forEach(cb => {
    const img = imageMap[cb.dataset.patientPk];
    if (img && img.studyUID && !uids.includes(img.studyUID)) {
      uids.push(img.studyUID);
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

async function openViewer(fileUrl, studyUID) {
  if (!fileUrl && !studyUID) {
    alert("No DICOM file available");
    return;
  }

  const screenW = screen.availWidth || window.screen.width;
  const screenH = screen.availHeight || window.screen.height;
  const fullWindowFeatures = `toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes,status=no,width=${screenW},height=${screenH},left=0,top=0`;
  let viewerWindow = null;
  
  try {
    const authHeaders = {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json'
    };
    const viewersRequest = studyUID
      ? fetch(`${baseUrl}/api/viewer/check/?study_uid=${studyUID}`, { method: 'GET', headers: authHeaders })
      : null;
    if (viewersRequest) viewersRequest.catch(() => {});

    const checkResponse = await fetch(`${baseUrl}/api/current-user/`, {
      method: 'GET',
      headers: authHeaders
    });

    if (checkResponse.ok) {
      const userData = await checkResponse.json();
      if (userData.success && userData.permissions) {
        if (!userData.permissions.can_view_images) {
          alert('You do not have permission to view images');
          return;
        }
      }
    }
    
    if (studyUID) {
      const viewerUrl = `./viewer.html?study=${studyUID}`;
      viewerWindow = window.open(viewerUrl, "_blank", fullWindowFeatures);

      const viewersResponse = await viewersRequest;
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
    td.innerHTML = `<span class="refd-by-text" style="cursor:pointer;" onclick="startEditRefBy(this)">${newValue || '<em style=\'color:#bbb\'>—</em>'}</span>`;
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      td.innerHTML = `<span class="refd-by-text" style="cursor:pointer;" onclick="startEditRefBy(this)">${currentValue || '<em style=\'color:#bbb\'>—</em>'}</span>`;
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

const ZIP_ICON_SVG = '<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg"><rect width="26" height="26" fill="#f4f4f4"/><path d="M10 3h6v7h4l-7 7-7-7h4z" fill="#111"/><path d="M3 19h20v4H3z" fill="#111"/><rect x="17" y="20" width="4" height="1.5" fill="#f4f4f4"/></svg>';
const REPORT_PENDING_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" fill="#d3d3d3"/><circle cx="12" cy="12" r="7" fill="#c00000"/><circle cx="10" cy="9.5" r="2.4" fill="#ff7a7a" opacity="0.85"/></svg>';
const HISTORY_YES_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="hyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6ff6a"/><stop offset="1" stop-color="#6fcf4c"/></linearGradient></defs><rect x="1.5" y="2.5" width="13" height="11" fill="url(#hyg)" stroke="#0a6a0a" stroke-width="1.4"/><rect x="3" y="9" width="10" height="3" fill="#5fbf4a"/><rect x="3" y="9" width="10" height="1" fill="#3f9f3a"/><rect x="4.5" y="5" width="7" height="1" fill="#c8ff9f"/></svg>';
const HISTORY_NO_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="hng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8e9fb"/><stop offset="1" stop-color="#7ea9dc"/></linearGradient></defs><path d="M2.5 1.5h8l3 3v10h-11z" fill="url(#hng)" stroke="#6c93c8" stroke-width="1"/><path d="M10.5 1.5v3h3" fill="#eef5fd" stroke="#6c93c8" stroke-width="1"/><path d="M4.5 6.5h5M4.5 8.5h4" stroke="#ffffff" stroke-width="1"/><path d="M8 14.5l1.5-3 3.5-3 1.5 1.5-3 3.5z" fill="#4a4f5a"/><path d="M12.8 8.5l1.5 1.5" stroke="#9aa0ab" stroke-width="1.2"/></svg>';

function historyIconHtml(hasHistory) {
  return hasHistory ? HISTORY_YES_SVG : HISTORY_NO_SVG;
}

const REPORT_DONE_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" fill="#d3d3d3"/><polygon points="8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8" fill="#2e9e2e" stroke="#1d6f1d" stroke-width="1"/><circle cx="12" cy="12" r="6" fill="#bfe8bf"/><path d="M8.8 12.2l2.2 2.3 4.4-4.6" fill="none" stroke="#2e9e2e" stroke-width="2"/></svg>';

async function downloadStudyZip(studyUid, btn) {
  if (!studyUid || studyUid === 'undefined') {
    alert('No scan available for download');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.4';
  }
  try {
    const res = await fetch(`${baseUrl}/api/study-zip/?study_uid=${encodeURIComponent(studyUid)}`, {
      headers: { 'Authorization': `Token ${token}` }
    });
    if (!res.ok) {
      let message = 'Download failed';
      try {
        const err = await res.json();
        message = err.error || message;
      } catch (e) {}
      throw new Error(message);
    }
    const blob = await res.blob();
    let filename = `${studyUid}.zip`;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    if (match) filename = match[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    alert('Error downloading scan: ' + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

function clickForReport(reportUrl, studyUid, status) {
  if (status !== 'Reported') {
    alert('Report is not available yet');
    return;
  }
  openReport(reportUrl, studyUid);
}

async function viewLatestReport(reportUrl, studyUid) {
  if (studyUid && studyUid !== 'undefined') {
    try {
      const res = await fetch(`${baseUrl}/api/study-reports/?study_uid=${encodeURIComponent(studyUid)}`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.reports && data.reports.length > 0) {
          const withFile = data.reports.filter(r => r.report_file);
          if (withFile.length > 0) {
            window.open(withFile[withFile.length - 1].report_file, '_blank');
            return;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
  if (reportUrl) {
    window.open(reportUrl, '_blank');
  } else {
    alert('No report available');
  }
}

async function openReport(reportUrl, studyUid) {
  if (studyUid && studyUid !== 'undefined' && studyUid !== '') {
    try {
      const res = await fetch(`${baseUrl}/api/study-reports/?study_uid=${encodeURIComponent(studyUid)}`, {
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.reports && data.reports.length > 0) {
          if (data.reports.length === 1) {
            const url = data.reports[0].report_file || reportUrl;
            if (url) window.open(url, '_blank');
          } else {
            openCombinedReportModal(data.reports);
          }
          return;
        }
      }
    } catch(e) { console.error(e); }
  }
  if (reportUrl) {
    window.open(reportUrl, "_blank");
  } else {
    alert("No report available");
  }
}

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
  modal.innerHTML = `<div style="background:#fff;border-radius:8px;padding:30px;min-width:360px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;"><strong style="font-size:17px;">Reports (${reports.length})</strong><button onclick="document.getElementById('combined-report-modal').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666;">✕</button></div>${linksHtml}</div>`;
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function openHistory(patientId) { 
  if (!patientId) return;
  const historyUrl = `./history.html?patient=${patientId}`;
  window.open(historyUrl, '_blank', 'width=950,height=900,scrollbars=yes,resizable=yes');
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('role');
  sessionStorage.removeItem('currentPage');
  window.location.href = 'login.html';
}

window.onload = async function() {
  setDefaultDateRange();

  // Show skeleton loading immediately
  showTableSkeleton();

  // Run user check and studies fetch in parallel — don't wait for one before starting the other
  const [userData] = await Promise.all([
    loadCurrentUser(),
    fetchAndLoadStudies(true),
    loadCenterOptions()
  ]);

  if (!userData) {
    return;
  }

  const displayElement = document.getElementById('user-display-name');
  if (displayElement) {
    displayElement.textContent = userData.doctor_name || userData.username || 'User';
  }

  setupOnlineDoctorButton();

  setInterval(() => {
    fetchAndLoadStudies(true);
  }, 30000);

  setInterval(refreshLocks, 10000);
};

let onlineDoctorTimer = null;

function fillOnlineDoctorPanel(headText, doctors, message) {
  const panel = document.getElementById('online-doctor-panel');
  if (!panel) return;
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'online-doctor-head';
  head.textContent = headText;
  panel.appendChild(head);

  if (message) {
    const note = document.createElement('div');
    note.className = 'online-doctor-empty';
    note.textContent = message;
    panel.appendChild(note);
    return;
  }

  doctors.forEach(d => {
    const row = document.createElement('div');
    row.className = 'online-doctor-row';
    const dot = document.createElement('span');
    dot.className = 'online-doctor-dot';
    const name = document.createElement('span');
    name.textContent = d.name;
    row.appendChild(dot);
    row.appendChild(name);
    panel.appendChild(row);
  });
}

function renderOnlineDoctors(doctors) {
  const btn = document.getElementById('online-doctor-btn');
  if (!btn) return;
  btn.textContent = `Online Doctor (${doctors.length})`;
  fillOnlineDoctorPanel(
    `Online Doctors: ${doctors.length}`,
    doctors,
    doctors.length ? '' : 'No doctor is online right now'
  );
}

async function loadOnlineDoctors() {
  try {
    const res = await fetch(`${baseUrl}/api/online-doctors/`, {
      headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      fillOnlineDoctorPanel('Online Doctors', [], `Could not load list (HTTP ${res.status})`);
      return;
    }
    const data = await res.json();
    if (data.success) {
      renderOnlineDoctors(data.doctors || []);
    } else {
      fillOnlineDoctorPanel('Online Doctors', [], data.error || 'Could not load list');
    }
  } catch (err) {
    console.error('Error loading online doctors:', err);
    fillOnlineDoctorPanel('Online Doctors', [], 'Could not load list');
  }
}

function positionOnlineDoctorPanel() {
  const btn = document.getElementById('online-doctor-btn');
  const panel = document.getElementById('online-doctor-panel');
  if (!btn || !panel) return;
  const rect = btn.getBoundingClientRect();
  const width = panel.offsetWidth || 260;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  panel.style.top = `${rect.bottom + 4}px`;
  panel.style.left = `${left}px`;
}

function setupOnlineDoctorButton() {
  const list = document.querySelector('header nav ul');
  if (!list || document.getElementById('online-doctor-btn')) return;

  if (!document.getElementById('online-doctor-styles')) {
    const style = document.createElement('style');
    style.id = 'online-doctor-styles';
    style.textContent = `
      .online-doctor-item { list-style: none; }
      .online-doctor-panel {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        min-width: 260px;
        max-height: 320px;
        overflow-y: auto;
        background: #fff;
        color: #222;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        z-index: 100000;
      }
      .online-doctor-panel.open { display: block; }
      .online-doctor-head {
        padding: 8px 12px;
        font-weight: 600;
        background: #f3f6fa;
        border-bottom: 1px solid #ddd;
      }
      .online-doctor-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-bottom: 1px solid #f0f0f0;
        font-size: 14px;
      }
      .online-doctor-row:last-child { border-bottom: none; }
      .online-doctor-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #2ecc40;
        flex: 0 0 auto;
      }
      .online-doctor-empty { padding: 12px; color: #777; font-size: 14px; }
    `;
    document.head.appendChild(style);
  }

  const item = document.createElement('li');
  item.className = 'online-doctor-item';
  item.innerHTML = '<button type="button" id="online-doctor-btn" style="background:#f5deb3;color:#000;font-weight:bold;border:1px solid #999;padding:3px 10px;cursor:pointer;">Online Doctor</button>';
  list.insertBefore(item, list.firstChild);

  const panel = document.createElement('div');
  panel.id = 'online-doctor-panel';
  panel.className = 'online-doctor-panel';
  document.body.appendChild(panel);
  fillOnlineDoctorPanel('Online Doctors', [], 'Loading...');

  const btn = document.getElementById('online-doctor-btn');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = !panel.classList.contains('open');
    if (opening) {
      panel.classList.add('open');
      positionOnlineDoctorPanel();
      loadOnlineDoctors().then(positionOnlineDoctorPanel);
    } else {
      panel.classList.remove('open');
    }
  });

  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('open');
  });

  window.addEventListener('resize', () => panel.classList.remove('open'));

  loadOnlineDoctors();
  clearInterval(onlineDoctorTimer);
  onlineDoctorTimer = setInterval(loadOnlineDoctors, 30000);
}

function showTableSkeleton() {
  const tbody = document.getElementById('study-table-body');
  if (!tbody) return;
  const skeletonRow = `
    <tr class="skeleton-row">
      ${Array(19).fill('<td><div class="skeleton-cell"></div></td>').join('')}
    </tr>`;
  tbody.innerHTML = Array(8).fill(skeletonRow).join('');

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


function formatReceiveDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
