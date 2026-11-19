(function () {
  var printed = {};
  var ready = null;

  function endpoint() {
    return window.location.origin + '/api/printed-files/';
  }

  function authHeaders(json) {
    var t = sessionStorage.getItem('token') || localStorage.getItem('token');
    var h = { 'Authorization': 'Token ' + t };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function merge(map) {
    Object.keys(map || {}).forEach(function (k) { printed[k] = map[k]; });
  }

  function refresh() {
    document.querySelectorAll('[data-print-key]').forEach(function (el) {
      el.style.display = printed[el.getAttribute('data-print-key')] ? 'inline-block' : 'none';
    });
  }

  function load(force) {
    if (ready && !force) return ready;
    var t = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (!t) {
      ready = Promise.resolve();
      return ready;
    }
    ready = fetch(endpoint(), { headers: authHeaders(false) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.printed) merge(d.printed);
        refresh();
      })
      .catch(function () {});
    return ready;
  }

  function reportKey(url) {
    if (!url) return '';
    var path = String(url).split('?')[0].split('#')[0];
    var name = path.split('/').pop() || '';
    try { name = decodeURIComponent(name); } catch (e) {}
    return name ? 'r:' + name : '';
  }

  function billKey(billId, file) {
    return 'b:' + billId + ':' + (file && file.id != null ? file.id : 0);
  }

  function reportLabel(r, i) {
    var label = 'Report ' + (i + 1);
    if (r.reported_by) label += ' - ' + r.reported_by;
    if (r.created_at) label += ' (' + r.created_at + ')';
    return label;
  }

  function isPrinted(key) {
    return !!(key && printed[key]);
  }

  function anyPrinted(keys) {
    return (keys || []).some(isPrinted);
  }

  function mark(keys) {
    keys = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    var fresh = keys.filter(function (k) { return !printed[k]; });
    if (!fresh.length) return Promise.resolve();
    fresh.forEach(function (k) { printed[k] = { at: new Date().toISOString() }; });
    refresh();
    return fetch(endpoint(), {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ keys: fresh }),
      keepalive: true
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.printed) merge(d.printed);
        refresh();
      })
      .catch(function () {});
  }

  var LINK_STYLE = 'color:#0066cc;font-size:15px;text-decoration:none;padding:8px 12px;background:#f0f7ff;border:1px solid #cce;border-radius:4px;display:inline-block;overflow-wrap:anywhere;';
  var ACTIVE_STYLE = 'color:#fff;font-size:15px;text-decoration:none;padding:8px 12px;background:#0062C2;border:1px solid #004a94;border-radius:4px;display:inline-block;font-weight:600;overflow-wrap:anywhere;box-shadow:0 1px 4px rgba(0,98,194,0.35);';
  var BADGE_STYLE = 'display:none;flex:0 0 auto;font-size:11px;font-weight:600;line-height:1;padding:4px 9px;border-radius:10px;background:#e7f6ea;color:#1b7a2f;border:1px solid #b6e0bd;white-space:nowrap;';

  function chooser(opts) {
    var old = document.getElementById(opts.id);
    if (old) old.remove();

    var modal = document.createElement('div');
    modal.id = opts.id;
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;overflow:hidden;';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:8px;padding:30px;width:460px;max-width:calc(100vw - 40px);max-height:calc(100vh - 80px);overflow-y:auto;box-sizing:border-box;box-shadow:0 4px 20px rgba(0,0,0,0.3);';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;';
    var title = document.createElement('strong');
    title.style.fontSize = '17px';
    title.textContent = opts.title;
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '\u2715';
    close.style.cssText = 'background:none;border:none;font-size:22px;cursor:pointer;color:#666;';
    close.addEventListener('click', function () { modal.remove(); });
    head.appendChild(title);
    head.appendChild(close);
    panel.appendChild(head);

    var active = null;
    function activate(a) {
      if (active) active.style.cssText = LINK_STYLE;
      active = a;
      a.style.cssText = ACTIVE_STYLE;
      a.setAttribute('aria-current', 'true');
    }
    function deactivate(a) {
      a.style.cssText = LINK_STYLE;
      a.removeAttribute('aria-current');
      if (active === a) active = null;
    }
    function watch(a, result) {
      Promise.resolve(result).then(function (win) {
        if (!win || typeof win.closed === 'undefined') return;
        var timer = setInterval(function () {
          if (!document.body.contains(a)) { clearInterval(timer); return; }
          var gone;
          try { gone = win.closed; } catch (e) { gone = true; }
          if (gone) {
            clearInterval(timer);
            if (active === a) deactivate(a);
          }
        }, 600);
      }).catch(function () {});
    }

    opts.items.forEach(function (item) {
      var row = document.createElement('div');
      row.style.cssText = 'margin:8px 0;display:flex;align-items:center;gap:8px;';
      if (item.disabled) {
        row.style.color = '#888';
        row.textContent = '\uD83D\uDCC4 ' + item.label + ' (no file)';
        panel.appendChild(row);
        return;
      }
      var a = document.createElement('a');
      a.href = '#';
      a.style.cssText = LINK_STYLE;
      a.textContent = '\uD83D\uDCC4 ' + item.label;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        activate(a);
        var result;
        try { result = opts.onPick(item); } catch (err) { console.error(err); }
        watch(a, result);
      });
      row.appendChild(a);
      if (item.key) {
        var badge = document.createElement('span');
        badge.setAttribute('data-print-key', item.key);
        badge.style.cssText = BADGE_STYLE;
        badge.textContent = 'Printed';
        if (printed[item.key]) badge.style.display = 'inline-block';
        row.appendChild(badge);
      }
      panel.appendChild(row);
    });

    modal.appendChild(panel);
    document.body.appendChild(modal);
    load().then(refresh);
    return modal;
  }

  window.PrintTracker = {
    load: load,
    mark: mark,
    isPrinted: isPrinted,
    anyPrinted: anyPrinted,
    reportKey: reportKey,
    billKey: billKey,
    reportLabel: reportLabel,
    chooser: chooser
  };

  load();
})();
