/* ============================================================================
 * ☁️ GDrive Documents for the VAT App
 * ============================================================================
 * New voucher files (invoices, EDs, statements…) are sent to the WhatAnAgent
 * GDrive Service Centre instead of Firebase Storage. Each file lands in
 *   <app folder "VAT APP DOCUMENTS">/<branch name>/<file>
 * so every company / branch keeps its own folder.
 *
 * The connection is saved in the signed-in user's own Firestore document, so
 * every browser and PC picks it up automatically after login. localStorage is
 * kept as a fast local cache (and as a fallback when nobody is signed in).
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

  // Public Firebase config of this app (same values the app itself uses).
  var FIREBASE = {
    apiKey: 'AIzaSyDYcZaB5QheUBRHjfXXKQpcflikamoH_Sc',
    authDomain: 'vatapp-c80ce.firebaseapp.com',
    projectId: 'vatapp-c80ce',
    storageBucket: 'vatapp-c80ce.firebasestorage.app',
    messagingSenderId: '853364981272',
    appId: '1:853364981272:web:72989c32f7e1db4c378d6d'
  };
  var AUTH_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
  var APP_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
  var CLOUD_COLLECTION = 'appSettings';
  var CLOUD_DOC = 'gdrive';

  // ── local cache ───────────────────────────────────────────────────────────
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

  // ── cloud copy (the user's own Firestore document) ────────────────────────
  function cloudUrl(uid) {
    return 'https://firestore.googleapis.com/v1/projects/' + FIREBASE.projectId +
      '/databases/(default)/documents/users/' + encodeURIComponent(uid) +
      '/' + CLOUD_COLLECTION + '/' + CLOUD_DOC;
  }

  async function firebaseAuth() {
    var appMod = await import(APP_SDK);
    var authMod = await import(AUTH_SDK);
    var apps = appMod.getApps ? appMod.getApps() : [];
    var app = apps.length ? apps[0] : appMod.initializeApp(FIREBASE);
    var auth = authMod.getAuth(app);
    return { auth: auth, authMod: authMod, user: auth.currentUser };
  }

  /** The user after Firebase has restored its session (may take a moment). */
  function currentUser(auth, authMod) {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise(function (resolve) {
      var done = false;
      var unsub = authMod.onAuthStateChanged(auth, function (u) {
        if (done) return;
        done = true;
        try { unsub(); } catch (e) { /* ignore */ }
        resolve(u || null);
      });
      setTimeout(function () {
        if (done) return;
        done = true;
        try { unsub(); } catch (e) { /* ignore */ }
        resolve(auth.currentUser || null);
      }, 4000);
    });
  }

  function fieldValue(f) {
    if (!f) return '';
    if (f.stringValue !== undefined) return String(f.stringValue);
    if (f.integerValue !== undefined) return Number(f.integerValue);
    return '';
  }

  async function readCloud() {
    var fb = await firebaseAuth();
    var user = await currentUser(fb.auth, fb.authMod);
    if (!user) return { found: false, reason: 'nobody is signed in' };

    var token = await user.getIdToken();
    var res = await fetch(cloudUrl(user.uid), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
    });
    if (res.status === 404) return { found: false };
    if (!res.ok) throw new Error('could not read your account settings (' + res.status + ')');

    var body = await res.json();
    var f = (body && body.fields) || {};
    var key = String(fieldValue(f.key) || '').trim();
    var serial = String(fieldValue(f.serial) || '').trim();
    if (!key || !serial) return { found: false };

    return {
      found: true,
      cfg: {
        base: String(fieldValue(f.base) || DEFAULTS.base).trim(),
        key: key,
        serial: serial,
        maxMb: Number(fieldValue(f.maxMb)) || DEFAULTS.maxMb
      }
    };
  }

  async function writeCloud(cfg) {
    var fb = await firebaseAuth();
    var user = await currentUser(fb.auth, fb.authMod);
    if (!user) throw new Error('Sign in first, then the key can be saved to your account.');

    var token = await user.getIdToken();
    var body = {
      fields: {
        base: { stringValue: String(cfg.base || DEFAULTS.base) },
        key: { stringValue: String(cfg.key || '') },
        serial: { stringValue: String(cfg.serial || '') },
        maxMb: { integerValue: String(Number(cfg.maxMb) || DEFAULTS.maxMb) },
        updatedAt: { integerValue: String(Date.now()) },
        updatedBy: { stringValue: String(user.email || user.uid) }
      }
    };

    var res = await fetch(cloudUrl(user.uid), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var text = '';
      try { text = await res.text(); } catch (e) { text = ''; }
      throw new Error('could not save to your account (' + res.status + ')' + (text ? ' — ' + text.slice(0, 120) : ''));
    }
    return true;
  }

  /** Pull the account copy into this browser (called at start and on login). */
  async function syncFromCloud() {
    try {
      var remote = await readCloud();
      if (!remote.found) return { ok: true, found: false };
      var local = load();
      if (!isEnabled(local) || local.key !== remote.cfg.key || local.serial !== remote.cfg.serial) {
        save(remote.cfg);
        refreshIndicator();
        return { ok: true, found: true, applied: true };
      }
      return { ok: true, found: true, applied: false };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // ── uploads ───────────────────────────────────────────────────────────────
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
    toast('☁️ ' + file.name + ' saved to Google Drive — ' +
      (body.folder ? 'VAT APP DOCUMENTS / ' + body.folder : 'VAT APP DOCUMENTS'));
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

  // ── small UI pieces ───────────────────────────────────────────────────────
  function el(tag, css, html) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (html != null) node.innerHTML = html;
    return node;
  }

  var toastTimer = null;
  function toast(text) {
    try {
      var old = document.getElementById('vat-gdrive-toast');
      if (old) old.remove();
      var box = el('div', 'position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:99999;' +
        'max-width:min(560px,92vw);padding:10px 14px;border-radius:10px;background:#0f172a;color:#e2f5ec;' +
        'border:1px solid rgba(16,185,129,.55);box-shadow:0 12px 34px rgba(0,0,0,.3);' +
        'font:12.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-weight:600;text-align:center');
      box.id = 'vat-gdrive-toast';
      box.textContent = text;                       // a file name is text, never markup
      document.body.appendChild(box);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { if (box.parentNode) box.remove(); }, 4500);
    } catch (e) { /* a toast must never break the save */ }
  }

  function bannerHidden() {
    try { return sessionStorage.getItem('vat_gdrive_banner_hidden') === '1'; } catch (e) { return false; }
  }

  function refreshIndicator() {
    var banner = document.getElementById('vat-gdrive-banner');
    if (isEnabled() || bannerHidden()) {
      if (banner) banner.remove();
      return;
    }
    if (banner) return;
    if (!document.body) return;

    banner = el('div', 'position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:99998;' +
      'display:flex;align-items:center;gap:10px;max-width:min(700px,94vw);padding:10px 12px;' +
      'background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);' +
      'font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#78350f');
    banner.id = 'vat-gdrive-banner';

    banner.appendChild(el('div', '', '<b>Google Drive is not connected in this browser.</b> ' +
      'New voucher files are still being saved to Firebase Storage — connect Drive to send them to ' +
      '<b>VAT APP DOCUMENTS</b> instead.'));

    var connectBtn = el('button', 'margin-left:auto;padding:7px 11px;border-radius:9px;border:none;' +
      'background:#4f46e5;color:#fff;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap', 'Connect Drive');
    connectBtn.type = 'button';
    connectBtn.onclick = function () { openSettings(); };
    banner.appendChild(connectBtn);

    var closeBtn = el('button', 'padding:4px 8px;border-radius:8px;border:1px solid #fcd34d;' +
      'background:transparent;color:#92400e;font-size:12px;cursor:pointer', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Hide for this session';
    closeBtn.onclick = function () {
      try { sessionStorage.setItem('vat_gdrive_banner_hidden', '1'); } catch (e) { /* ignore */ }
      banner.remove();
    };
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);
  }

  // ── settings panel ────────────────────────────────────────────────────────
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
      'The key is saved to your account, so every device picks it up after you sign in.</p></div>');
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

    var baseInput = field('Service URL', el('input', fieldCss));
    baseInput.value = cfg.base;
    baseInput.placeholder = DEFAULTS.base;

    var keyInput = field('API key (gdk_…)', el('input', fieldCss));
    keyInput.type = 'password';
    keyInput.value = cfg.key;
    keyInput.placeholder = 'gdk_…';

    var serialInput = field('Client serial (gdc_…)', el('input', fieldCss));
    serialInput.value = cfg.serial;
    serialInput.placeholder = 'gdc_…';

    var status = el('div', 'display:none', '');
    card.appendChild(status);

    var row = el('div', 'display:flex;gap:8px;justify-content:flex-end;margin-top:18px', '');
    var pullBtn = el('button', btnCss, 'Load from my account');
    var testBtn = el('button', btnCss, 'Test connection');
    var saveBtn = el('button', primaryCss, 'Save');
    row.appendChild(pullBtn);
    row.appendChild(testBtn);
    row.appendChild(saveBtn);
    card.appendChild(row);

    card.appendChild(el('div', 'margin-top:12px;font-size:11px;color:#94a3b8;line-height:1.5',
      'The key is stored in your own account (Firestore) and cached in this browser. ' +
      'Create or rotate it on the GDrive Service Centre page → API clients.'));

    wrap.appendChild(card);
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (ev) { if (ev.target === wrap) closePanel(); });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { closePanel(); document.removeEventListener('keydown', esc); }
    });

    function draft() {
      return { base: baseInput.value, key: keyInput.value, serial: serialInput.value, maxMb: cfg.maxMb };
    }

    pullBtn.onclick = async function () {
      pullBtn.disabled = true;
      setStatus(status, 'Reading your account…', '');
      try {
        var remote = await readCloud();
        if (!remote.found) {
          setStatus(status, 'No key saved in your account yet. Paste it here once and press Save.', '');
        } else {
          save(remote.cfg);
          baseInput.value = remote.cfg.base;
          keyInput.value = remote.cfg.key;
          serialInput.value = remote.cfg.serial;
          refreshIndicator();
          setStatus(status, '✅ Loaded from your account.', 'ok');
        }
      } catch (e) {
        setStatus(status, '❌ ' + ((e && e.message) || e), 'bad');
      } finally {
        pullBtn.disabled = false;
      }
    };

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

    saveBtn.onclick = async function () {
      var next = draft();
      if (!next.key || !next.serial) {
        setStatus(status, 'Both the API key and the client serial are required.', 'bad');
        return;
      }
      save(next);
      refreshIndicator();
      saveBtn.disabled = true;
      setStatus(status, 'Saving to your account…', '');
      try {
        await writeCloud(next);
        setStatus(status, '✅ Saved to your account. Every device gets it after sign-in; this browser already uses it.', 'ok');
      } catch (e) {
        setStatus(status, 'Saved in this browser only. ' + ((e && e.message) || e), 'bad');
      } finally {
        saveBtn.disabled = false;
      }
    };

    // Show where the current value came from.
    setStatus(status, isEnabled(cfg) ? 'This browser is connected.' : 'Not connected in this browser yet.', '');
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

  // ── boot ──────────────────────────────────────────────────────────────────
  function boot() {
    injectMenuItem();
    refreshIndicator();

    // Another device may already have saved the key: take it from the account.
    syncFromCloud();

    // …and take it as soon as this browser signs in.
    (async function watchSignIn() {
      try {
        var fb = await firebaseAuth();
        fb.authMod.onAuthStateChanged(fb.auth, function (user) {
          if (user) syncFromCloud();
          else refreshIndicator();
        });
      } catch (e) { /* offline or SDK blocked: the local copy still works */ }
    })();

    var tries = 0;
    var timer = setInterval(function () {
      injectMenuItem();
      refreshIndicator();
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
    openSettings: openSettings,
    syncFromCloud: syncFromCloud,
    readCloud: readCloud,
    writeCloud: writeCloud
  };
})();
