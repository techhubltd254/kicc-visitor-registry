/* =====================================================================
   Door check-in page — camera QR scanning with manual fallback.
   Decoding uses the vendored jsQR library (assets/vendor/jsQR.js), so the
   page needs no third-party service and works on a phone in the hall.
   ===================================================================== */
(function () {
  var stream = null, rafId = null, canvas, ctx, video, running = false, lastCode = '', lastAt = 0;

  function verdict(kind, title, html) {
    var v = document.getElementById('verdict');
    v.className = 'verdict show ' + kind;
    v.innerHTML = '<h3>' + window.KICC.esc(title) + '</h3>' + html;
    if (navigator.vibrate) navigator.vibrate(kind === 'good' ? 60 : [40, 60, 40]);
  }

  function delegateBlock(d) {
    return '<div class="summary" style="margin-top:12px">' + [
      ['Name', d.name], ['Registration', d.id], ['Category', d.category],
      ['Event', d.event], ['Dates', d.eventDates || '—'], ['Venue', d.venue || 'KICC, Nairobi'],
      ['Organisation', d.org || '—'], ['Phone', d.phone],
      ['Requirements', d.needs || 'None recorded']
    ].map(function (r) {
      return '<div><span>' + window.KICC.esc(r[0]) + '</span><span>' + window.KICC.esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  async function checkIn(code) {
    var gate = document.getElementById('gate').value;
    var res = await window.KICC.api('/api/checkin', { method: 'POST', body: { token: code, gate: gate, by: 'door' } });
    var data = res.data || {};

    if (res.ok && data.checkedIn) {
      verdict('good', 'Checked in — ' + data.delegate.name, delegateBlock(data.delegate));
    } else if (res.ok && data.alreadyCheckedIn) {
      verdict('warn', 'Already checked in', delegateBlock(data.delegate) +
        '<p style="margin-top:8px">First scanned ' + window.KICC.esc(window.KICC.fmtDate(data.delegate.checkedInAt)) +
        (data.delegate.checkedInGate ? ' at ' + window.KICC.esc(data.delegate.checkedInGate) : '') + '.</p>');
    } else {
      var msg = data.error || 'Check-in failed.';
      if (data.code === 'bad_signature') msg = 'This badge failed its signature check — possible forgery. Do not admit.';
      if (data.code === 'NOT_FOUND') msg = 'That registration number is not in the register.';
      verdict('bad', 'Not admitted', '<p>' + window.KICC.esc(msg) + '</p>');
    }
    document.getElementById('manualCode').value = '';
  }

  function tick() {
    if (!running) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (window.jsQR) {
        var found = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (found && found.data) {
          var now = Date.now();
          if (found.data !== lastCode || now - lastAt > 4000) {
            lastCode = found.data; lastAt = now;
            checkIn(found.data);
          }
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  async function start() {
    if (running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.KICC.toast('This device or browser cannot open the camera. Use manual entry below.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      running = true;
      document.getElementById('btnStart').disabled = true;
      document.getElementById('btnStop').disabled = false;
      tick();
    } catch (e) {
      window.KICC.toast('Camera permission denied. Use manual entry below.');
    }
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.KICC.renderChrome('checkin');
    video = document.getElementById('video');
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    var gateSel = document.getElementById('gate');
    (window.KICC.config.checkin.gates || ['Main Entrance']).forEach(function (g) {
      var o = document.createElement('option'); o.value = g; o.textContent = g; gateSel.appendChild(o);
    });

    document.getElementById('btnStart').addEventListener('click', start);
    document.getElementById('btnStop').addEventListener('click', stop);
    document.getElementById('manualForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = document.getElementById('manualCode').value.trim();
      if (code) checkIn(code);
    });
  });
})();
