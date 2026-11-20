/* ============================================================================
 * ☁️ GDrive Documents for the VAT App
 * ============================================================================
 * New voucher files (invoices, EDs, statements…) are sent to the WhatAnAgent
 * GDrive Service Centre instead of Firebase Storage. Each file lands in
 *   <app folder "VAT APP DOCUMENTS">/<branch name>/<file>
 * so every company / branch keeps its own folder.
 *
 * The API key is entered once in Settings → GDrive Documents and kept in this
 * browser only (localStorage). It is never written into the page source.
 *
 * Old documents already in Firebase Storage are untouched and still open as
 * before; only uploads made from now on use this service.
 * ==========================================================================*/
(function () {
  'use strict';

  var CFG_KEY = 'vat_gdrive_cfg_v1';
  var DEFAULTS = {
    base: 'https://whatanagent.duckdns.org',
    key: '',
    serial: '',
    maxMb: 25
  };

  function load() {
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { cfg = {}; }
    return {
      base: String(cfg.base || DEFAULTS.base).trim(),
      key: String(cfg.key || '').trim(),
      serial: String(cfg.serial || '').trim(),
      maxMb: Number(cfg.maxMb) || DEFAULTS.maxMb
    };
  }

  function save(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify({
      base: String(cfg.base || DEFAULTS.base).trim(),
      key: String(cfg.key || '').trim(),
      serial: String(cfg.serial || '').trim(),
      maxMb: Number(cfg.maxMb) || DEFAULTS.maxMb
    }));
  }

  function apiBase(cfg) {
    return String(cfg.base || DEFAULTS.base).replace(/\/+$/, '') + '/api/v1/gdrive';
  }

  function isEnabled(cfg) {
    var c = cfg || load();
    return !!(c.base && c.key && c.serial);
  }

  function maxBytes() {
    return Math.round((Number(load().maxMb) || DEFAULTS.maxMb) * 1024 * 1024);
  }

  function authHeaders(cfg) {
    return { 'x-api-key': cfg.key, 'x-client-serial': cfg.serial };
  }

  /**
   * Upload one File. Returns { file_uuid, url, folder, name, size, status }.
   * `url` is a signed link that opens in a browser without any headers.
   */
  async function upload(file, opts) {
    var cfg = load();
    if (!isEnabled(cfg)) {
      throw new Error('GDrive Service is not set up yet. Open Settings → GDrive Documents and paste the API key.');
    }
    var limit = maxBytes();
    if (file.size > limit) {
      throw new Error('File "' + file.name + '" is too large for the Drive service (max ' +
        Math.round(limit / 1024 / 1024) + ' MB).');
    }

    var branch = String((opts && opts.branch) || '').replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim();

    var form = new FormData();
    form.append('file', file, file.name);
    if (branch) form.append('folder', branch);

    var res = await fetch(apiBase(cfg) + '/file', {
      method: 'POST',
      headers: authHeaders(cfg),
      body: form
    });

    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }

    if (!res.ok || !body || body.ok !== true) {
      var message = (body && body.error) || ('Upload failed (HTTP ' + res.status + ')');
      throw new Error(message);
    }
    return body;
  }

  /** Ask the service who this key belongs to (used by Test connection). */
  async function me(cfgOverride) {
    var cfg = cfgOverride || load();
    if (!cfg.key || !cfg.serial) throw new Error('Paste the API key and the client serial first.');
    var res = await fetch(apiBase(cfg) + '/me', { headers: authHeaders(cfg) });
    var body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok || !body || body.ok !== true) {
      throw new Error((body && body.error) || ('Connection failed (HTTP ' + res.status + ')'));
    }
    return body;
  }

  // ── settings panel ────────────────────────────────────────────────────────
  function el(tag, css, html) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (html != null) node.innerHTML = html;
    return node;
  }

  var fieldCss = 'display:block;width:100%;margin-top:5px;padding:9px 11px;border:1px solid #cbd5e1;' +
    'border-radius:9px;font-size:13px;color:#0f172a;background:#f8fafc;outline:none';
  var labelCss = 'display:block;font-size:11.5px;font-weight:700;color:#475569;margin-top:12px;letter-spacing:.02em';
  var btnCss = 'padding:9px 14px;border-radius:9px;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155';
  var primaryCss = 'padding:9px 14px;border-radius:9px;font-size:12.5px;font-weight:700;cursor:pointer;border:none;background:#4f46e5;color:#fff';

  function closePanel() {
    var old = document.getElementById('vat-gdrive-panel');
    if (old) old.remove();
  }

  function setStatus(host, text, kind) {
    if (!host) return;
    host.textContent = text || '';
    host.style.cssText = 'margin-top:12px;font-size:12px;line-height:1.5;padding:9px 11px;border-radius:9px;white-space:pre-line;' +
      (kind === 'ok' ? 'background:#ecfdf5;color:#047857;border:1px solid #a7f3d0'
        : kind === 'bad' ? 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca'
        : 'background:#f1f5f9;color:#475569;border:1px solid #e2e8f0');
    host.style.display = text ? 'block' : 'none';
  }

  function openSettings() {
    closePanel();
    var cfg = load();

    var wrap = el('div', 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(15,23,42,.55);padding:16px;overflow:auto', '');
    wrap.id = 'vat-gdrive-panel';

    var card = el('div', 'width:100%;max-width:560px;background:#fff;border-radius:16px;padding:22px 22px 18px;' +
      'box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:inherit');

    var head = el('div', 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px',
      '<div><h3 style="margin:0;font-size:18px;font-weight:800;color:#0f172a">☁️ GDrive Documents</h3>' +
      '<p style="margin:6px 0 0;font-size:12.5px;color:#64748b;line-height:1.5">New invoice / ED files are saved to the WhatAnAgent ' +
      'GDrive service, filed under your branch folder inside <b>VAT APP DOCUMENTS</b>. ' +
      'Documents already in Firebase Storage stay where they are.</p></div>');
    var closeBtn = el('button', btnCss + ';padding:4px 10px', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    closeBtn.onclick = closePanel;
    head.appendChild(closeBtn);
    card.appendChild(head);

    function field(labelText, inputEl) {
      var label = el('label', labelCss, labelText);
      label.appendChild(inputEl);
      card.appendChild(label);
      return inputEl;
    }

    var baseInput = field('Service URL',
      el('input', fieldCss)); baseInput.value = cfg.base; baseInput.placeholder = DEFAULTS.base;
    var keyInput = field('API key (gdk_…)',
      el('input', fieldCss)); keyInput.type = 'password'; keyInput.value = cfg.key; keyInput.placeholder = 'gdk_…';
    var serialInput = field('Client serial (gdc_…)',
      el('input', fieldCss)); serialInput.value = cfg.serial; serialInput.placeholder = 'gdc_…';

    var status = el('div', 'display:none', '');
    card.appendChild(status);

    var row = el('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:18px', '');
    var testBtn = el('button', btnCss, 'Test connection');
    var saveBtn = el('button', primaryCss, 'Save');
    row.appendChild(testBtn);
    row.appendChild(saveBtn);
    card.appendChild(row);

    var footer = el('div', 'margin-top:12px;font-size:11px;color:#94a3b8;line-height:1.5',
      'Stored in this browser only. Create or rotate the key on the GDrive Service Centre page → API clients.');
    card.appendChild(footer);

    wrap.appendChild(card);
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) closePanel(); });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { closePanel(); document.removeEventListener('keydown', esc); }
    });

    function draft() {
      return { base: baseInput.value, key: keyInput.value, serial: serialInput.value, maxMb: cfg.maxMb };
    }

    testBtn.onclick = async function () {
      testBtn.disabled = true;
      setStatus(status, 'Contacting the service…', '');
      try {
        var info = await me(draft());
        var c = info.client || {};
        var d = info.drive || {};
        var folders = (info.subfolders || []).length;
        setStatus(status,
          '✅ Connected as "' + (c.name || 'client') + '" — folder: ' + (c.folder_name || c.folder_id || '—') +
          (d.email ? ' · drive: ' + d.email : '') +
          ' · scope: ' + (c.scope || '') +
          '\nBranch folders already created: ' + folders, 'ok');
      } catch (e) {
        setStatus(status, '❌ ' + (e && e.message ? e.message : e), 'bad');
      } finally {
        testBtn.disabled = false;
      }
    };

    saveBtn.onclick = function () {
      var next = draft();
      if (!next.key || !next.serial) {
        setStatus(status, 'Both the API key and the client serial are required.', 'bad');
        return;
      }
      save(next);
      setStatus(status, '✅ Saved in this browser. New voucher files will now go to Google Drive.', 'ok');
    };
  }

  // ── settings menu entry ───────────────────────────────────────────────────
  function injectMenuItem() {
    var menu = document.getElementById('management-menu');
    if (!menu || document.getElementById('gdrive-settings-link')) return;

    var link = document.createElement('a');
    link.href = '#';
    link.id = 'gdrive-settings-link';
    link.className = 'flex items-center px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10 hover:text-white transition';
    link.innerHTML = '<i class="fas fa-cloud w-5 text-center mr-2 text-sky-300"></i>GDrive Documents';
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      openSettings();
    });

    var restore = null;
    Array.prototype.forEach.call(menu.querySelectorAll('a'), function (a) {
      if (/Restore from Backup/i.test(a.textContent || '')) restore = a;
    });
    if (restore) menu.insertBefore(link, restore.previousElementSibling || restore);
    else menu.appendChild(link);
  }

  function boot() {
    injectMenuItem();
    var tries = 0;
    var timer = setInterval(function () {
      injectMenuItem();
      if (++tries > 20 || document.getElementById('gdrive-settings-link')) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.VatGDrive = {
    load: load,
    save: save,
    isEnabled: isEnabled,
    maxBytes: maxBytes,
    upload: upload,
    me: me,
    openSettings: openSettings
  };
})();
