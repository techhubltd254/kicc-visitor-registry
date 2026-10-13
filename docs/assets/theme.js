/* =====================================================================
   Runtime theme + config loader.
   Reads window.KICC_CONFIG (written by public/assets/config.js, which the
   build generates from config/event.config.json) and pushes the brand
   colours into CSS custom properties, so one config file re-skins the
   whole site including the badge, the scanner and the poster.
   ===================================================================== */
(function () {
  var cfg = window.KICC_CONFIG || null;
  window.KICC = window.KICC || {};

  if (!cfg) {
    console.warn('[KICC] config.js not loaded — falling back to default brand tokens.');
    window.KICC.config = null;
    return;
  }

  var MAP = {
    red: '--red',
    redDark: '--red-dark',
    redSoft: '--red-soft',
    gold: '--gold',
    goldSoft: '--gold-soft',
    navy: '--navy',
    navySoft: '--navy-soft',
    ink: '--ink',
    muted: '--muted',
    line: '--line',
    bg: '--bg',
    ok: '--ok'
  };

  var root = document.documentElement;
  var brand = cfg.brand || {};
  Object.keys(MAP).forEach(function (k) {
    if (brand[k]) root.style.setProperty(MAP[k], brand[k]);
  });

  document.title = cfg.site.name + ' | ' + cfg.site.organisation;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', brand.navy || '#0B2536');

  window.KICC.config = cfg;

  /* ---------- shared helpers ---------- */

  window.KICC.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  window.KICC.fmtDate = function (iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).replace(' ', 'T') + (String(iso).indexOf('Z') > -1 ? '' : 'Z'));
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  window.KICC.toast = function (msg) {
    var t = document.getElementById('toast');
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 3200);
  };

  window.KICC.api = async function (path, options) {
    var opt = options || {};
    var headers = { 'content-type': 'application/json' };
    var token = sessionStorage.getItem('kicc_admin_token');
    if (token) headers['x-admin-token'] = token;
    var res = await fetch(path, {
      method: opt.method || 'GET',
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && token) {
      sessionStorage.removeItem('kicc_admin_token');
      window.location.reload();
    }
    return { ok: res.ok, status: res.status, data: data || {} };
  };

  /* ---------- header + footer are generated from config ---------- */
  window.KICC.renderChrome = function (active) {
    var s = cfg.site;
    var header = document.querySelector('[data-kicc-header]');
    if (header) {
      header.innerHTML =
        '<div class="wrap topbar-inner">' +
          '<a class="brand" href="/kicc-visitor-registry/" style="text-decoration:none">' +
            '<img src="' + window.KICC.esc(s.logo) + '" alt="' + window.KICC.esc(s.shortName) + ' logo">' +
            '<span class="brand-txt"><strong>' + window.KICC.esc(s.organisation) + '</strong>' +
            '<em>' + window.KICC.esc(s.tagline) + '</em></span>' +
          '</a>' +
          '<nav class="topnav">' +
            '<a href="/kicc-visitor-registry/"' + (active === 'register' ? ' aria-current="page"' : '') + '>Register</a>' +
            '<a href="/kicc-visitor-registry/badge.html"' + (active === 'badge' ? ' aria-current="page"' : '') + '>My badge</a>' +
            '<a href="/kicc-visitor-registry/checkin.html"' + (active === 'checkin' ? ' aria-current="page"' : '') + '>Door check-in</a>' +
            '<a href="/kicc-visitor-registry/admin.html"' + (active === 'admin' ? ' aria-current="page"' : '') + '>Organiser</a>' +
          '</nav>' +
        '</div>';
    }
    var foot = document.querySelector('[data-kicc-footer]');
    if (foot) {
      foot.innerHTML =
        '<div class="wrap">' +
          '<div><strong>' + window.KICC.esc(s.organisation) + '</strong><br>' + window.KICC.esc(s.address) + '</div>' +
          '<div><em>' + window.KICC.esc(s.tagline) + '</em><br>&copy; ' + new Date().getFullYear() + ' ' +
          window.KICC.esc(s.shortName) + ' &middot; ' + window.KICC.esc(s.name) + '</div>' +
        '</div>';
    }
  };
})();
