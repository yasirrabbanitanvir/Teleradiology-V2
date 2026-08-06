let viewerTrackingInterval = null;
let viewerKickCheckInterval = null;
let currentStudyUID = null;

function getStudyUIDFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('study');
}

function getToken() {
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

async function registerViewer(studyUID) {
  const token = getToken();
  if (!token || !studyUID) return;
  
  try {
    const response = await fetch(`${window.location.origin}/api/viewer/register/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ study_uid: studyUID })
    });
    
    if (response.ok) {
      console.log('Viewer registered successfully');
    }
  } catch (error) {
    console.error('Error registering viewer:', error);
  }
}

async function updateViewerActivity(studyUID) {
  const token = getToken();
  if (!token || !studyUID) return;
  
  try {
    await fetch(`${window.location.origin}/api/viewer/update/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ study_uid: studyUID })
    });
  } catch (error) {
    console.error('Error updating viewer activity:', error);
  }
}

async function checkIfKickedOut(studyUID) {
  // Auto-disconnect on another user opening the same study has been disabled.
  // Multiple users are now allowed to view the same study simultaneously;
  // this function is intentionally left as a no-op to avoid breaking callers.
  return;
}

async function unregisterViewer(studyUID) {
  const token = getToken();
  if (!token || !studyUID) return;
  
  try {
    await fetch(`${window.location.origin}/api/viewer/unregister/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ study_uid: studyUID })
    });
    console.log('Viewer unregistered successfully');
  } catch (error) {
    console.error('Error unregistering viewer:', error);
  }
}

function startViewerTracking() {
  currentStudyUID = getStudyUIDFromURL();
  
  if (!currentStudyUID) {
    console.log('No study UID found, viewer tracking disabled');
    return;
  }
  
  registerViewer(currentStudyUID);
  
  viewerTrackingInterval = setInterval(() => {
    updateViewerActivity(currentStudyUID);
  }, 60000);
  
  // Kick-check interval removed: viewers are no longer auto-disconnected
  // when another user opens the same study. The "currently viewing"
  // notification (shown before opening a study) is still active.
}

function stopViewerTracking() {
  if (viewerTrackingInterval) {
    clearInterval(viewerTrackingInterval);
    viewerTrackingInterval = null;
  }
  
  if (viewerKickCheckInterval) {
    clearInterval(viewerKickCheckInterval);
    viewerKickCheckInterval = null;
  }
  
  if (currentStudyUID) {
    unregisterViewer(currentStudyUID);
    currentStudyUID = null;
  }
}

window.addEventListener('load', function() {
  startViewerTracking();
});

window.addEventListener('beforeunload', function() {
  stopViewerTracking();
});

window.addEventListener('pagehide', function() {
  stopViewerTracking();
});

window.addEventListener('unload', function() {
  stopViewerTracking();
});