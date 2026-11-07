(function () {
  const bars = {};

  function injectStyles() {
    if (document.getElementById('query-bar-styles')) return;
    const style = document.createElement('style');
    style.id = 'query-bar-styles';
    style.textContent = `
      .query-bar {
        display: none;
        justify-content: space-between;
        align-items: center;
        background: #eeeeee;
        min-height: 26px;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        width: 100%;
      }
      .query-bar.shown {
        display: flex;
      }
      .query-bar .qb-msg {
        background: #e0f2f1;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 13px;
        font-weight: bold;
        text-decoration: underline;
        padding: 4px 6px;
        width: 520px;
        max-width: 70%;
        box-sizing: border-box;
        visibility: hidden;
      }
      .query-bar.busy .qb-msg {
        visibility: visible;
      }
      .query-bar .qb-time {
        color: #888888;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        padding: 0 6px;
        white-space: nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function build(key, anchor, where) {
    injectStyles();
    const el = document.createElement('div');
    el.className = 'query-bar';
    el.innerHTML = '<div class="qb-msg">Fetching Page ...</div><div class="qb-time"></div>';
    const target = typeof anchor === 'string' ? document.querySelector(anchor) : anchor;
    if (target) target.insertAdjacentElement(where || 'afterend', el);
    else document.body.prepend(el);
    bars[key] = { el, time: el.querySelector('.qb-time'), count: 0, startedAt: 0 };
    return bars[key];
  }

  function get(key, anchor, where) {
    const existing = bars[key];
    if (existing && existing.el.isConnected) return existing;
    return build(key, anchor, where);
  }

  window.QueryBar = {
    start(key, anchor, where) {
      const bar = get(key || 'main', anchor || '.search-panel', where);
      bar.count++;
      if (bar.count === 1) {
        bar.startedAt = performance.now();
        bar.time.textContent = '';
        bar.el.classList.add('shown', 'busy');
      }
    },
    end(key) {
      const bar = bars[key || 'main'];
      if (!bar) return;
      bar.count = Math.max(0, bar.count - 1);
      if (bar.count > 0) return;
      const secs = (performance.now() - bar.startedAt) / 1000;
      bar.time.textContent = 'Your query took ' + secs.toFixed(3) + ' secs';
      bar.el.classList.remove('busy');
    },
    reset(key) {
      const bar = bars[key || 'main'];
      if (!bar) return;
      bar.count = 0;
      bar.el.classList.remove('shown', 'busy');
      bar.time.textContent = '';
    }
  };
})();
