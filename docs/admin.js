/* =====================================================================
   Organiser console — /admin.html
   Passcode gate, KPIs, searchable registry, CSV export, event manager.
   ===================================================================== */
(function () {
  var state = { page: 1, pageSize: 50, q: '', event: '', status: '', category: '', sort: 'created', dir: 'desc' };
  var events = [];

  function token() { return sessionStorage.getItem('kicc_admin_token'); }

  function showGate(show) {
    document.getElementById('gateCard').style.display = show ? '' : 'none';
    document.getElementById('adminPanel').style.display = show ? 'none' : '';
  }

  async function login(passcode) {
    var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/login', { method: 'POST', body: { passcode: passcode } });
    if (res.ok && res.data.token) {
      sessionStorage.setItem('kicc_admin_token', res.data.token);
      showGate(false);
      refresh();
      return true;
    }
    document.getElementById('err-passcode').classList.add('show');
    return false;
  }

  async function refresh() {
    await Promise.all([loadStats(), loadTable(), loadEvents()]);
  }

  async function loadStats() {
    var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/stats');
    if (!res.ok) return;
    var t = res.data.totals || {};
    document.getElementById('sTotal').textContent = t.total || 0;
    document.getElementById('sIn').textContent = t.checkedIn || 0;
    document.getElementById('sEvents').textContent = t.events || 0;
    document.getElementById('sToday').textContent = t.today || 0;

    var q = res.data.queue || {};
    document.getElementById('queueNote').innerHTML =
      'Email provider: <strong>' + window.KICC.esc(res.data.integrations.email) + '</strong> · ' +
      'Google Sheets: <strong>' + (res.data.integrations.sheets ? 'connected' : 'not connected') + '</strong> · ' +
      'TIDC: <strong>' + (res.data.integrations.tidc.enabled ? 'enabled' : 'disabled') + '</strong><br>' +
      'Sync queue — pending: <strong>' + (q.pending || 0) + '</strong>, failed: <strong>' + (q.failed || 0) + '</strong>';

    document.getElementById('byEvent').innerHTML = (res.data.byEvent || [])
      .filter(function (e) { return e.registrations > 0; })
      .map(function (e) {
        return '<div><span>' + window.KICC.esc(e.name) + '</span><span>' + e.registrations +
          ' (' + (e.checked_in || 0) + ' in)</span></div>';
      }).join('') || '<div><span>No registrations yet</span><span>—</span></div>';
  }

  async function loadEvents() {
    var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/events');
    if (!res.ok) return;
    events = res.data.events || [];
    var sel = document.getElementById('filterEvent');
    var keep = sel.value;
    sel.innerHTML = '<option value="">All events</option>' + events.map(function (e) {
      return '<option value="' + window.KICC.esc(e.id) + '">' + window.KICC.esc(e.name) + '</option>';
    }).join('');
    sel.value = keep;
  }

  async function loadTable() {
    var qs = new URLSearchParams({
      q: state.q, event: state.event, status: state.status, category: state.category,
      page: state.page, pageSize: state.pageSize, sort: state.sort, dir: state.dir
    });
    var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/registrations?' + qs.toString());
    if (!res.ok) return;
    var rows = res.data.registrations || [];
    var body = document.getElementById('regBody');

    body.innerHTML = rows.map(function (r) {
      return '<tr>' +
        '<td><code style="font-size:12.5px">' + window.KICC.esc(r.id) + '</code></td>' +
        '<td><strong>' + window.KICC.esc(r.name) + '</strong>' +
          (r.org ? '<br><span style="color:var(--muted)">' + window.KICC.esc(r.org) + '</span>' : '') + '</td>' +
        '<td>' + window.KICC.esc(r.email) + '<br><span style="color:var(--muted)">' + window.KICC.esc(r.phone) + '</span></td>' +
        '<td>' + window.KICC.esc(r.event_name || r.event_id) + '<br><span style="color:var(--muted)">' +
          window.KICC.esc(r.category) + ' · ' + window.KICC.esc(r.days || '') + '</span></td>' +
        '<td>' + window.KICC.fmtDate(r.created_at) + '</td>' +
        '<td>' + (r.checked_in
          ? '<span class="pill in">Checked in</span><br><span style="color:var(--muted);font-size:12px">' +
            window.KICC.esc(window.KICC.fmtDate(r.checked_in_at)) + '</span>'
          : '<span class="pill out">Not arrived</span>') + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" data-check="' + window.KICC.esc(r.id) + '" data-on="' +
          (r.checked_in ? '0' : '1') + '">' + (r.checked_in ? 'Undo' : 'Check in') + '</button> ' +
          '<button class="btn btn-ghost btn-sm" data-del="' + window.KICC.esc(r.id) + '" title="Delete">&times;</button></td>' +
      '</tr>';
    }).join('');

    document.getElementById('emptyState').style.display = rows.length ? 'none' : 'block';
    document.getElementById('regTable').style.display = rows.length ? '' : 'none';
    document.getElementById('pageInfo').textContent =
      'Page ' + res.data.page + ' of ' + res.data.pages + ' — ' + res.data.total + ' record' + (res.data.total === 1 ? '' : 's');
    document.getElementById('btnPrev').disabled = res.data.page <= 1;
    document.getElementById('btnNext').disabled = res.data.page >= res.data.pages;
  }

  function download() {
    var qs = new URLSearchParams({
      q: state.q, event: state.event, status: state.status, category: state.category,
      key: token() || ''
    });
    window.location.href = 'https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/export.csv?' + qs.toString();
    window.KICC.toast('Export started');
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.KICC.renderChrome('admin');
    if (token()) { showGate(false); refresh(); } else { showGate(true); }

    document.getElementById('btnUnlock').addEventListener('click', function () {
      var v = document.getElementById('passcode').value;
      if (v) login(v);
    });
    document.getElementById('passcode').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') login(this.value);
    });
    document.getElementById('btnLock').addEventListener('click', function () {
      sessionStorage.removeItem('kicc_admin_token');
      showGate(true);
      document.getElementById('passcode').value = '';
    });

    ['search', 'filterEvent', 'filterStatus', 'filterCategory'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        state.q = document.getElementById('search').value.trim();
        state.event = document.getElementById('filterEvent').value;
        state.status = document.getElementById('filterStatus').value;
        state.category = document.getElementById('filterCategory').value;
        state.page = 1;
        loadTable();
      });
    });

    document.getElementById('btnPrev').addEventListener('click', function () {
      if (state.page > 1) { state.page--; loadTable(); }
    });
    document.getElementById('btnNext').addEventListener('click', function () {
      state.page++; loadTable();
    });
    document.getElementById('btnExport').addEventListener('click', download);
    document.getElementById('btnRefresh').addEventListener('click', refresh);
    document.getElementById('btnDrain').addEventListener('click', async function () {
      var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/queue/drain', { method: 'POST' });
      window.KICC.toast(res.ok ? 'Queue drained' : 'Drain failed');
      loadStats();
    });

    document.getElementById('regBody').addEventListener('click', async function (e) {
      var c = e.target.getAttribute('data-check');
      var d = e.target.getAttribute('data-del');
      if (c) {
        var on = e.target.getAttribute('data-on') === '1';
        await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/registrations/' + c, { method: 'PATCH', body: { checkedIn: on } });
        loadTable(); loadStats();
      }
      if (d) {
        if (!confirm('Delete registration ' + d + '? This cannot be undone.')) return;
        await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/registrations/' + d, { method: 'DELETE' });
        loadTable(); loadStats();
        window.KICC.toast('Deleted ' + d);
      }
    });

    /* ---- event manager ---- */
    document.getElementById('btnNewEvent').addEventListener('click', async function () {
      var name = prompt('Event name:');
      if (!name) return;
      var dates = prompt('Dates (e.g. 18 – 20 November 2026):') || '';
      var venue = prompt('Venue (e.g. Tsavo Ballroom):') || '';
      var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      var res = await window.KICC.api('https://kicc-visitor-registry.techhubltd254.workers.dev/api/admin/events', {
        method: 'POST',
        body: { id: id, name: name, dates: dates, venue: venue, active: true }
      });
      window.KICC.toast(res.ok ? 'Event added' : (res.data.error || 'Could not add event'));
      refresh();
    });
  });
})();
