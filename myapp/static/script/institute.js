const baseUrl = window.location.origin;
let allPatients = [];
let filteredPatients = []; 
let token = sessionStorage.getItem('token') || localStorage.getItem('token');
let currentPage = parseInt(sessionStorage.getItem('instituteCurrentPage')) || 1;
let itemsPerPage = 10;
let totalPages = 1;
let totalCount = 0;
let instituteName = '';
let centersInInstitute = [];
let userPermissions = {
  can_assign_doctors: false,
  can_write_reports: false,
  can_manage_templates: false
};

async function checkCenterAccess() {
  if (!token) {
    window.location.href = '/static/login.html';
    return false;
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
      window.location.href = '/static/login.html';
      return false;
    }

    const data = await response.json();
    
    if (data.success) {
      if (data.role !== 'Center') {
        if (data.role === 'Doctor') {
          window.location.href = '/static/doctor.html';
        } else if (data.role === 'SubAdmin') {
          window.location.href = '/static/index.html';
        } else {
          window.location.href = '/static/login.html';
        }
        return false;
      }
      
      if (data.permissions) {
        userPermissions = data.permissions;
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking center access:', error);
    window.location.href = '/static/login.html';
    return false;
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
      }
    }
  } catch (err) {
    console.error('Error loading doctors:', err);
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
  const doctorNames = Array.from(assignSelect.selectedOptions).map(option => option.value);
  
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
      
      await fetchInstituteStudies(currentPage, true);
    } else {
      throw new Error(result.error || 'Assignment failed');
    }
    
  } catch (error) {
    console.error('Error assigning doctors:', error);
    alert('Error assigning doctors: ' + error.message);
  }
}

async function getInstituteInfo() {
  if (!token) {
    alert('No authentication token found. Please login again.');
    logout();
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/api/institute-info/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
  
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      instituteName = data.institute_name || '';
      centersInInstitute = data.centers || [];
      
      if (!instituteName) {
        alert('Error: Institution name not found. Please contact administrator.');
        return null;
      }
      
      return {
        instituteName: instituteName,
        centers: centersInInstitute,
        centerCount: data.center_count,
        username: data.username
      };
    } else {
      throw new Error(data.error || 'Failed to get institute info from response');
    }
  } catch (error) {
    alert('Failed to load institute information: ' + error.message);
    return null;
  }
}

