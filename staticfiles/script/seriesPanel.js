(function () {
  const seriesCache = {};

  function injectStyles() {
    if (document.getElementById('series-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'series-panel-styles';
    style.textContent = `
      .series-toggle {
        display: inline-block;
        width: 11px;
        height: 11px;
        line-height: 10px;
        margin-left: 4px;
        border: 1px solid #777;
        background: #f4f4f4;
        color: #333;
        font-size: 11px;
        font-weight: bold;
        text-align: center;
        cursor: pointer;
        user-select: none;
        vertical-align: middle;
      }
      .series-toggle:hover { background: #dcdcdc; }
      tr.series-detail-row > td {
        background: #ece4d2 !important;
        padding: 6px 0 8px 125px !important;
        text-align: left !important;
        border-top: 0 !important;
      }
      tr.series-detail-row table.series-table {
        width: auto !important;
        min-width: 0 !important;
        max-width: none !important;
        display: table;
        margin: 0;
        border-collapse: collapse;
        table-layout: auto;
        background: #fff;
        font-size: 11px;
        line-height: 1.25;
        font-family: inherit;
        text-transform: none;
      }
      tr.series-detail-row table.series-table th {
        background: #4cb85c !important;
        color: #fff !important;
        padding: 3px 8px !important;
        border: 1px solid #fff !important;
        font-size: 11px !important;
        font-weight: bold !important;
        text-transform: none !important;
        text-align: center !important;
        white-space: nowrap;
      }
      tr.series-detail-row table.series-table td {
        background: #f7f2e6 !important;
        color: #3d5a57 !important;
        padding: 2px 8px !important;
        border: 1px solid #fff !important;
        font-size: 11px !important;
        text-align: center !important;
        vertical-align: middle;
      }
      tr.series-detail-row table.series-table td.series-desc {
        min-width: 80px;
        max-width: 140px;
        white-space: normal;
        word-break: break-word;
      }
      tr.series-detail-row table.series-table tfoot td {
        background: #4cb85c !important;
        color: #fff !important;
        font-weight: bold !important;
      }
      tr.series-detail-row table.series-table input[type="checkbox"] {
        margin: 0;
        width: 13px;
        height: 13px;
        vertical-align: middle;
      }
      table.series-table .series-view-link {
        color: #0000ee;
        text-decoration: underline;
        cursor: pointer;
      }
      table.series-table .series-view-all {
        background: #f5deb3;
        color: #000;
        font-weight: bold;
        font-size: 11px;
        border: 1px solid #999;
        padding: 1px 8px;
        cursor: pointer;
      }
      .search-actions {
        flex: 0 0 100%;
        width: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
        clear: both;
      }
      .series-msg { padding: 4px 8px; font-size: 12px; color: #444; }
    `;
    document.head.appendChild(style);
  }

  function getToken() {
    return sessionStorage.getItem('token') || localStorage.getItem('token');
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function seriesKeyOf(img) {
    return img.series_instance_uid || `${img.series_number}_${img.series_description}`;
  }

  async function fetchSeries(studyUid, bodyPart) {
    if (seriesCache[studyUid]) return seriesCache[studyUid];

    const res = await fetch(`${window.location.origin}/api/studies/${encodeURIComponent(studyUid)}/images/`, {
      headers: { 'Authorization': `Token ${getToken()}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load series');

    const map = new Map();
    (data.images || []).forEach(img => {
      const key = seriesKeyOf(img);
      if (!map.has(key)) {
        map.set(key, {
          key,
          number: img.series_number,
          description: img.series_description || '',
          bodyPart: img.study_description || bodyPart || '',
          count: 0
        });
      }
      map.get(key).count++;
    });

    const list = Array.from(map.values()).sort((a, b) => {
      const an = parseInt(a.number, 10);
      const bn = parseInt(b.number, 10);
      if (isNaN(an) && isNaN(bn)) return 0;
      if (isNaN(an)) return 1;
      if (isNaN(bn)) return -1;
      return an - bn;
    });

    seriesCache[studyUid] = list;
    return list;
  }

  function buildTable(studyUid, list) {
    if (!list.length) return '<div class="series-msg">No series found for this study.</div>';

    const totalImages = list.reduce((sum, s) => sum + s.count, 0);

    const rows = list.map((s, i) => `
      <tr>
        <td><input type="checkbox" class="series-check" data-series-key="${esc(s.key)}" data-count="${s.count}" checked /></td>
        <td>${esc(s.number == null || s.number === '' ? i + 1 : s.number)}</td>
        <td class="series-desc">${esc(s.description) || '-'}</td>
        <td>${esc(s.bodyPart) || '-'}</td>
        <td>${s.count}</td>
        <td><a class="series-view-link" data-series-key="${esc(s.key)}">View</a></td>
      </tr>
    `).join('');

    return `
      <table class="series-table" data-study-uid="${esc(studyUid)}">
        <thead>
          <tr>
            <th><input type="checkbox" class="series-check-all" checked /></th>
            <th>Series No</th>
            <th>Description</th>
            <th>Body Part</th>
            <th>Images</th>
            <th>View</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr class="series-total">
            <td colspan="4">Total count</td>
            <td class="series-total-count">${totalImages}/${totalImages}</td>
            <td><button type="button" class="series-view-all">View</button></td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  function refreshTotal(table) {
    const checks = Array.from(table.querySelectorAll('.series-check'));
    const all = checks.reduce((sum, c) => sum + (parseInt(c.dataset.count, 10) || 0), 0);
    const picked = checks.filter(c => c.checked).reduce((sum, c) => sum + (parseInt(c.dataset.count, 10) || 0), 0);
    const cell = table.querySelector('.series-total-count');
    if (cell) cell.textContent = `${picked}/${all}`;
    const master = table.querySelector('.series-check-all');
    if (master) master.checked = checks.length > 0 && checks.every(c => c.checked);
  }

  async function openSeries(studyUid, keys) {
    if (!studyUid || !keys.length) {
      alert('Please select at least one series');
      return;
    }

    if (typeof userPermissions !== 'undefined' && userPermissions && userPermissions.can_view_images === false) {
      alert('You do not have permission to view images');
      return;
    }

    try {
      const res = await fetch(`${window.location.origin}/api/viewer/check/?study_uid=${encodeURIComponent(studyUid)}`, {
        headers: { 'Authorization': `Token ${getToken()}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.active_viewers && data.active_viewers.length > 0) {
          const ok = confirm(`Warning!\n\nFollowing users are currently viewing the study:\n${data.active_viewers.join(', ')}\n\nDo you really wish to load this study?`);
          if (!ok) return;
        }
      }
    } catch (e) {}

    const screenW = screen.availWidth || window.screen.width;
    const screenH = screen.availHeight || window.screen.height;
    const features = `toolbar=no,menubar=no,location=no,resizable=yes,scrollbars=yes,status=no,width=${screenW},height=${screenH},left=0,top=0`;
    const seriesParam = keys.map(encodeURIComponent).join(',');
    const w = window.open(`./viewer.html?study=${encodeURIComponent(studyUid)}&series=${seriesParam}`, '_blank', features);
    if (!w) alert('The viewer window was blocked by the browser. Please allow popups for this site and try again.');
  }

  async function toggleSeries(toggle) {
    const tr = toggle.closest('tr');
    if (!tr) return;

    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('series-detail-row')) {
      existing.remove();
      toggle.textContent = '+';
      return;
    }

    const studyUid = toggle.dataset.studyUid;
    if (!studyUid) return;

    const detail = document.createElement('tr');
    detail.className = 'series-detail-row';
    const td = document.createElement('td');
    td.colSpan = Math.max(tr.children.length, 1);
    td.innerHTML = '<div class="series-msg">Loading series...</div>';
    detail.appendChild(td);
    tr.parentNode.insertBefore(detail, tr.nextSibling);
    toggle.textContent = '\u2212';

    try {
      const list = await fetchSeries(studyUid, toggle.dataset.bodyPart || '');
      td.innerHTML = buildTable(studyUid, list);
    } catch (err) {
      td.innerHTML = `<div class="series-msg">Could not load series (${esc(err.message)}).</div>`;
    }
  }

  document.addEventListener('click', function (e) {
    const toggle = e.target.closest('.series-toggle');
    if (toggle) {
      toggleSeries(toggle);
      return;
    }

    const viewLink = e.target.closest('.series-view-link');
    if (viewLink) {
      const table = viewLink.closest('table.series-table');
      openSeries(table.dataset.studyUid, [viewLink.dataset.seriesKey]);
      return;
    }

    const viewAll = e.target.closest('.series-view-all');
    if (viewAll) {
      const table = viewAll.closest('table.series-table');
      const keys = Array.from(table.querySelectorAll('.series-check:checked')).map(c => c.dataset.seriesKey);
      openSeries(table.dataset.studyUid, keys);
    }
  });

  document.addEventListener('change', function (e) {
    const table = e.target.closest && e.target.closest('table.series-table');
    if (!table) return;

    if (e.target.classList.contains('series-check-all')) {
      table.querySelectorAll('.series-check').forEach(c => { c.checked = e.target.checked; });
    }
    if (e.target.classList.contains('series-check') || e.target.classList.contains('series-check-all')) {
      refreshTotal(table);
    }
  });

  function filterSelectOptions(select, query) {
    const q = query.trim().toLowerCase();
    Array.from(select.options).forEach(opt => {
      if (opt.disabled && !opt.value) return;
      const match = !q || opt.textContent.toLowerCase().includes(q);
      opt.hidden = !match;
      opt.style.display = match ? '' : 'none';
    });
  }

  function initAssignSearch() {
    const input = document.getElementById('assign-doctor-search');
    const select = document.getElementById('assign-doctors');
    if (!input || !select) return;

    input.addEventListener('input', () => filterSelectOptions(select, input.value));

    new MutationObserver(() => {
      if (input.value.trim()) filterSelectOptions(select, input.value);
    }).observe(select, { childList: true });
  }

  function initAssignPanelDesign() {
    const panel = document.getElementById('assign-panel');
    const select = document.getElementById('assign-doctors');
    const loadBtn = document.getElementById('load-studies-btn');
    if (!panel || !select || !loadBtn || !loadBtn.parentElement) return;

    const bar = loadBtn.parentElement;
    bar.classList.add('load-bar-flex');
    bar.appendChild(panel);

    const wrap = document.createElement('div');
    wrap.className = 'assign-dd';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'assign-dd-toggle';
    toggle.textContent = 'SELECT';

    const list = document.createElement('div');
    list.className = 'assign-dd-list';

    const placeholder = document.createElement('div');
    placeholder.className = 'assign-dd-placeholder active';
    placeholder.textContent = 'SELECT';
    list.appendChild(placeholder);

    select.setAttribute('size', '12');
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(toggle);
    wrap.appendChild(list);
    list.appendChild(select);

    function refreshLabel() {
      const chosen = Array.from(select.selectedOptions).filter(o => o.value);
      let text = 'SELECT';
      if (chosen.length === 1) text = chosen[0].textContent.trim();
      else if (chosen.length > 1) text = `${chosen.length} selected`;
      if (toggle.textContent !== text) toggle.textContent = text;
      toggle.title = chosen.map(o => o.textContent.trim()).join(', ');
      placeholder.classList.toggle('active', chosen.length === 0);
    }

    function closeList() {
      wrap.classList.remove('open');
    }

    function openList() {
      const r = toggle.getBoundingClientRect();
      list.style.left = r.left + 'px';
      list.style.top = (r.bottom - 1) + 'px';
      wrap.classList.add('open');
      refreshLabel();
    }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (wrap.classList.contains('open')) closeList();
      else openList();
    });

    select.addEventListener('mousedown', function (e) {
      const opt = e.target;
      if (opt && opt.tagName === 'OPTION' && !opt.disabled) {
        e.preventDefault();
        opt.selected = !opt.selected;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refreshLabel();
      }
    });

    placeholder.addEventListener('click', function () {
      Array.from(select.options).forEach(o => { o.selected = false; });
      select.dispatchEvent(new Event('change', { bubbles: true }));
      refreshLabel();
      closeList();
    });

    list.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', closeList);
    window.addEventListener('resize', closeList);
    window.addEventListener('scroll', function (e) {
      if (list.contains(e.target)) return;
      closeList();
    }, true);

    const searchInput = document.getElementById('assign-doctor-search');
    if (searchInput) {
      searchInput.addEventListener('input', openList);
    }

    new MutationObserver(refreshLabel).observe(select, { childList: true });
    select.addEventListener('change', refreshLabel);
    setInterval(refreshLabel, 500);
  }

  function initClock() {
    const clock = document.getElementById('live-clock');
    if (!clock) return;

    const pad = n => String(n).padStart(2, '0');

    function tick() {
      const d = new Date();
      let h = d.getHours();
      const suffix = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      clock.textContent = `${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${suffix}`;
    }

    tick();
    setInterval(tick, 1000);
  }

  function initCenterSearch() {
    const select = document.getElementById('center');
    const input = document.getElementById('center-search-input');
    const list = document.getElementById('center-search-list');
    if (!select || !input || !list) return;

    function currentText() {
      if (select.value === 'ALL') return '';
      const opt = select.options[select.selectedIndex];
      return opt ? opt.text : '';
    }

    function matches(q) {
      q = q.trim().toLowerCase();
      return Array.from(select.options).filter(o => !q || o.text.toLowerCase().includes(q));
    }

    function choose(opt) {
      const changed = select.value !== opt.value;
      select.value = opt.value;
      input.value = currentText();
      list.classList.remove('open');
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function render(q) {
      list.innerHTML = '';
      const found = matches(q);
      if (!found.length) {
        const none = document.createElement('div');
        none.className = 'center-search-empty';
        none.textContent = 'No match';
        list.appendChild(none);
        return;
      }
      found.forEach(o => {
        const row = document.createElement('div');
        row.className = 'center-search-item';
        row.textContent = o.text;
        row.addEventListener('mousedown', e => {
          e.preventDefault();
          choose(o);
        });
        list.appendChild(row);
      });
    }

    function show(q) {
      render(q);
      list.classList.add('open');
    }

    input.addEventListener('focus', () => {
      input.select();
      show('');
    });

    input.addEventListener('input', () => show(input.value));

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const found = matches(input.value);
        if (found.length) choose(found[0]);
      } else if (e.key === 'Escape') {
        input.blur();
      }
    });

    input.addEventListener('blur', () => {
      list.classList.remove('open');
      if (!input.value.trim() && select.value !== 'ALL') {
        const all = Array.from(select.options).find(o => o.value === 'ALL');
        if (all) choose(all);
      }
      input.value = currentText();
    });

    input.value = currentText();
    setInterval(() => {
      if (document.activeElement !== input && input.value !== currentText()) {
        input.value = currentText();
      }
    }, 500);
  }

  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAssignSearch);
    document.addEventListener('DOMContentLoaded', initAssignPanelDesign);
    document.addEventListener('DOMContentLoaded', initCenterSearch);
    document.addEventListener('DOMContentLoaded', initClock);
  } else {
    initAssignSearch();
    initAssignPanelDesign();
    initCenterSearch();
    initClock();
  }
})();
