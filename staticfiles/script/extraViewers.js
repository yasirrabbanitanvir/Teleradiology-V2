(function () {
  const OHIF_BASE = 'https://viewer.ohif.org';
  const VOLVIEW_BASE = 'https://volview.kitware.app/';
  const origin = window.location.origin;

  const getToken = () => sessionStorage.getItem('token') || localStorage.getItem('token');
  const manifestUrl = (uid, file) => `${origin}/api/viewer-manifest/${encodeURIComponent(uid)}/${file}`;
  const ohifUrl = (route, uid, extra) =>
    `${OHIF_BASE}/${route}/dicomjson?url=${encodeURIComponent(manifestUrl(uid, 'ohif.json'))}${extra || ''}`;

  async function fileUrls(uid) {
    const res = await fetch(`${origin}/api/studies/${encodeURIComponent(uid)}/images/`, {
      headers: { Authorization: `Token ${getToken()}` }
    });
    if (!res.ok) throw new Error('Could not load study images');
    const data = await res.json();
    const seen = new Set();
    const urls = [];
    (data.images || []).forEach(img => {
      if (!img.file_path) return;
      const url = `${origin}/dicom/${img.file_path.replace(/^\/+/, '')}/`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    });
    if (!urls.length) throw new Error('No DICOM files found for this study');
    return urls;
  }

  const VIEWERS = [
    {
      label: 'OH',
      title: 'OHIF Viewer',
      color: '#1f6fb5',
      open: ctx => ohifUrl('viewer', ctx.uid)
    },
    {
      label: '3D',
      title: 'OHIF MPR + 3D',
      color: '#7a3db8',
      open: ctx => ohifUrl('viewer', ctx.uid, '&hangingprotocolId=mprAnd3DVolumeViewport')
    },
    {
      label: 'SG',
      title: 'OHIF Segmentation',
      color: '#c2571a',
      open: ctx => ohifUrl('segmentation', ctx.uid)
    },
    {
      label: 'PT',
      title: 'OHIF PET/CT (TMTV)',
      color: '#a82d4f',
      only: ctx => ctx.isPet,
      open: ctx => ohifUrl('tmtv', ctx.uid)
    },
    {
      label: 'VV',
      title: 'VolView 3D',
      color: '#2d8a5a',
      open: async ctx => {
        const urls = await fileUrls(ctx.uid);
        return `${VOLVIEW_BASE}?urls=[${urls.map(encodeURIComponent).join(',')}]`;
      }
    },
    {
      label: 'WS',
      title: 'Weasis (installed app)',
      color: '#3a4a5c',
      protocol: true,
      open: ctx => 'weasis://' + encodeURIComponent(`$dicom:get -w "${manifestUrl(ctx.uid, 'weasis.xml')}"`)
    }
  ];

  async function canViewImages() {
    try {
      const res = await fetch(`${origin}/api/current-user/`, {
        headers: { Authorization: `Token ${getToken()}` }
      });
      if (!res.ok) return true;
      const data = await res.json();
      if (data.success && data.permissions && !data.permissions.can_view_images) return false;
    } catch (e) {
      return true;
    }
    return true;
  }

  async function launch(viewer, ctx) {
    const win = viewer.protocol ? null : window.open('', '_blank');
    try {
      if (!(await canViewImages())) {
        if (win) win.close();
        alert('You do not have permission to view images');
        return;
      }
      const url = await viewer.open(ctx);
      if (viewer.protocol) {
        window.location.href = url;
      } else if (win) {
        win.location.href = url;
      } else {
        window.open(url, '_blank');
      }
    } catch (err) {
      if (win) win.close();
      alert('Could not open viewer: ' + err.message);
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .xv-group { display: flex; flex-wrap: nowrap; justify-content: center; gap: 2px; margin: 0 auto 4px; }
    .xv-btn {
      flex: 0 0 auto; min-width: 24px; height: 22px; padding: 0 3px; border: 0; border-radius: 2px;
      color: #fff; font: 700 11px Arial, sans-serif; cursor: pointer; line-height: 22px;
    }
    .xv-btn:hover { filter: brightness(1.15); }
  `;
  document.head.appendChild(style);

  function enhance(toggle) {
    const td = toggle.closest('td');
    const uid = toggle.dataset.studyUid;
    if (!td || !uid || td.dataset.xv) return;
    td.dataset.xv = '1';

    const row = td.closest('tr');
    const isPet = !!row && Array.from(row.cells).some(c => /(^|[\s,\/])PT($|[\s,\/])/.test(c.textContent.trim()));
    const ctx = { uid, isPet };

    const group = document.createElement('span');
    group.className = 'xv-group';
    VIEWERS.filter(v => !v.only || v.only(ctx)).forEach(v => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xv-btn';
      btn.textContent = v.label;
      btn.title = v.title;
      btn.style.background = v.color;
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        launch(v, ctx);
      });
      group.appendChild(btn);
    });

    const nameNode = Array.from(td.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
    td.insertBefore(group, nameNode || toggle);
  }

  let queued = false;
  function scan() {
    queued = false;
    document.querySelectorAll('.series-toggle[data-study-uid]').forEach(enhance);
  }

  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      setTimeout(scan, 200);
    }
  }).observe(document.body, { childList: true, subtree: true });

  scan();
})();