async function fetchInstituteStudies(page = 1, maintainPage = false) {
  try {
    if (!instituteName) {
      return;
    }
    
    const selectedCenter = document.getElementById('center-filter')?.value || '';
    let url = `${baseUrl}/api/institute-studies/?page=${page}&page_size=1000`;
    
    if (selectedCenter && selectedCenter !== 'All') {
      url += `&center_name=${encodeURIComponent(selectedCenter)}`;
    }
    
    const res = await fetch(url, {
      headers: { 
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) throw new Error('Failed to fetch institute studies');
    
    const responseData = await res.json();
    
    if (!responseData.success) {
      throw new Error(responseData.error || 'Failed to fetch studies');
    }
    
    const images = responseData.results || [];
    
    allPatients = images.map(dicom => {
      let age = 0;
      if (dicom.patient_birth_date) {
        const birthDate = new Date(dicom.patient_birth_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
        const today = new Date();
        age = today.getFullYear() - birthDate.getFullYear();
      }

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
      let reportUrl = null;
      if (reportFile) {
        if (reportFile.startsWith('http')) {
          reportUrl = reportFile;
        } else if (reportFile.startsWith('/media/')) {
          reportUrl = `${baseUrl}${reportFile}`;
        } else if (reportFile.startsWith('media/')) {
          reportUrl = `${baseUrl}/${reportFile}`;
        } else {
          reportUrl = `${baseUrl}/media/${reportFile}`;
        }
      }

      return {
        id: dicom.id,
        name: dicom.patient_name || 'Unknown',
        patient_id: dicom.patient_id || '',
        age: age,
        sex: dicom.patient_sex || '',
        body_part: dicom.study_description || dicom.series_description || '',
        modality: dicom.modality || '',
        center: dicom.center_name || 'Default',
        institute_name: dicom.institute_name || instituteName || 'Unknown',
        scan_datetime: scanDateTime,
        status: dicom.status || 'Not Assigned',
        locked: dicom.is_emergency || false,
        dicom_file_path: dicom.file_path,
        reported_by: dicom.reported_by || '',
        assigned_doctors: dicom.assigned_doctors || '',
        studyUID: dicom.study_instance_uid || dicom.study_uid || dicom.StudyInstanceUID || '',
        report_file: reportFile,
        report_url: reportUrl,
        images: dicom.images || dicom.image_urls || [],
        thumbnailUrl: dicom.thumbnail_url || '',
        uploads: [{
          id: dicom.id,
          status: dicom.status || 'Not Assigned',
          dicom_file: dicom.file_path ? `${baseUrl}/media/${dicom.file_path}` : null,
          report_pdf: reportUrl
        }]
      };
    });
    
    searchPatients(maintainPage);
    
  } catch (err) {
    alert('Error fetching institute studies: ' + err.message);
    allPatients = [];
    filteredPatients = [];
    const studyList = document.querySelector('.study-list');
    if (studyList) studyList.style.display = 'none';
  }
}

function populateCenterFilter() {
  const centerFilter = document.getElementById('center-filter');
  if (!centerFilter) return;
  
  centerFilter.innerHTML = '<option value="All">All Centers</option>';
  
  centersInInstitute.forEach(center => {
    const option = document.createElement('option');
    option.value = center.name;
    option.textContent = center.name;
    centerFilter.appendChild(option);
  });
}

function searchPatients(maintainPage = false) {
  const nameQ = document.getElementById('patient-name').value.toLowerCase();
  const idQ = document.getElementById('patient-id').value.toLowerCase();
  const statusQ = document.getElementById('status').value;
  const emergencyFilter = document.getElementById('emergency').checked;
  const selectedModalities = Array.from(document.querySelectorAll('.modality-checkbox:checked')).map(cb => cb.value);
  const centerFilter = document.getElementById('center-filter')?.value || 'All';
  
  const startDate = document.getElementById('scan-start-date').value;
  const endDate = document.getElementById('scan-end-date').value;

  let filtered = allPatients.filter(p => {
    if (emergencyFilter && !p.locked) return false;
    if (statusQ !== 'All' && p.status !== statusQ) return false;
    if (nameQ && !p.name.toLowerCase().includes(nameQ)) return false;
    if (idQ && !p.patient_id.toLowerCase().includes(idQ)) return false;
    if (selectedModalities.length > 0 && !selectedModalities.includes(p.modality)) return false;
    if (centerFilter !== 'All' && p.center !== centerFilter) return false;
    
    if (startDate || endDate) {
      const scanDate = new Date(p.scan_datetime);
      if (startDate && scanDate < new Date(startDate)) return false;
      if (endDate && scanDate > new Date(endDate + ' 23:59:59')) return false;
    }
    
    return true;
  });

  const groupedAll = {};
  filtered.forEach(study => {
    const patientId = study.patient_id || 'Unknown';
    if (!groupedAll[patientId]) {
      groupedAll[patientId] = {
        patientID: patientId,
        maxId: study.id,
        images: []
      };
    }
    groupedAll[patientId].images.push(study);
    if (study.id > groupedAll[patientId].maxId) {
      groupedAll[patientId].maxId = study.id;
    }
  });
  
  const sortedPatients = Object.values(groupedAll).sort((a, b) => b.maxId - a.maxId);
  
  totalCount = sortedPatients.length;
  totalPages = Math.ceil(totalCount / itemsPerPage);
  
  if (!maintainPage) {
    currentPage = 1;
    sessionStorage.setItem('instituteCurrentPage', currentPage);
  }
  
  if (currentPage > totalPages && totalPages > 0) {
    currentPage = totalPages;
    sessionStorage.setItem('instituteCurrentPage', currentPage);
  }
  if (currentPage < 1) {
    currentPage = 1;
    sessionStorage.setItem('instituteCurrentPage', currentPage);
  }
  
  filteredPatients = sortedPatients;
  
  loadCurrentPage();
  createPaginationControls();
}

function loadCurrentPage() {
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const patientsToShow = filteredPatients.slice(startIndex, endIndex);
  
  loadPatients(patientsToShow);
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
  const assignedDoctorsString = study.assigned_doctors || '';
  
  let doctorsList = [];
  
  if (assignedDoctorsString) {
    doctorsList = assignedDoctorsString.split(',').map(d => d.trim()).filter(d => d);
  }
  
  if (doctorsList.length === 0) {
    return '—';
  }
  
  if (canRemove) {
    return doctorsList.map(doctor => {
      return `<div style="display: flex; justify-content: space-between; align-items: center; margin: 3px 0; padding: 3px 5px; background: #f0f0f0; border-radius: 3px;">
        <span>${doctor}</span>
        <button onclick="removeSingleDoctor(${study.id}, '${doctor}')" style="background: #ff4444; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 12px; margin-left: 5px;">×</button>
      </div>`;
    }).join('');
  } else {
    return doctorsList.map(doctor => {
      return `<div style="margin: 3px 0; padding: 3px 5px; background: #f0f0f0; border-radius: 3px;">
        <span>${doctor}</span>
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
      await fetchInstituteStudies(currentPage, true);
    } else {
      throw new Error(result.error || 'Removal failed');
    }
    
  } catch (error) {
    console.error('Error removing doctor:', error);
    alert('Error removing doctor: ' + error.message);
  }
}

function loadPatients(data) {
  const studyTableBody = document.getElementById('study-table-body');
  const tableHead = document.querySelector('.study-list table thead tr');
  
  if (!studyTableBody) {
    return;
  }
  
  if (userPermissions.can_assign_doctors) {
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
  } else {
    const firstTh = tableHead.querySelector('th:first-child');
    if (firstTh && firstTh.querySelector('input[type="checkbox"]')) {
      firstTh.remove();
    }
  }
  
  studyTableBody.innerHTML = '';
  
  data.forEach((groupedPatient, index) => {
    const p = groupedPatient.images.find(img => img.id === groupedPatient.maxId) || groupedPatient.images[0];
    
    const tr = document.createElement('tr');
    if (p.locked) tr.classList.add('emergency-case');
    
    const status = p.status;
    const timestamp = new Date().getTime();
    const dicomUrl = p.uploads && p.uploads[0]?.dicom_file ? `${p.uploads[0].dicom_file}?t=${timestamp}` : '';
    const studyUID = p.studyUID || '';
    const hasReport = p.report_url ? true : false;
    
    const imagesThumbnails = generateImageThumbnails(p);
    const doctorsList = generateDoctorsList(p, userPermissions.can_assign_doctors);

    let rowHTML = '';
    
    if (userPermissions.can_assign_doctors) {
      rowHTML += `<td><input type="checkbox" class="row-checkbox" data-patient-pk="${p.id}" /></td>`;
    }
    
    rowHTML += `
      <td>
        <button class="action-btn view-btn" data-dicom-url="${dicomUrl}" data-study-uid="${studyUID}" data-patient-id="${p.id}"><img src="images/view.png" alt="View" width="32" height="32"></button>
      </td>
      <td>
        ${hasReport ? `<button class="action-btn preview-btn" data-report-url="${p.report_url}">Download</button>` : `<span style="color: #999;">No Report</span>`}
      </td>
      <td>—</td>
      <td>${p.name}</td>
      <td>${p.patient_id}</td>
      <td>${p.age}</td>
      <td>${p.sex}</td>
      <td>${p.body_part}</td>
      <td>${p.modality}</td>
      <td>${p.center}</td>
      <td>${p.scan_datetime}</td>
      <td>
        <span class="status-badge status-${status.toLowerCase().replace(' ', '-')}">${status}</span>
      </td>
      <td>${doctorsList}</td>
    `;
    
    tr.innerHTML = rowHTML;
    studyTableBody.appendChild(tr);
  });
  
  const studyList = document.querySelector('.study-list');
  if (studyList) studyList.style.display = 'block';
  
  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const reportUrl = this.dataset.reportUrl;
      if (reportUrl) {
        const link = document.createElement('a');
        link.href = reportUrl;
        link.download = reportUrl.split('/').pop();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    });
  });
  
  document.querySelectorAll('.view-btn').forEach(btn => {
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
    
    const studyList = document.querySelector('.study-list');
    if (studyList) {
      studyList.parentNode.insertBefore(paginationContainer, studyList.nextSibling);
    }
  }
  
  if (totalCount === 0) {
    paginationContainer.style.display = 'none';
    return;
  }
  
  paginationContainer.style.display = 'block';
  
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
    infoElement.textContent = 'No patients to show';
  } else {
    infoElement.textContent = `Showing ${startPatient}-${endPatient} of ${totalCount} patients`;
  }
}

function goToPage(page) {
  if (page < 1 || page > totalPages || page === currentPage) return;
  
  currentPage = page;
  sessionStorage.setItem('instituteCurrentPage', currentPage);
  loadCurrentPage();
  createPaginationControls();
}

function openViewer(fileUrl, studyUID, patientId) {
  if (!fileUrl && !studyUID) {
    alert("No DICOM file available");
    return;
  }
  
  if (!userPermissions.can_view_images) {
    alert('You do not have permission to view images');
    return;
  }
  
  try {
    const screenW = screen.availWidth || window.screen.width;
    const screenH = screen.availHeight || window.screen.height;
    const fullWindowFeatures = `toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes,status=no,width=${screenW},height=${screenH},left=0,top=0`;
    
    if (studyUID && studyUID !== '' && studyUID !== 'undefined') {
      const viewerUrl = `./viewer.html?study=${studyUID}`;
      window.open(viewerUrl, "_blank", fullWindowFeatures);
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
    } else {
      alert("No valid DICOM file or study UID found");
    }
    
  } catch (error) {
    console.error('Error opening DICOM viewer:', error);
    alert("Error opening DICOM viewer. Please check the file path.");
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('center_name');
  localStorage.removeItem('institute_name');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('role');
  sessionStorage.removeItem('instituteCurrentPage');
  window.location.href = '/static/login.html';
}

function searchStudies() {
  fetchInstituteStudies(1, false);
}

document.getElementById('modality-all')?.addEventListener('change', (event) => {
  const isChecked = event.target.checked;
  document.querySelectorAll('.modality-checkbox').forEach(checkbox => {
    checkbox.checked = isChecked;
  });
});

document.getElementById('center-filter')?.addEventListener('change', () => {
  fetchInstituteStudies(1, false);
});

window.addEventListener('DOMContentLoaded', async () => {
  const hasAccess = await checkCenterAccess();
  
  if (!hasAccess) {
    return;
  }
  
  if (!token) {
    alert('Please login first');
    window.location.href = '/static/login.html';
    return;
  }
  
  const savedPage = parseInt(sessionStorage.getItem('instituteCurrentPage'));
  if (savedPage) {
    currentPage = savedPage;
  }
  
  try {
    const instituteInfo = await getInstituteInfo();
    
    if (instituteInfo) {
      instituteName = instituteInfo.instituteName;
      centersInInstitute = instituteInfo.centers;
      
      document.getElementById('institute-display-name').textContent = instituteName;
      document.getElementById('center-count-display').textContent = `${instituteInfo.centerCount} Centers`;
      
      populateCenterFilter();
      
      updateUIBasedOnPermissions();
      
      const assignBtn = document.getElementById('assign-btn');
      if (assignBtn) {
        assignBtn.addEventListener('click', assignSelectedStudies);
      }
      
      await fetchInstituteStudies(currentPage, true);
      
      setInterval(() => {
        fetchInstituteStudies(currentPage, true);
      }, 3000);
    } else {
      document.getElementById('institute-display-name').textContent = 'Error: Institute not found';
      alert('Failed to load institute information. Please contact administrator.');
    }
  } catch (error) {
    document.getElementById('institute-display-name').textContent = 'Error: ' + error.message;
    alert('Initialization error: ' + error.message);
  }
});