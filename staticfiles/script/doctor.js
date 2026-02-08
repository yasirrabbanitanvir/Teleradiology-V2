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

async function checkDoctorAccess() {
  if (!token) {
    window.location.href = 'login.html';
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
      window.location.href = 'login.html';
      return false;
    }

    const data = await response.json();
    
    if (data.success) {
      if (data.role !== 'Doctor') {
        if (data.role === 'SubAdmin') {
          window.location.href = 'index.html';
        } else if (data.role === 'Center') {
          window.location.href = 'institute.html';
        } else {
          window.location.href = 'login.html';
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
    console.error('Error checking doctor access:', error);
    window.location.href = 'login.html';
    return false;
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

async function getLoggedInDoctor() {
  if (!token) {
    alert('No authentication token found. Please login again.');
    logout();
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success) {
      return data.doctor_name || data.full_name || data.username;
    } else {
      throw new Error(data.error || 'Failed to get doctor name from response');
    }
  } catch (error) {
    console.error('Error fetching current user:', error);
    return null;
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
      
      await fetchAssignedStudies(loggedInDoctorName, currentPage, true);
    } else {
      throw new Error(result.error || 'Assignment failed');
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
      }
    }
  } catch (err) {
    console.error('Error loading doctors:', err);
  }
}

async function fetchAssignedStudies(doctorName, page = 1, maintainPage = false) {
  try {
    const res = await fetch(`${baseUrl}/api/dicom-images/by_doctor/?doctor_name=${encodeURIComponent(doctorName)}&page=${page}`, {
      headers: { 'Authorization': `Token ${token}` }
    });
    
    if (!res.ok) throw new Error('Failed to fetch assigned studies');
    
    const responseData = await res.json();
    
    if (responseData.success) {
      const images = responseData.images || [];
      
      const processedImages = images.map(dicom => {
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
          uploads: [{
            id: dicom.id,
            status: dicom.status || 'Unreported',
            dicom_file: dicom.file_path ? `${baseUrl}/media/${dicom.file_path}` : null,
            report_pdf: reportUrl
          }]
        };
      });
      
      const patientMap = {};
      processedImages.forEach(img => {
        const patientKey = img.patient_id || 'Unknown';
        if (!patientMap[patientKey]) {
          patientMap[patientKey] = img;
        } else {
          if (img.dbId > patientMap[patientKey].dbId) {
            patientMap[patientKey] = img;
          }
        }
      });
      
      allPatients = Object.values(patientMap).sort((a, b) => b.dbId - a.dbId);
      
      searchPatients(maintainPage);
      populateCenterDropdown();
    } else {
      throw new Error(responseData.error || 'Failed to fetch assigned studies');
    }
  } catch (err) {
    console.error('Error fetching assigned studies:', err);
    alert('Error fetching assigned studies: ' + err.message);
    allPatients = [];
    filteredPatients = [];
    document.getElementById('patient-list').style.display = 'none';
  }
}

