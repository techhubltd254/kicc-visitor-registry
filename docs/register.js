/* =====================================================================
   Registration page logic
   ===================================================================== */
(function () {
  var cfg = window.KICC.config;
  var form, events = [];

  function setErr(field, on) {
    var input = document.getElementById(field);
    var box = document.getElementById('err-' + field);
    if (input) input.setAttribute('aria-invalid', on ? 'true' : 'false');
    if (box) box.classList.toggle('show', on);
  }

  function renderHero() {
    var h = cfg.hero;
    document.getElementById('heroEyebrow').textContent = h.eyebrow;
    document.getElementById('heroTitle').textContent = h.title;
    document.getElementById('heroSub').textContent = h.subtitle;
    document.getElementById('heroChips').innerHTML = (h.chips || [])
      .map(function (c) { return '<span class="chip"><i class="dot"></i>' + window.KICC.esc(c) + '</span>'; })
      .join('');
  }

  function fillSelects() {
    var cat = document.getElementById('category');
    cfg.registration.categories.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; cat.appendChild(o);
    });

    var days = document.getElementById('attendDays');
    cfg.registration.dayOptions.forEach(function (d) {
      var o = document.createElement('option'); o.value = d; o.textContent = d; days.appendChild(o);
    });

    var country = document.getElementById('country');
    cfg.registration.countries.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; country.appendChild(o);
    });
    country.value = 'Kenya';

    var consent = document.getElementById('consentText');
    if (consent) consent.textContent = cfg.registration.consentText;
    var pl = document.getElementById('privacyLink');
    if (pl) pl.setAttribute('href', cfg.registration.privacyUrl);
    var sup = document.getElementById('supportLine');
    if (sup) sup.textContent = cfg.site.supportPhone;
  }

  async function loadEvents() {
    var sel = document.getElementById('event');
    var chip = document.getElementById('chipEvent');
    try {
      var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/events');
      events = (res.data && res.data.events) || [];
    } catch (e) {
      events = [];
    }
    if (!events.length) {
      sel.innerHTML = '<option value="">No events are currently open</option>';
      chip.textContent = 'No events open';
      return;
    }
    sel.innerHTML = '<option value="">— Select an event —</option>' +
      events.map(function (e) {
        return '<option value="' + window.KICC.esc(e.id) + '">' +
          window.KICC.esc(e.name) + '  ·  ' + window.KICC.esc(e.dates || '') + '</option>';
      }).join('');
    sel.addEventListener('change', function () {
      var ev = events.filter(function (e) { return e.id === sel.value; })[0];
      chip.textContent = ev ? ev.name + ' · ' + (ev.dates || '') : 'Select an event';
    });
  }

  function validate() {
    var ok = true;
    var name = document.getElementById('fullName').value.trim();
    var email = document.getElementById('email').value.trim();
    var phone = document.getElementById('phone').value.trim();
    var event = document.getElementById('event').value;
    var cat = document.getElementById('category').value;
    var consent = document.getElementById('consent').checked;

    if (name.length < 3 || name.indexOf(' ') === -1) { setErr('fullName', true); ok = false; } else setErr('fullName', false);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setErr('email', true); ok = false; } else setErr('email', false);
    var digits = phone.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) { setErr('phone', true); ok = false; } else setErr('phone', false);
    if (!event) { setErr('event', true); ok = false; } else setErr('event', false);
    if (!cat) { setErr('category', true); ok = false; } else setErr('category', false);
    if (!consent) { setErr('consent', true); ok = false; } else setErr('consent', false);
    if (cfg.features.requireIdNumber && !document.getElementById('docId').value.trim()) {
      setErr('docId', true); ok = false;
    } else setErr('docId', false);
    return ok;
  }

  function payload() {
    return {
      name: document.getElementById('fullName').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      org: document.getElementById('org').value.trim(),
      country: document.getElementById('country').value,
      docId: document.getElementById('docId').value.trim(),
      eventId: document.getElementById('event').value,
      category: document.getElementById('category').value,
      days: document.getElementById('attendDays').value,
      needs: document.getElementById('needs').value.trim(),
      consent: document.getElementById('consent').checked,
      source: 'web'
    };
  }

  function showSuccess(reg, ev) {
    form.style.display = 'none';
    var box = document.getElementById('successBox');
    box.classList.add('show');
    document.getElementById('outRegId').textContent = reg.id;
    document.getElementById('outSummary').innerHTML = [
      ['Delegate', reg.name], ['Event', ev.name], ['Dates', ev.dates || '—'],
      ['Venue', ev.venue || 'KICC, Nairobi'], ['Category', reg.category],
      ['Email', reg.email], ['Mobile', reg.phone],
      ['Registered', window.KICC.fmtDate(reg.createdAt)]
    ].map(function (r) {
      return '<div><span>' + window.KICC.esc(r[0]) + '</span><span>' + window.KICC.esc(r[1]) + '</span></div>';
    }).join('');

    var badgeUrl = '/badge.html?t=' + encodeURIComponent(reg.badgeToken);
    document.getElementById('btnBadge').setAttribute('href', badgeUrl);
    document.getElementById('qrMini').innerHTML = '';
    try {
      var qr = qrcode(0, 'M');
      qr.addData(reg.badgeToken);
      qr.make();
      document.getElementById('qrMini').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    } catch (e) { /* QR is a nicety here; the badge page is the source of truth */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e) {
    e.preventDefault();
    if (!validate()) {
      window.KICC.toast('Please correct the highlighted fields.');
      var bad = document.querySelector('[aria-invalid="true"]');
      if (bad) bad.focus();
      return;
    }
    var btn = document.getElementById('btnSubmit');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/register', { method: 'POST', body: payload() });
    btn.disabled = false;
    btn.textContent = 'Submit registration';

    if (res.ok) {
      showSuccess(res.data.registration, res.data.event);
      return;
    }

    var data = res.data || {};
    if (data.fieldErrors) {
      Object.keys(data.fieldErrors).forEach(function (k) {
        setErr(k, true);
        var box = document.getElementById('err-' + k);
        if (box) box.textContent = data.fieldErrors[k];
      });
    }
    if (data.code === 'DUPLICATE_EMAIL') {
      var note = document.getElementById('dupNote');
      note.style.display = '';
      note.innerHTML = '<strong>Already registered.</strong> ' + window.KICC.esc(data.error) +
        (data.existingId ? ' Your registration number is <strong>' + window.KICC.esc(data.existingId) + '</strong>.' : '') +
        ' <a href="/kicc-visitor-registry/badge.html?id=' + encodeURIComponent(data.existingId || '') + '">Open my badge</a>';
    }
    window.KICC.toast(data.error || 'Registration failed. Please try again.');
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.KICC.renderChrome('register');
    renderHero();
    form = document.getElementById('regForm');
    fillSelects();
    loadEvents();
    form.addEventListener('submit', submit);
    document.getElementById('btnAnother').addEventListener('click', function () {
      document.getElementById('successBox').classList.remove('show');
      form.style.display = '';
      form.reset();
      document.getElementById('fullName').focus();
    });
    document.getElementById('btnPrint').addEventListener('click', function () { window.print(); });

    var closed = document.getElementById('closedNote');
    if (!cfg.registration.open) {
      closed.style.display = '';
      closed.textContent = cfg.registration.closedMessage;
      form.querySelectorAll('input,select,textarea,button').forEach(function (el) { el.disabled = true; });
    }
  });
})();
