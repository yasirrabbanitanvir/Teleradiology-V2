const baseUrl = window.location.origin;
let token = localStorage.getItem('token');
let selectedFiles = [];

function isDicomFile(filename) {
  return filename.toLowerCase().endsWith('.dcm');
}

function hasDicomFiles() {
  return selectedFiles.some(file => isDicomFile(file.name));
}

function goBack() {
  window.location.href = '/static/institute.html';
}

async function fetchUserContactNumber() {
  if (!token) {
    return 'N/A';
  }
  
  try {
    const res = await fetch(`${baseUrl}/api/user-contact-number/`, {
      headers: { 
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      return data.contact_number || 'N/A';
    }
    return 'N/A';
  } catch (err) {
    console.error('Error fetching user contact number:', err);
    return 'N/A';
  }
}

async function loadPatients() {
  if (!token) {
    alert('Please log in first');
    window.location.href = 'login.html';
    return;
  }
  
  try {
    const res = await fetch(`${baseUrl}/api/dicom-images/?page_size=1000`, {
      headers: { 
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const data = await res.json();
    const images = data.results || [];
    
    const patientsMap = new Map();
    
    images.forEach(img => {
      if (img.patient_id && !patientsMap.has(img.patient_id)) {
        patientsMap.set(img.patient_id, {
          patient_id: img.patient_id,
          name: img.patient_name || 'Unknown',
          patient_sex: img.patient_sex || '',
          patient_birth_date: img.patient_birth_date || '',
          study_instance_uid: img.study_instance_uid || '',
          series_instance_uid: img.series_instance_uid || ''
        });
      }
    });
    
    const patientSelect = document.getElementById('patientSelect');
    if (patientSelect) {
      patientSelect.innerHTML = '<option value="">-- Add New Patient --</option>';
      
      patientsMap.forEach(patient => {
        const option = document.createElement('option');
        option.value = patient.patient_id;
        option.textContent = `${patient.name} (ID: ${patient.patient_id})`;
        option.dataset.studyUid = patient.study_instance_uid;
        option.dataset.seriesUid = patient.series_instance_uid;
        patientSelect.appendChild(option);
      });
    }
    
  } catch (err) {
    console.error('Error loading patients:', err);
  }
}

function updateFileList() {
  const fileListEl = document.getElementById('fileList');
  
  if (selectedFiles.length === 0) {
    fileListEl.innerHTML = '';
    return;
  }
  
  fileListEl.innerHTML = selectedFiles.map((file, index) => {
    const isDcm = isDicomFile(file.name);
    const fileType = isDcm ? '(DICOM)' : '(Image)';
    return `
      <div class="file-row">
        <span>${file.name} ${fileType} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        <button type="button" onclick="removeFile(${index})">Remove</button>
      </div>
    `;
  }).join('');
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  updateFileList();
}

function showMessage(text, type) {
  const msgEl = document.getElementById('message');
  msgEl.textContent = text;
  msgEl.className = `alert ${type} show`;
}

function hideMessage() {
  const msgEl = document.getElementById('message');
  msgEl.className = 'alert';
}

function handleKeyPress(e) {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    
    const formElements = [
      'patientName',
      'patientId',
      'patientAge',
      'sexMale',
      'patientHistory',
      'mobileNumber',
      'refPhysician',
      'modality',
      'studyDesc'
    ];
    
    const currentId = e.target.id;
    const currentIndex = formElements.indexOf(currentId);
    
    if (currentIndex !== -1 && currentIndex < formElements.length - 1) {
      const nextElement = document.getElementById(formElements[currentIndex + 1]);
      if (nextElement) {
        nextElement.focus();
      }
    } else if (currentIndex === formElements.length - 1 && e.key === 'Enter') {
      document.getElementById('submitBtn').click();
    }
  }
}

function getSelectedSex() {
  const sexRadios = document.getElementsByName('patientSex');
  for (const radio of sexRadios) {
    if (radio.checked) {
      return radio.value;
    }
  }
  return 'O';
}

document.getElementById('fileInput').addEventListener('change', (e) => {
  const newFiles = Array.from(e.target.files);
  
  if (newFiles.length === 0) {
    return;
  }
  
  selectedFiles = [...selectedFiles, ...newFiles];
  updateFileList();
  
  e.target.value = '';
});

document.getElementById('uploadForm').addEventListener('submit', async e => {
  e.preventDefault();
  
  const submitButton = document.getElementById('submitBtn');
  const patientSelect = document.getElementById('patientSelect');
  const patientId = patientSelect ? patientSelect.value : '';
  const centerName = document.getElementById('centerName').value.trim();
  const isEmergency = document.getElementById('emergency').checked;
  
  const patientName = document.getElementById('patientName').value.trim();
  const patientHistory = document.getElementById('patientHistory').value.trim();
  const mobileNumber = document.getElementById('mobileNumber').value.trim();
  
  const patientIdInput = document.getElementById('patientId').value.trim() || 'N/A';
  const patientAge = document.getElementById('patientAge').value.trim() || 'N/A';
  const patientGender = getSelectedSex();
  const refPhysician = document.getElementById('refPhysician').value.trim() || 'N/A';
  const examDate = document.getElementById('examDate').value;
  const examTime = document.getElementById('examTime').value;
  const modality = document.getElementById('modality').value.trim() || 'CR';
  const studyDesc = document.getElementById('studyDesc').value.trim() || 'N/A';

  const containsDicom = hasDicomFiles();
  
  if (!containsDicom) {
    if (!patientName) {
      showMessage('Patient Name is required for image files.', 'error');
      return;
    }
    
    if (!mobileNumber) {
      showMessage('Mobile Number is required for image files.', 'error');
      return;
    }
  }

  if (selectedFiles.length === 0) {
    showMessage('Please select at least one file.', 'error');
    return;
  }

  if (!centerName) {
    showMessage('Center name is required.', 'error');
    return;
  }

  const timestamp = Date.now();
  let batchStudyUID, batchSeriesUID;
  
  if (patientId && patientSelect && patientSelect.selectedIndex > 0) {
    const selectedOption = patientSelect.options[patientSelect.selectedIndex];
    batchStudyUID = selectedOption.dataset.studyUid || `1.2.840.${timestamp}.${Math.floor(Math.random() * 100000)}`;
    batchSeriesUID = selectedOption.dataset.seriesUid || `1.2.840.${timestamp}.${Math.floor(Math.random() * 100000)}.1`;
  } else {
    batchStudyUID = `1.2.840.${timestamp}.${Math.floor(Math.random() * 100000)}`;
    batchSeriesUID = `1.2.840.${timestamp}.${Math.floor(Math.random() * 100000)}.1`;
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = 'Uploading...';
    
    showMessage(`Uploading ${selectedFiles.length} file(s)...`, 'info');

    let successCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;
    const failedFiles = [];
    const duplicateFiles = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const uploadData = new FormData();
      const isCurrentFileDicom = isDicomFile(file.name);
      
      uploadData.append('dicom_file', file);
      uploadData.append('center_name', centerName);
      
      if (!isCurrentFileDicom) {
        uploadData.append('study_instance_uid', batchStudyUID);
        uploadData.append('series_instance_uid', batchSeriesUID);
        uploadData.append('instance_number', (i + 1).toString());
        
        if (patientId) {
          uploadData.append('patient_id', patientId);
        }
        
        uploadData.append('patient_name', patientName);
        uploadData.append('patient_history', patientHistory);
        uploadData.append('mobile_number', mobileNumber);
        
        uploadData.append('patient_id', patientIdInput);
        uploadData.append('patient_age', patientAge);
        uploadData.append('patient_sex', patientGender);
        uploadData.append('referring_physician', refPhysician);
        uploadData.append('modality', modality);
        uploadData.append('study_description', studyDesc);
        
        if (examDate) {
          const dateFormatted = examDate.replace(/-/g, '');
          uploadData.append('study_date', dateFormatted);
        } else {
          const today = new Date();
          const dateFormatted = today.toISOString().split('T')[0].replace(/-/g, '');
          uploadData.append('study_date', dateFormatted);
        }
        
        if (examTime) {
          const timeFormatted = examTime.replace(/:/g, '');
          uploadData.append('study_time', timeFormatted);
        } else {
          const now = new Date();
          const timeFormatted = now.toTimeString().slice(0, 5).replace(/:/g, '');
          uploadData.append('study_time', timeFormatted);
        }
      }
      
      if (isEmergency) {
        uploadData.append('is_emergency', 'true');
      }

      try {
        const uploadRes = await fetch(`${baseUrl}/api/dicom/receive/`, {
          method: 'POST',
          headers: { 
            'Authorization': `Token ${token}`
          },
          body: uploadData
        });

        const uploadResult = await uploadRes.json();
        
        if (uploadRes.ok && uploadResult.success) {
          successCount++;
        } else if (uploadRes.status === 409 && uploadResult.duplicate) {
          duplicateCount++;
          duplicateFiles.push(file.name);
        } else {
          failedCount++;
          failedFiles.push(file.name);
        }
        
        showMessage(`Uploading: ${i + 1}/${selectedFiles.length} (${successCount} succeeded, ${duplicateCount} duplicates, ${failedCount} failed)`, 'info');
        
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
        failedCount++;
        failedFiles.push(file.name);
      }
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Upload Files';

    if (failedCount === 0 && duplicateCount === 0) {
      showMessage(`All ${successCount} files uploaded successfully`, 'success');
      
      selectedFiles = [];
      updateFileList();
      
      document.getElementById('patientName').value = '';
      document.getElementById('patientId').value = '';
      document.getElementById('patientAge').value = '';
      
     
      const sexRadios = document.getElementsByName('patientSex');
      sexRadios.forEach(radio => radio.checked = false);
      
      document.getElementById('refPhysician').value = '';
      document.getElementById('patientHistory').value = '';
      document.getElementById('modality').value = 'CR';
      document.getElementById('studyDesc').value = '';
      document.getElementById('emergency').checked = false;
      
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('examDate').value = today;
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);
      document.getElementById('examTime').value = currentTime;
      
      const userContactNumber = await fetchUserContactNumber();
      document.getElementById('mobileNumber').value = userContactNumber;
      
      await loadPatients();
      
      setTimeout(() => {
        hideMessage();
      }, 5000);
    } else {
      let message = `Upload completed: ${successCount} succeeded`;
      
      if (duplicateCount > 0) {
        message += `, ${duplicateCount} duplicates (skipped)`;
        if (duplicateFiles.length > 0 && duplicateFiles.length <= 5) {
          message += `. Duplicates: ${duplicateFiles.join(', ')}`;
        }
      }
      
      if (failedCount > 0) {
        message += `, ${failedCount} failed`;
        if (failedFiles.length > 0 && failedFiles.length <= 5) {
          message += `. Failed: ${failedFiles.join(', ')}`;
        }
      }
      
      showMessage(message, duplicateCount > 0 && failedCount === 0 ? 'warning' : 'error');
      
      selectedFiles = selectedFiles.filter((file, index) => 
        !duplicateFiles.includes(file.name) && !failedFiles.includes(file.name)
      );
      updateFileList();
    }

  } catch (err) {
    submitButton.disabled = false;
    submitButton.textContent = 'Upload Files';
    showMessage(`Error: ${err.message}`, 'error');
  }
});

window.onload = async () => {
  const centerInput = document.getElementById('centerName');
  const instituteInput = document.getElementById('instituteName');
  centerInput.value = localStorage.getItem('center_name') || '';
  instituteInput.value = localStorage.getItem('institute_name') || '';
  
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('examDate').value = today;
  
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5);
  document.getElementById('examTime').value = currentTime;
  
  const userContactNumber = await fetchUserContactNumber();
  document.getElementById('mobileNumber').value = userContactNumber;
  
  const formElements = [
    'patientName',
    'patientId',
    'patientAge',
    'sexMale',
    'patientHistory',
    'mobileNumber',
    'refPhysician',
    'modality',
    'studyDesc'
  ];
  
  formElements.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('keydown', handleKeyPress);
    }
  });
  
  loadPatients();
};