function populateCenterDropdown() {
  const centerSelect = document.getElementById('center');
  if (!centerSelect) return;
  
  const currentValue = centerSelect.value;
  
  const allOption = centerSelect.querySelector('option[value="ALL"]');
  centerSelect.innerHTML = '';
  
  if (allOption) {
    centerSelect.appendChild(allOption);
  } else {
    const newAllOption = document.createElement('option');
    newAllOption.value = 'ALL';
    newAllOption.textContent = 'All Centers';
    centerSelect.appendChild(newAllOption);
  }
  
  const instituteMap = new Map();
  
  allPatients.forEach(p => {
    const institute = p.institute_name;
    const center = p.center;
    
    if (institute && !instituteMap.has(institute)) {
      instituteMap.set(institute, new Set());
    }
    
    if (institute && center) {
      instituteMap.get(institute).add(center);
    }
  });

  const sortedInstitutes = Array.from(instituteMap.keys()).sort();
  
  sortedInstitutes.forEach(institute => {
    const option = document.createElement('option');
    option.value = Array.from(instituteMap.get(institute))[0];
    option.textContent = institute;
    centerSelect.appendChild(option);
  });
  
  if (currentValue && Array.from(centerSelect.options).some(opt => opt.value === currentValue)) {
    centerSelect.value = currentValue;
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

function searchPatients(maintainPage = false) {
  const nameQ = document.getElementById('patient-name').value.toLowerCase();
  const idQ = document.getElementById('patient-id').value.toLowerCase();
  const statusQ = document.getElementById('status').value;
  const centerQ = document.getElementById('center').value;
  const emergencyFilter = document.getElementById('emergency').checked;
  const selectedModalities = Array.from(document.querySelectorAll('.modality-checkbox:checked')).map(cb => cb.value);
  
  const startDate = document.getElementById('scan-start-date').value;
  const endDate = document.getElementById('scan-end-date').value;

  filteredPatients = allPatients.filter(p => {
    if (emergencyFilter && !p.locked) return false;
    if (statusQ !== 'All' && p.status !== statusQ) return false;
    
    if (centerQ !== 'ALL') {
      if (p.center !== centerQ && p.institute_name !== centerQ) return false;
    }
    
    if (nameQ && !p.name.toLowerCase().includes(nameQ)) return false;
    if (idQ && !p.patient_id.toLowerCase().includes(idQ)) return false;
    if (selectedModalities.length > 0 && !selectedModalities.includes(p.modality)) return false;
    
    if (startDate || endDate) {
      const scanDate = new Date(p.scan_datetime);
      if (startDate && scanDate < new Date(startDate)) return false;
      if (endDate && scanDate > new Date(endDate + ' 23:59:59')) return false;
    }
    
    return true;
  });

  totalCount = filteredPatients.length;
  totalPages = Math.ceil(totalCount / itemsPerPage);
  
  if (!maintainPage) {
    currentPage = 1;
    sessionStorage.setItem('doctorCurrentPage', currentPage);
  }
  
  if (currentPage > totalPages && totalPages > 0) {
    currentPage = totalPages;
    sessionStorage.setItem('doctorCurrentPage', currentPage);
  }
  if (currentPage < 1) {
    currentPage = 1;
    sessionStorage.setItem('doctorCurrentPage', currentPage);
  }
  
  if (totalCount === 0 && document.getElementById('status') && document.getElementById('status').value === 'Unreported') {
    showNoReportsMessage('No more unreported studies for today.');
  } else {
    hideNoReportsMessage();
  }

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
      const doctorName = document.getElementById('doctor-name').value || loggedInDoctorName;
      if (doctorName) {
        await fetchAssignedStudies(doctorName, currentPage, true);
      }
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
  
  if (!tableHead.querySelector('th:last-child')?.textContent.includes('Assigned To')) {
    const assignedTh = document.createElement('th');
    assignedTh.textContent = 'Assigned To';
    tableHead.appendChild(assignedTh);
  }
  
  patientTableBody.innerHTML = '';
  
  data.forEach((p, index) => {
    const tr = document.createElement('tr');
    if (p.locked) tr.classList.add('emergency-case');
    
    const status = p.status;
    const timestamp = new Date().getTime();
    const dicomUrl = p.uploads[0]?.dicom_file ? `${p.uploads[0].dicom_file}?t=${timestamp}` : '';
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
      <td>${p.name}</td>
      <td>${p.patient_id}</td>
      <td>${p.age}</td>
      <td>${p.sex}</td>
      <td>${p.body_part}</td>
      <td>${p.modality}</td>
      <td>${p.center}</td>
      <td>${p.institute_name}</td>
      <td>${p.scan_datetime}</td>
      <td>
        <select class="status-select" data-id="${p.id}" data-upload-id="${p.uploads[0]?.id || ''}" disabled style="background-color: ${status === 'Reported' ? '#d4edda' : status === 'Reviewed' ? '#fff3cd' : status === 'Draft' ? '#d1ecf1' : '#f8d7da'}; cursor: not-allowed;">
          <option value="Unreported" ${status === 'Unreported' ? 'selected' : ''}>Unreported</option>
          <option value="Draft" ${status === 'Draft' ? 'selected' : ''}>Draft</option>
          <option value="Reviewed" ${status === 'Reviewed' ? 'selected' : ''}>Reviewed</option>
          <option value="Reported" ${status === 'Reported' ? 'selected' : ''}>Reported</option>
        </select>
      </td>
      <td>
        ${hasReport ? `<button class="action-btn preview-btn" data-report-url="${p.report_url}">📄 Preview</button>` : `<span style="color: #999;">No Report</span>`}
      </td>
      <td>${doctorsList}</td>
    `;
    
    tr.innerHTML = rowHTML;
    patientTableBody.appendChild(tr);
  });
  
  if (data.length === 0) {
    patientListDiv.style.display = 'block';
    const table = patientListDiv.querySelector('table');
    if (table) table.style.display = 'table';
  } else {
    patientListDiv.style.display = 'block';
  }

  document.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const reportUrl = this.dataset.reportUrl;
      if (reportUrl) {
        window.open(reportUrl, '_blank');
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
    
    const patientList = document.getElementById('patient-list');
    if (patientList) {
      patientList.appendChild(paginationContainer);
    }
  }
  
  if (totalCount === 0) {
    paginationContainer.style.display = 'none';
    if (document.getElementById('status') && document.getElementById('status').value === 'Unreported') {
      showNoReportsMessage('No more unreported studies for today.');
    } else {
      hideNoReportsMessage();
    }
    return;
  }
  
  paginationContainer.style.display = 'block';
  hideNoReportsMessage();
  
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
  sessionStorage.setItem('doctorCurrentPage', currentPage);
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
    
    if (patientId) {
      sessionStorage.setItem('currentPatientId', patientId);
    }
    
    if (studyUID && studyUID !== '' && studyUID !== 'undefined') {
      const viewerUrl = `./viewer.html?study=${studyUID}`;
      window.open(viewerUrl, "_blank", fullWindowFeatures);
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
    console.error('Error opening DICOM viewer:', error);
    alert("Error opening DICOM viewer. Please check the file path.");
  }
}

function startAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  autoRefreshInterval = setInterval(async () => {
    const doctorName = document.getElementById('doctor-name').value;
    if (doctorName) {
      const savedPage = parseInt(sessionStorage.getItem('doctorCurrentPage')) || currentPage;
      await fetchAssignedStudies(doctorName, savedPage, true);
    }
  }, 5000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

window.addEventListener('focus', async () => {
  const doctorName = document.getElementById('doctor-name').value;
  if (doctorName) {
    const savedPage = parseInt(sessionStorage.getItem('doctorCurrentPage')) || currentPage;
    await fetchAssignedStudies(doctorName, savedPage, true);
  }
});

window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});

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
  const hasAccess = await checkDoctorAccess();
  
  if (!hasAccess) {
    return;
  }
  
  if (!token) {
    alert('Please login first');
    window.location.href = 'login.html';
    return;
  }
  
  const savedPage = parseInt(sessionStorage.getItem('doctorCurrentPage'));
  if (savedPage) {
    currentPage = savedPage;
  }
  
  const assignBtn = document.getElementById('assign-btn');
  if (assignBtn) {
    assignBtn.addEventListener('click', assignSelectedStudies);
  }
  
  try {
    loggedInDoctorName = await getLoggedInDoctor();
    
    if (loggedInDoctorName) {
      document.getElementById('doctor-display-name').textContent = loggedInDoctorName;
      
      const dropdown = document.getElementById('doctor-name');
      if (dropdown) {
        dropdown.value = loggedInDoctorName;
      }
      
      updateUIBasedOnPermissions();
      
      await fetchAssignedStudies(loggedInDoctorName, currentPage, true);
    } else {
      document.getElementById('doctor-display-name').textContent = 'Error loading name';
    }
  } catch (error) {
    console.error('Error during initialization:', error);
    document.getElementById('doctor-display-name').textContent = 'Error: ' + error.message;
  }
});

window.addEventListener('message', async (e) => {
  try {
    if (e.origin !== window.location.origin) return;
    const data = e.data || {};
    if (data.type === 'refreshDoctor' || data.type === 'reportSaved') {
      if (data.dicomImageId || data.studyUID) {
        const idToRemove = data.dicomImageId || data.studyUID;
        allPatients = allPatients.filter(p => String(p.id) !== String(idToRemove) && String(p.studyUID) !== String(idToRemove));
        filteredPatients = filteredPatients.filter(p => String(p.id) !== String(idToRemove) && String(p.studyUID) !== String(idToRemove));
      }
      const doctorName = document.getElementById('doctor-name')?.value || loggedInDoctorName;
      if (doctorName) {
        await fetchAssignedStudies(doctorName, currentPage, true);
        searchPatients(true);
      } else {
        searchPatients(true);
      }
    }
  } catch (err) {
    console.error(err);
  }
});