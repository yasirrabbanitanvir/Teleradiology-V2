(function () {
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function popupMain(key) {
    var S = window.opener && window.opener.__billViewSessions && window.opener.__billViewSessions[key];
    var view = document.getElementById('inv-view');
    var msg = document.getElementById('inv-msg');
    var dlBtn = document.getElementById('inv-dl');
    var prBtn = document.getElementById('inv-pr');
    var printer = null;

    function esc(v) {
      return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function readBuffer(blob) {
      if (blob.arrayBuffer) return blob.arrayBuffer();
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
        r.readAsArrayBuffer(blob);
      });
    }

    function save() {
      if (!S || !S.blob) return;
      var url = URL.createObjectURL(S.blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = S.fileName || 'bill';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    function infoSheet(withMeta) {
      var b = S.bill;
      var rows = [['Institute', b.institute_name], ['Bill', b.title], ['Body Part', b.description], ['Date/Time', b.bill_date], ['Attached File', S.fileName || 'None']]
        .filter(function (r) { return r[1]; });
      var html = '<div class="bv-sheet"><h1>' + esc(b.title) + '</h1>';
      if (withMeta) {
        html += rows.map(function (r) {
          return '<div class="bv-row"><span class="bv-label">' + esc(r[0]) + '</span><span class="bv-value">' + esc(r[1]) + '</span></div>';
        }).join('');
      }
      return html + '</div>';
    }

    var BUILTIN = {
      0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
      14: 'dd-mm-yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
      20: 'h:mm', 21: 'h:mm:ss', 22: 'dd-mm-yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
      39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 49: '@'
    };
    var INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    function tokenizeFormat(spec) {
      var out = [];
      var i = 0;
      while (i < spec.length) {
        var c = spec.charAt(i);
        if (c === '"') {
          var j = spec.indexOf('"', i + 1);
          if (j < 0) j = spec.length;
          out.push({ lit: true, v: spec.slice(i + 1, j) });
          i = j + 1;
        } else if (c === '\\') {
          out.push({ lit: true, v: spec.charAt(i + 1) });
          i += 2;
        } else if (c === '_') {
          out.push({ lit: true, v: ' ' });
          i += 2;
        } else if (c === '*') {
          i += 2;
        } else if (c === '[') {
          var k = spec.indexOf(']', i);
          if (k < 0) k = spec.length;
          var inner = spec.slice(i + 1, k);
          if (/^\$/.test(inner)) {
            out.push({ lit: true, v: inner.slice(1).split('-')[0] });
          } else if (/^(h+|m+|s+)$/i.test(inner)) {
            out.push({ elapsed: inner.toLowerCase() });
          }
          i = k + 1;
        } else {
          out.push({ ch: c });
          i++;
        }
      }
      return out;
    }

    function pad(n, w) {
      var s = String(n);
      while (s.length < w) s = '0' + s;
      return s;
    }

    function formatDate(serial, tokens, d1904) {
      var offset = d1904 ? 24107 : (serial >= 61 ? 25569 : 25568);
      var d = new Date(Math.round((serial - offset) * 86400000));
      var text = tokens.map(function (t) { return t.lit ? '' : (t.ch || ''); }).join('');
      var hasAmPm = /AM\/PM|A\/P/i.test(text);
      var i = 0;
      var chars = [];
      tokens.forEach(function (t) {
        if (t.lit) chars.push({ lit: t.v });
        else if (t.elapsed) chars.push({ elapsed: t.elapsed });
        else chars.push({ c: t.ch });
      });
      var str = chars.map(function (x) { return x.c !== undefined ? x.c : '\u0000'; }).join('');
      var res = '';
      var lastH = false;
      while (i < chars.length) {
        var item = chars[i];
        if (item.lit !== undefined) { res += item.lit; i++; continue; }
        if (item.elapsed) {
          var total = serial * 24;
          var unit = item.elapsed.charAt(0);
          var val = unit === 'h' ? Math.floor(total) : unit === 'm' ? Math.floor(total * 60) : Math.floor(total * 3600);
          res += pad(val, item.elapsed.length);
          i++;
          continue;
        }
        var rest = str.slice(i);
        var m;
        if ((m = /^(AM\/PM|A\/P)/i.exec(rest))) {
          var pm = d.getUTCHours() >= 12;
          var up = m[1].toUpperCase();
          res += up === 'AM/PM' ? (pm ? 'PM' : 'AM') : (pm ? 'P' : 'A');
          i += m[1].length;
          lastH = false;
        } else if ((m = /^y{3,4}/i.exec(rest))) {
          res += d.getUTCFullYear(); i += m[0].length;
        } else if ((m = /^y{1,2}/i.exec(rest))) {
          res += pad(d.getUTCFullYear() % 100, 2); i += m[0].length;
        } else if ((m = /^m+/i.exec(rest))) {
          var len = m[0].length;
          var after = rest.slice(len);
          var isMin = lastH || /^[^a-z]*s/i.test(after);
          if (isMin) {
            res += len >= 2 ? pad(d.getUTCMinutes(), 2) : d.getUTCMinutes();
          } else if (len === 1) res += d.getUTCMonth() + 1;
          else if (len === 2) res += pad(d.getUTCMonth() + 1, 2);
          else if (len === 3) res += MONTHS[d.getUTCMonth()].slice(0, 3);
          else if (len === 4) res += MONTHS[d.getUTCMonth()];
          else res += MONTHS[d.getUTCMonth()].charAt(0);
          i += len;
          lastH = false;
        } else if ((m = /^d+/i.exec(rest))) {
          var dl = m[0].length;
          if (dl === 1) res += d.getUTCDate();
          else if (dl === 2) res += pad(d.getUTCDate(), 2);
          else if (dl === 3) res += DAYS[d.getUTCDay()].slice(0, 3);
          else res += DAYS[d.getUTCDay()];
          i += dl;
          lastH = false;
        } else if ((m = /^h+/i.exec(rest))) {
          var h = d.getUTCHours();
          if (hasAmPm) { h = h % 12; if (h === 0) h = 12; }
          res += m[0].length >= 2 ? pad(h, 2) : h;
          i += m[0].length;
          lastH = true;
        } else if ((m = /^s+/i.exec(rest))) {
          res += m[0].length >= 2 ? pad(d.getUTCSeconds(), 2) : d.getUTCSeconds();
          i += m[0].length;
          lastH = false;
        } else if ((m = /^\.0+/.exec(rest))) {
          var frac = Math.round((serial * 86400 - Math.floor(serial * 86400)) * Math.pow(10, m[0].length - 1));
          res += '.' + pad(frac, m[0].length - 1);
          i += m[0].length;
        } else {
          res += item.c;
          i++;
        }
      }
      return res;
    }

    function formatNumber(v, tokens, forceSign) {
      var first = -1;
      var last = -1;
      tokens.forEach(function (t, idx) {
        if (t.ch !== undefined && /[#0?]/.test(t.ch)) {
          if (first < 0) first = idx;
          last = idx;
        }
      });
      var joinTokens = function (list) {
        return list.map(function (t) { return t.lit ? t.v : (t.ch || ''); }).join('');
      };
      var neg = v < 0;
      var abs = Math.abs(v);
      if (first < 0) {
        var plain = joinTokens(tokens);
        return (forceSign && neg ? '-' : '') + plain;
      }
      var prefix = joinTokens(tokens.slice(0, first));
      var suffix = joinTokens(tokens.slice(last + 1));
      var run = tokens.slice(first, last + 1).filter(function (t) { return t.ch !== undefined; }).map(function (t) { return t.ch; }).join('');
      var percent = (prefix + suffix).split('%').length - 1;
      if (percent) abs = abs * Math.pow(100, percent);
      var dot = run.indexOf('.');
      var intPart = dot >= 0 ? run.slice(0, dot) : run;
      var decPart = dot >= 0 ? run.slice(dot + 1) : '';
      var thousands = intPart.indexOf(',') >= 0;
      var trailing = 0;
      var m = /,+$/.exec(intPart);
      if (m && decPart === '') { trailing = m[0].length; }
      if (trailing) abs = abs / Math.pow(1000, trailing);
      var minInt = (intPart.match(/0/g) || []).length;
      var decimals = decPart.replace(/[^0#?]/g, '').length;
      var fixed = abs.toFixed(decimals);
      var bits = fixed.split('.');
      var ip = bits[0];
      var fp = bits[1] || '';
      if (decPart) {
        var minDec = (decPart.match(/0/g) || []).length;
        while (fp.length > minDec && fp.charAt(fp.length - 1) === '0') fp = fp.slice(0, -1);
      }
      if (ip === '0' && minInt === 0 && fp) ip = '';
      while (ip.length < minInt) ip = '0' + ip;
      if (thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      var body = ip + (fp ? '.' + fp : '');
      return (forceSign && neg ? '-' : '') + prefix + body + suffix;
    }

    function formatValue(v, code, d1904) {
      if (typeof v === 'string') return v;
      if (code === 'General' || code == null) {
        if (v === 0) return '0';
        var abs = Math.abs(v);
        if (abs >= 1e11 || abs < 1e-9) return String(v.toExponential(5)).replace(/\.?0+e/, 'E');
        return String(parseFloat(v.toPrecision(11)));
      }
      var sections = code.split(';');
      var spec = sections[0];
      var value = v;
      var forceSign = true;
      if (sections.length > 1 && v < 0) { spec = sections[1]; value = Math.abs(v); forceSign = false; }
      else if (sections.length > 2 && v === 0) { spec = sections[2]; }
      var tokens = tokenizeFormat(spec);
      var plain = tokens.map(function (t) { return t.ch || ''; }).join('');
      var isDate = /[dmyhs]/i.test(plain) && !/[0#?]/.test(plain) || tokens.some(function (t) { return t.elapsed; });
      if (isDate) return formatDate(v, tokens, d1904);
      if (/^@$/.test(plain)) return String(v);
      return formatNumber(value, tokens, forceSign);
    }

    function applyTint(hex, tint) {
      if (!tint) return hex;
      var r = parseInt(hex.slice(0, 2), 16) / 255;
      var g = parseInt(hex.slice(2, 4), 16) / 255;
      var b = parseInt(hex.slice(4, 6), 16) / 255;
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      var l = (max + min) / 2;
      var h = 0;
      var s = 0;
      if (max !== min) {
        var dd = max - min;
        s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
        if (max === r) h = (g - b) / dd + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / dd + 2;
        else h = (r - g) / dd + 4;
        h /= 6;
      }
      l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
      function hue(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }
      var rr;
      var gg;
      var bb;
      if (s === 0) { rr = gg = bb = l; }
      else {
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        rr = hue(p, q, h + 1 / 3);
        gg = hue(p, q, h);
        bb = hue(p, q, h - 1 / 3);
      }
      function to(x) { var n = Math.round(x * 255).toString(16); return n.length < 2 ? '0' + n : n; }
      return (to(rr) + to(gg) + to(bb)).toUpperCase();
    }

    function renderXlsx(zip) {
      function text(path) {
        var f = zip.file(path);
        return f ? f.async('string') : Promise.resolve(null);
      }
      function parse(str) {
        return str ? new DOMParser().parseFromString(str, 'application/xml') : null;
      }
      function all(root, name) {
        return root ? Array.prototype.slice.call(root.getElementsByTagNameNS('*', name)) : [];
      }
      function kids(node, name) {
        var out = [];
        if (!node) return out;
        for (var n = node.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 1 && (!name || n.localName === name)) out.push(n);
        }
        return out;
      }
      function first(node, name) { return kids(node, name)[0] || null; }
      function attr(node, name, dflt) {
        if (!node) return dflt;
        var v = node.getAttribute(name);
        return v == null ? dflt : v;
      }
      function colIndex(ref) {
        var letters = /^[A-Z]+/i.exec(ref)[0].toUpperCase();
        var n = 0;
        for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
        return n - 1;
      }
      function rowIndex(ref) { return parseInt(/\d+/.exec(ref)[0], 10) - 1; }

      return Promise.all([
        text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml'), text('xl/styles.xml'), text('xl/theme/theme1.xml')
      ]).then(function (res) {
        var wb = parse(res[0]);
        var rels = parse(res[1]);
        var sst = parse(res[2]);
        var styles = parse(res[3]);
        var theme = parse(res[4]);
        if (!wb) throw new Error('Not a workbook');

        var d1904 = attr(first(wb.documentElement, 'workbookPr'), 'date1904', '0') === '1' || attr(first(wb.documentElement, 'workbookPr'), 'date1904', '') === 'true';
        var relMap = {};
        all(rels, 'Relationship').forEach(function (r) { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });

        var strings = all(sst, 'si').map(function (si) {
          return all(si, 't').filter(function (t) { return t.parentNode.localName !== 'rPh'; }).map(function (t) { return t.textContent; }).join('');
        });

        var themeColors = [];
        var scheme = all(theme, 'clrScheme')[0];
        if (scheme) {
          kids(scheme).forEach(function (n) {
            var c = kids(n)[0];
            if (!c) { themeColors.push('000000'); return; }
            themeColors.push((c.getAttribute('val') && c.localName === 'srgbClr' ? c.getAttribute('val') : (c.getAttribute('lastClr') || '000000')).toUpperCase());
          });
        }
        function themeIdx(i) {
          var map = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9];
          return themeColors[map[i]] || '000000';
        }
        function color(node) {
          if (!node) return null;
          var rgb = node.getAttribute('rgb');
          if (rgb) return '#' + rgb.slice(-6);
          var th = node.getAttribute('theme');
          if (th != null) return '#' + applyTint(themeIdx(parseInt(th, 10)), parseFloat(node.getAttribute('tint') || '0'));
          var ix = node.getAttribute('indexed');
          if (ix != null) {
            var n = parseInt(ix, 10);
            return '#' + (INDEXED[n] || '000000');
          }
          if (node.getAttribute('auto') === '1') return '#000000';
          return null;
        }

        var numFmts = {};
        all(styles, 'numFmt').forEach(function (n) { numFmts[n.getAttribute('numFmtId')] = n.getAttribute('formatCode'); });
        var fontsEl = all(styles, 'fonts')[0];
        var fonts = kids(fontsEl, 'font').map(function (f) {
          var b = first(f, 'b');
          var i = first(f, 'i');
          var u = first(f, 'u');
          return {
            bold: !!b && attr(b, 'val', '1') !== '0',
            italic: !!i && attr(i, 'val', '1') !== '0',
            underline: !!u && attr(u, 'val', 'single') !== 'none',
            strike: !!first(f, 'strike'),
            size: parseFloat(attr(first(f, 'sz'), 'val', '11')),
            color: color(first(f, 'color')),
            name: attr(first(f, 'name'), 'val', '')
          };
        });
        var fillsEl = all(styles, 'fills')[0];
        var fills = kids(fillsEl, 'fill').map(function (f) {
          var p = first(f, 'patternFill');
          if (!p) return null;
          var type = p.getAttribute('patternType');
          if (type === 'solid') return color(first(p, 'fgColor'));
          return null;
        });
        var bordersEl = all(styles, 'borders')[0];
        var borders = kids(bordersEl, 'border').map(function (b) {
          var o = {};
          ['left', 'right', 'top', 'bottom'].forEach(function (side) {
            var s = first(b, side);
            var style = s && s.getAttribute('style');
            if (!style) { o[side] = null; return; }
            var map = {
              thin: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', dotted: '1px dotted', double: '3px double',
              hair: '1px dotted', mediumDashed: '2px dashed', dashDot: '1px dashed', mediumDashDot: '2px dashed', dashDotDot: '1px dashed',
              mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed'
            };
            o[side] = (map[style] || '1px solid') + ' ' + (color(first(s, 'color')) || '#000');
          });
          return o;
        });
        var xfsEl = all(styles, 'cellXfs')[0];
        var xfs = kids(xfsEl, 'xf').map(function (x) {
          var al = first(x, 'alignment');
          return {
            numFmtId: attr(x, 'numFmtId', '0'),
            font: fonts[parseInt(attr(x, 'fontId', '0'), 10)] || fonts[0] || {},
            fill: fills[parseInt(attr(x, 'fillId', '0'), 10)] || null,
            border: borders[parseInt(attr(x, 'borderId', '0'), 10)] || {},
            h: attr(al, 'horizontal', ''),
            v: attr(al, 'vertical', ''),
            wrap: attr(al, 'wrapText', '0') === '1' || attr(al, 'wrapText', '') === 'true',
            indent: parseInt(attr(al, 'indent', '0'), 10) || 0
          };
        });
        function fmtCode(id) {
          if (numFmts[id] != null) return numFmts[id];
          if (BUILTIN[id] != null) return BUILTIN[id];
          return 'General';
        }

        var sheets = all(wb, 'sheet').map(function (s) {
          var rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
          var target = relMap[rid] || '';
          target = target.replace(/^\//, '');
          if (target && target.indexOf('xl/') !== 0) target = 'xl/' + target;
          return { name: s.getAttribute('name'), state: s.getAttribute('state') || 'visible', path: target };
        }).filter(function (s) { return s.state === 'visible' && s.path; });

        return Promise.all(sheets.map(function (s) { return text(s.path); })).then(function (xmls) {
          var out = [];
          sheets.forEach(function (sheet, si) {
            var doc = parse(xmls[si]);
            if (!doc) return;
            var root = doc.documentElement;
            var fmtPr = first(root, 'sheetFormatPr');
            var defRowPx = Math.round(parseFloat(attr(fmtPr, 'defaultRowHeight', '15')) * 96 / 72);
            var defColW = attr(fmtPr, 'defaultColWidth', null);
            var defColPx = defColW ? Math.round(parseFloat(defColW) * 7) : 64;
            var colDefs = {};
            var colsEl = first(root, 'cols');
            kids(colsEl, 'col').forEach(function (c) {
              var min = parseInt(c.getAttribute('min'), 10);
              var max = Math.min(parseInt(c.getAttribute('max'), 10), min + 200);
              for (var k = min; k <= max; k++) {
                colDefs[k - 1] = { px: Math.round(parseFloat(attr(c, 'width', '9.14')) * 7), hidden: attr(c, 'hidden', '0') === '1' || attr(c, 'hidden', '') === 'true' };
              }
            });
            var cells = {};
            var rowInfo = {};
            var maxR = -1;
            var maxC = -1;
            var sheetData = first(root, 'sheetData');
            kids(sheetData, 'row').forEach(function (row, rowPos) {
              var r = row.getAttribute('r') ? parseInt(row.getAttribute('r'), 10) - 1 : rowPos;
              rowInfo[r] = {
                px: row.getAttribute('ht') ? Math.round(parseFloat(row.getAttribute('ht')) * 96 / 72) : null,
                hidden: attr(row, 'hidden', '0') === '1' || attr(row, 'hidden', '') === 'true'
              };
              var colPos = 0;
              kids(row, 'c').forEach(function (c) {
                var ref = c.getAttribute('r');
                var ci = ref ? colIndex(ref) : colPos;
                colPos = ci + 1;
                var t = c.getAttribute('t');
                var vEl = first(c, 'v');
                var raw = vEl ? vEl.textContent : null;
                var val = null;
                var kind = 'n';
                if (t === 's' && raw != null) { val = strings[parseInt(raw, 10)] || ''; kind = 's'; }
                else if (t === 'inlineStr') { val = all(c, 't').map(function (x) { return x.textContent; }).join(''); kind = 's'; }
                else if (t === 'str') { val = raw == null ? '' : raw; kind = 's'; }
                else if (t === 'b') { val = raw === '1' ? 'TRUE' : 'FALSE'; kind = 'b'; }
                else if (t === 'e') { val = raw || ''; kind = 'e'; }
                else if (raw != null && raw !== '') { val = parseFloat(raw); kind = 'n'; }
                var sIdx = parseInt(c.getAttribute('s') || '0', 10);
                (cells[r] = cells[r] || {})[ci] = { v: val, kind: kind, s: sIdx };
                if (r > maxR) maxR = r;
                if (ci > maxC) maxC = ci;
              });
            });
            var merges = {};
            var covered = {};
            kids(first(root, 'mergeCells'), 'mergeCell').forEach(function (m) {
              var parts = m.getAttribute('ref').split(':');
              if (parts.length < 2) return;
              var r0 = rowIndex(parts[0]);
              var c0 = colIndex(parts[0]);
              var r1 = rowIndex(parts[1]);
              var c1 = colIndex(parts[1]);
              merges[r0 + ',' + c0] = { rs: r1 - r0 + 1, cs: c1 - c0 + 1, r1: r1, c1: c1 };
              for (var rr = r0; rr <= r1; rr++) {
                for (var cc = c0; cc <= c1; cc++) {
                  if (rr !== r0 || cc !== c0) covered[rr + ',' + cc] = true;
                }
              }
              if (r1 > maxR) maxR = r1;
              if (c1 > maxC) maxC = c1;
            });
            maxR = Math.min(maxR, 3000);
            maxC = Math.min(maxC, 200);
            if (maxR < 0 || maxC < 0) return;

            var gridOff = attr(first(first(root, 'sheetViews'), 'sheetView'), 'showGridLines', '1') === '0';
            var widths = [];
            var total = 0;
            for (var ci2 = 0; ci2 <= maxC; ci2++) {
              var cd = colDefs[ci2];
              var w = cd ? (cd.hidden ? 0 : cd.px) : defColPx;
              widths.push(w);
              total += w;
            }
            var html = '<table class="bv-x' + (gridOff ? '' : ' bv-grid') + '" style="width:' + total + 'px"><colgroup>' +
              widths.map(function (w) { return w ? '<col style="width:' + w + 'px">' : '<col style="width:0;visibility:collapse">'; }).join('') + '</colgroup><tbody>';
            for (var r = 0; r <= maxR; r++) {
              var info = rowInfo[r] || {};
              if (info.hidden) continue;
              var hpx = info.px || defRowPx;
              html += '<tr style="height:' + hpx + 'px">';
              for (var c = 0; c <= maxC; c++) {
                if (covered[r + ',' + c]) continue;
                if (!widths[c]) continue;
                var cell = (cells[r] || {})[c];
                var xf = xfs[cell ? cell.s : 0] || xfs[0] || { font: {}, border: {} };
                var mg = merges[r + ',' + c];
                var css = [];
                var f = xf.font || {};
                if (f.name) css.push("font-family:'" + f.name.replace(/['"]/g, '') + "',Arial,Helvetica,sans-serif");
                if (f.size) css.push('font-size:' + (Math.round(f.size * 96 / 72 * 10) / 10) + 'px');
                if (f.bold) css.push('font-weight:700');
                if (f.italic) css.push('font-style:italic');
                var deco = [];
                if (f.underline) deco.push('underline');
                if (f.strike) deco.push('line-through');
                if (deco.length) css.push('text-decoration:' + deco.join(' '));
                if (f.color) css.push('color:' + f.color);
                if (xf.fill) css.push('background:' + xf.fill);
                var bd = xf.border || {};
                var right = bd.right;
                var bottom = bd.bottom;
                if (mg) {
                  var tr = (cells[r] || {})[mg.c1];
                  var bl = (cells[mg.r1] || {})[c];
                  var trx = tr ? xfs[tr.s] : null;
                  var blx = bl ? xfs[bl.s] : null;
                  if (trx && trx.border && trx.border.right) right = trx.border.right;
                  if (blx && blx.border && blx.border.bottom) bottom = blx.border.bottom;
                }
                if (bd.left) css.push('border-left:' + bd.left);
                if (right) css.push('border-right:' + right);
                if (bd.top) css.push('border-top:' + bd.top);
                if (bottom) css.push('border-bottom:' + bottom);
                var hal = xf.h;
                if (!hal || hal === 'general') {
                  hal = cell && cell.kind === 'n' && cell.v != null ? 'right' : (cell && (cell.kind === 'b' || cell.kind === 'e') ? 'center' : 'left');
                }
                if (hal === 'centerContinuous') hal = 'center';
                if (hal === 'fill' || hal === 'distributed' || hal === 'justify') hal = 'left';
                css.push('text-align:' + hal);
                if (xf.indent) css.push('padding-' + (hal === 'right' ? 'right' : 'left') + ':' + (xf.indent * 9 + 3) + 'px');
                css.push('vertical-align:' + (xf.v === 'center' ? 'middle' : (xf.v === 'top' ? 'top' : 'bottom')));
                css.push(xf.wrap ? 'white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere' : 'white-space:nowrap');
                var textOut = '';
                if (cell && cell.v != null) {
                  textOut = cell.kind === 'n' ? formatValue(cell.v, fmtCode(xf.numFmtId), d1904) : cell.v;
                }
                html += '<td' + (mg && mg.rs > 1 ? ' rowspan="' + mg.rs + '"' : '') + (mg && mg.cs > 1 ? ' colspan="' + mg.cs + '"' : '') +
                  ' style="' + css.join(';') + '">' + esc(textOut) + '</td>';
              }
              html += '</tr>';
            }
            html += '</tbody></table>';
            out.push({ name: sheet.name, html: html });
          });
          return out;
        });
      });
    }

    function fitForPrint() {
      var limit = 700;
      Array.prototype.forEach.call(document.querySelectorAll('.bv-xwrap table'), function (t) {
        t.style.zoom = '';
        var w = t.offsetWidth;
        if (w > limit) t.style.zoom = String(limit / w);
      });
    }
    function resetPrint() {
      Array.prototype.forEach.call(document.querySelectorAll('.bv-xwrap table'), function (t) { t.style.zoom = ''; });
    }
    window.addEventListener('beforeprint', fitForPrint);
    window.addEventListener('afterprint', resetPrint);

    dlBtn.addEventListener('click', save);
    prBtn.addEventListener('click', function () {
      if (printer) { printer(); return; }
      window.print();
    });

    if (!S) {
      view.textContent = 'Bill session expired. Please open the bill again.';
      return;
    }
    if (!S.blob) {
      dlBtn.style.display = S.fileName ? '' : 'none';
      if (S.error) {
        view.innerHTML = infoSheet(true) + '<div class="bv-sheet bv-err">' + esc(S.error) + '</div>';
      } else {
        view.innerHTML = infoSheet(true);
      }
      return;
    }

    var name = S.fileName || '';
    var ext = (name.split('.').pop() || '').toLowerCase();
    msg.textContent = 'Loading...';

    function done() { msg.textContent = ''; }
    function fail(text) {
      msg.textContent = '';
      view.innerHTML = '<div class="bv-sheet bv-err">' + esc(text) + ' Use the Download button to open the file.</div>';
    }

    if (ext === 'pdf') {
      var pdfUrl = URL.createObjectURL(new Blob([S.blob], { type: 'application/pdf' }));
      view.className += ' bv-pdfmode';
      view.innerHTML = '<iframe id="bv-frame" class="bv-frame" title="Bill"></iframe>';
      var frame = document.getElementById('bv-frame');
      frame.onload = done;
      frame.src = pdfUrl;
      printer = function () {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (e) {
          window.open(pdfUrl, '_blank');
        }
      };
      setTimeout(done, 1500);
    } else if (ext === 'xlsx' || ext === 'xlsm') {
      readBuffer(S.blob).then(function (buf) { return JSZip.loadAsync(buf); }).then(renderXlsx).then(function (sheetsOut) {
        if (!sheetsOut.length) { fail('This workbook has no visible data.'); return; }
        var html = '';
        sheetsOut.forEach(function (s) {
          html += '<div class="bv-xwrap">' + (sheetsOut.length > 1 ? '<div class="bv-xname">' + esc(s.name) + '</div>' : '') + s.html + '</div>';
        });
        view.innerHTML = html;
        done();
      }).catch(function () { fail('Could not render this spreadsheet.'); });
    } else if (ext === 'docx') {
      readBuffer(S.blob).then(function (buf) {
        view.innerHTML = '';
        var holder = document.createElement('div');
        view.appendChild(holder);
        return docx.renderAsync(new Uint8Array(buf), holder, null, { className: 'docx', inWrapper: true, breakPages: true, ignoreWidth: false, ignoreHeight: false });
      }).then(done).catch(function () { fail('Could not render this document.'); });
    } else if (/^(png|jpe?g|gif|webp|bmp)$/.test(ext)) {
      var imgUrl = URL.createObjectURL(S.blob);
      view.innerHTML = '<div class="bv-sheet bv-imgsheet"><img src="' + imgUrl + '" alt="Bill"></div>';
      done();
    } else {
      fail('Preview is not available for this file type.');
    }
  }

  var STYLE = '' +
    'html,body{margin:0;}' +
    '.inv-bar .inv-pt{font-size:15px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.bv-sheet{background:#fff;max-width:794px;margin:0 auto 14px;padding:28px 36px;box-shadow:0 2px 10px rgba(0,0,0,0.15);box-sizing:border-box;}' +
    '.bv-sheet h1{font-size:20px;margin:0 0 16px;text-align:center;text-transform:uppercase;}' +
    '.bv-row{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #eee;font-size:14px;}' +
    '.bv-label{flex:0 0 130px;font-weight:600;color:#555;}' +
    '.bv-value{flex:1;overflow-wrap:anywhere;}' +
    '.bv-err{color:#a94442;font-size:14px;}' +
    '.bv-imgsheet{text-align:center;}.bv-imgsheet img{max-width:100%;}' +
    '.inv-view.bv-pdfmode{padding:0;}' +
    '.bv-frame{display:block;width:100%;height:calc(100vh - 56px);border:0;background:#fff;}' +
    '.bv-xwrap{background:#fff;margin:0 auto 14px;padding:12px;box-shadow:0 2px 10px rgba(0,0,0,0.15);overflow:auto;box-sizing:border-box;width:fit-content;max-width:calc(100% - 28px);}' +
    '.bv-xname{font-weight:700;font-size:13px;color:#0062C2;margin:0 0 8px;}' +
    'table.bv-x{border-collapse:collapse;table-layout:fixed;font-family:Calibri,Arial,Helvetica,sans-serif;font-size:14.67px;color:#000;background:#fff;}' +
    'table.bv-x td{padding:0 3px;box-sizing:border-box;line-height:1.25;}' +
    'table.bv-x.bv-grid td{outline:1px solid #e3e6ea;outline-offset:-1px;}' +
    '@media print{.bv-sheet{box-shadow:none;max-width:none;padding:0 0 12px;}.bv-xwrap{box-shadow:none;padding:0;overflow:visible;max-width:none;width:auto;margin:0 0 8px;page-break-after:always;}.bv-xwrap:last-child{page-break-after:auto;}table.bv-x.bv-grid td{outline:0;}}';

  function shell(bill, key) {
    var o = window.location.origin;
    var title = bill.title || 'Institute Bill';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title>' +
      '<link rel="stylesheet" href="' + o + '/static/styles/styles.css"><style>' + STYLE + '</style></head><body class="inv-body">' +
      '<div class="inv-bar"><span class="inv-pt">' + esc(title) + '</span><div class="inv-actions"><span id="inv-msg" class="inv-msg"></span><button id="inv-dl" type="button" class="inv-alt">Download</button><button id="inv-pr" type="button">Print</button></div></div>' +
      '<div id="inv-view" class="inv-view"></div>' +
      '<script src="' + o + '/static/script/jszip.min.js"><\/script>' +
      '<script src="' + o + '/static/script/docx-preview.min.js"><\/script>' +
      '<script>(' + popupMain.toString() + ')(' + JSON.stringify(key) + ');<\/script></body></html>';
  }

  function openPopup() {
    var w = Math.min(1100, screen.availWidth || 1100);
    var h = Math.min(950, screen.availHeight || 950);
    var left = Math.max(0, Math.round(((screen.availWidth || w) - w) / 2));
    var top = Math.max(0, Math.round(((screen.availHeight || h) - h) / 2));
    var features = 'popup=yes,toolbar=no,menubar=no,location=no,status=no,resizable=yes,scrollbars=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top;
    var win = window.open('', 'billView_' + Date.now(), features);
    if (win) {
      try {
        win.document.open();
        win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bill</title></head><body style="font-family:Arial,sans-serif;padding:20px;">Loading bill...</body></html>');
        win.document.close();
      } catch (e) {}
    }
    return win;
  }

  async function fetchBill(bill, ctx, file) {
    const res = await fetch(ctx.baseUrl + '/api/institute-bills/' + bill.id + '/download/' + (file ? '?file=' + encodeURIComponent(file.id) : ''), {
      headers: { 'Authorization': 'Token ' + ctx.token }
    });
    if (!res.ok) throw new Error('download failed');
    return res.blob();
  }

  async function open(bill, ctx, file) {
    if (!bill) return;
    if (!file && bill.files && bill.files.length) file = bill.files[0];
    const win = openPopup();
    if (!win) {
      alert('Please allow popups for this site to view the bill');
      return;
    }
    const session = { blob: null, fileName: file ? file.name : '', bill: bill, error: '' };
    if (file) {
      try {
        session.blob = await fetchBill(bill, ctx, file);
      } catch (e) {
        session.error = 'Unable to load the bill file.';
      }
    }
    window.__billViewSessions = window.__billViewSessions || {};
    const key = 'b' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    window.__billViewSessions[key] = session;
    try {
      win.document.open();
      win.document.write(shell(bill, key));
      win.document.close();
      win.focus();
    } catch (e) {
      try { win.close(); } catch (x) {}
    }
  }

  window.BillViewer = { open: open };
})();
