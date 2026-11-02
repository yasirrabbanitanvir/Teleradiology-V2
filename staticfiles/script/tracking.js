let viewerTrackingInterval = null;
let viewerKickCheckInterval = null;
let currentStudyUID = null;
let viewerRegistered = false;
let viewerRemoved = false;
let viewerTickWorker = null;

function startViewerTicker(fn, ms) {
  try {
    const src = "setInterval(function(){postMessage(1)}," + ms + ");";
    const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = fn;
    w.onerror = function() {
      try { w.terminate(); } catch (e) {}
      if (viewerTickWorker === w) {
        viewerTickWorker = null;
        if (!viewerRemoved && !viewerKickCheckInterval) viewerKickCheckInterval = setInterval(fn, ms);
      }
    };
    viewerTickWorker = w;
    return;
  } catch (e) {}
  viewerKickCheckInterval = setInterval(fn, ms);
}

function stopViewerTicker() {
  if (viewerTickWorker) {
    try { viewerTickWorker.terminate(); } catch (e) {}
    viewerTickWorker = null;
  }
  if (viewerKickCheckInterval) {
    clearInterval(viewerKickCheckInterval);
    viewerKickCheckInterval = null;
  }
}

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
      viewerRegistered = true;
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
    const response = await fetch(`${window.location.origin}/api/viewer/update/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ study_uid: studyUID })
    });
    if (response.status === 404 && viewerRegistered) {
      closeRemovedViewer();
    }
  } catch (error) {
    console.error('Error updating viewer activity:', error);
  }
}

async function checkIfKickedOut(studyUID) {
  const token = getToken();
  if (!token || !studyUID || !viewerRegistered || viewerRemoved) return;

  try {
    const response = await fetch(`${window.location.origin}/api/viewer/am-i-active/?study_uid=${encodeURIComponent(studyUID)}&_=${Date.now()}`, {

      cache: 'no-store',
      headers: {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data.success && data.is_active === false) {
      closeRemovedViewer();
    }
  } catch (error) {
    console.error('Error checking viewer status:', error);
  }
}

function closeRemovedViewer() {
  if (viewerRemoved) return;
  viewerRemoved = true;

  if (viewerTrackingInterval) {
    clearInterval(viewerTrackingInterval);
    viewerTrackingInterval = null;
  }
  stopViewerTicker();
  currentStudyUID = null;

  try {
    if (typeof openReportWindows !== "undefined" && openReportWindows) {
      openReportWindows.forEach(function(win) {
        try { if (win && !win.closed) win.close(); } catch (e) {}
      });
      openReportWindows.clear();
    }
  } catch (e) {}

  try {
    const bc = new BroadcastChannel("doctor_refresh");
    bc.postMessage({ type: "closeViewer" });
    bc.close();
  } catch (e) {}

  window.close();

  setTimeout(() => {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:18px;text-align:center;padding:24px;">You have been removed from this study. You can close this tab.</div>';
  }, 300);
}

async function unregisterViewer(studyUID) {
  const token = getToken();
  if (!token || !studyUID) return;
  
  try {
    await fetch(`${window.location.origin}/api/viewer/unregister/`, {
      method: 'POST',
      keepalive: true,
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
  
  startViewerTicker(() => {
    if (viewerRemoved || !currentStudyUID) return;
    if (!viewerRegistered) {
      registerViewer(currentStudyUID);
      return;
    }
    checkIfKickedOut(currentStudyUID);
  }, 2000);

  document.addEventListener("visibilitychange", function() {
    if (!document.hidden) checkIfKickedOut(currentStudyUID);
  });

  window.addEventListener('focus', function() {
    checkIfKickedOut(currentStudyUID);
  });

  console.log('Viewer removal watcher active');
}

function stopViewerTracking() {
  if (viewerTrackingInterval) {
    clearInterval(viewerTrackingInterval);
    viewerTrackingInterval = null;
  }
  
  stopViewerTicker();
  
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
