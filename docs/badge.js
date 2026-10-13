/* =====================================================================
   Delegate QR badge page — /badge.html?t=<token>  or  ?id=<regId>
   Renders a printable badge and (optionally) a full A4 sheet of badges
   for the organiser to hand out at the desk.
   ===================================================================== */
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('t') || '';
  var id = params.get('id') || '';
  var qs = token ? 't=' + encodeURIComponent(token) : 'id=' + encodeURIComponent(id);

  function badgeCard(d, tokenForQr) {
    var qrSvg = '';
    try {
      var qr = qrcode(0, 'M');
      qr.addData(tokenForQr);
      qr.make();
      qrSvg = qr.createSvgTag({ cellSize: 5, margin: 1 });
    } catch (e) { qrSvg = ''; }

    return '' +
      '<div class="badge">' +
        '<div class="badge-head">' +
          '<strong>' + window.KICC.esc(window.KICC.config.site.organisation) + '</strong>' +
          '<em>' + window.KICC.esc(window.KICC.config.site.tagline) + '</em>' +
        '</div>' +
        '<div class="badge-body">' +
          '<p class="name">' + window.KICC.esc(d.name) + '</p>' +
          '<p class="role">' + window.KICC.esc(d.category) + '</p>' +
          '<div class="badge-qr qr-holder">' + qrSvg + '</div>' +
          '<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;color:var(--navy);font-size:16px;letter-spacing:1px">' + window.KICC.esc(d.id) + '</div>' +
          '<p class="ev">' + window.KICC.esc(d.event) + '<br>' + window.KICC.esc(d.eventDates || '') +
            (d.venue ? ' &middot; ' + window.KICC.esc(d.venue) : '') + '</p>' +
        '</div>' +
        '<div class="badge-foot">' +
          '<span>' + window.KICC.esc(d.org || d.country || 'Delegate') + '</span>' +
          '<span>' + (d.checkedIn ? 'Checked in ' + window.KICC.esc(window.KICC.fmtDate(d.checkedInAt)) : 'Not yet checked in') + '</span>' +
        '</div>' +
      '</div>';
  }

  async function load() {
    var host = document.getElementById('badgeHost');
    if (!qs || qs === 'id=') {
      host.innerHTML = '<div class="note info">Open this page from the link in your confirmation email, or enter your registration number on the <a href="/kicc-visitor-registry/">registration page</a>.</div>';
      return;
    }
    var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/badge?' + qs);
    if (!res.ok) {
      host.innerHTML = '<div class="note red"><strong>Badge not found.</strong> ' +
        window.KICC.esc((res.data && res.data.error) || 'Please check the link or scan the QR code again.') + '</div>';
      return;
    }
    var d = res.data.delegate;
    var badgeToken = res.data.token || token;
    host.innerHTML = badgeCard(d, badgeToken);
    document.getElementById('badgeActions').style.display = '';
    document.getElementById('btnPrint').addEventListener('click', function () { window.print(); });
    document.getElementById('btnDownload').addEventListener('click', function () {
      var svg = host.querySelector('svg');
      if (!svg) { window.KICC.toast('Nothing to download yet.'); return; }
      var blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = d.id + '-qr.svg';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.KICC.renderChrome('badge');
    load();
  });
})();
