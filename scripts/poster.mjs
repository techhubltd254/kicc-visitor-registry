/**
 * poster.mjs — renders the printable A4 event poster.
 *
 * Kept out of build.mjs so the layout can be edited without touching the
 * build pipeline. Colours and copy come from config/event.config.json, so the
 * poster re-skins with the rest of the site.
 *
 * Page: 1240 x 1754 px = A4 at 150 dpi.
 */

const esc = (s) =>
  String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export function renderPoster({ cfg, qrSvg }) {
  const b = cfg.brand;
  const s = cfg.site;
  const event = cfg.events.find((e) => e.active !== false) || cfg.events[0];

  const detail = (label, value) => `
      <div class="detail">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>KICC event poster</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    width:1240px;height:1754px;background:#fff;color:${b.ink};
    font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    display:flex;flex-direction:column;overflow:hidden;
  }

  /* ---------- masthead ---------- */
  .masthead{background:${b.navy};border-bottom:14px solid ${b.gold};padding:44px 72px 38px;color:#fff;flex:0 0 auto}
  .masthead .org{font-size:27px;font-weight:700;letter-spacing:.2px}
  .masthead .tag{color:${b.gold};font-family:Georgia,serif;font-style:italic;font-size:20px;margin-top:8px}

  /* ---------- body ---------- */
  .body{flex:1 1 auto;display:grid;grid-template-columns:1.12fr .88fr;gap:52px;padding:54px 72px 40px}

  .eyebrow{
    display:inline-block;font-size:16px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;
    color:${b.red};border:2.5px solid ${b.red};border-radius:999px;padding:9px 22px;
  }
  h1{font-size:63px;line-height:1.05;letter-spacing:-1.8px;color:${b.navy};margin-top:28px}
  h1 .accent{color:${b.red};display:block}
  .sub{font-size:23px;color:${b.muted};line-height:1.5;margin-top:22px}

  .details{display:flex;flex-direction:column;gap:14px;margin-top:34px}
  .detail{border:2px solid ${b.line};border-radius:14px;padding:15px 22px}
  .detail span{display:block;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${b.muted}}
  .detail strong{display:block;font-size:24px;color:${b.navy};margin-top:5px}

  /* ---------- QR card ---------- */
  .qrcol{display:flex;flex-direction:column;justify-content:center}
  .qrcard{
    background:${b.goldSoft};border:3px dashed ${b.gold};border-radius:22px;
    padding:32px 28px;text-align:center;
  }
  .qrcard h2{font-size:27px;color:${b.navy};letter-spacing:-.3px}
  .qrcard .lead{font-size:16px;color:${b.muted};margin-top:8px}
  .qrcard svg{width:330px;height:330px;display:block;margin:22px auto 0}
  .qrcard .url{
    font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14.5px;color:${b.navy};
    margin-top:18px;word-break:break-all;line-height:1.4;
  }
  .steps{margin-top:22px;font-size:15px;color:${b.muted};line-height:1.75;text-align:left;padding-left:2px}
  .steps b{color:${b.ink}}

  /* ---------- footer ---------- */
  .footbar{background:${b.navy};border-top:10px solid ${b.gold};padding:26px 72px;color:#B9C9D4;flex:0 0 auto}
  .footbar .row{display:flex;justify-content:space-between;gap:36px;align-items:flex-end}
  .footbar .k{color:#fff;font-size:18px;font-weight:700}
  .footbar .l{font-size:14.5px;line-height:1.55;margin-top:7px;max-width:52ch}
  .footbar .r{text-align:right;font-size:15px;line-height:1.6;white-space:nowrap}
  .footbar .r b{color:${b.gold};display:block;font-size:16px;margin-bottom:4px}
</style></head>
<body>

  <header class="masthead">
    <div class="org">${esc(s.organisation)}</div>
    <div class="tag">${esc(s.tagline)}</div>
  </header>

  <main class="body">

    <div class="left">
      <span class="eyebrow">Visitor registration open</span>
      <h1>Register to attend<span class="accent">${esc(event.name)}</span></h1>
      <p class="sub">Scan the code and complete the short form. Your visitor pass and QR badge are issued instantly &mdash; show them at the accreditation desk on arrival.</p>

      <div class="details">
        ${detail('Dates', event.dates || 'See website')}
        ${detail('Venue', event.venue || 'KICC, Nairobi')}
        ${detail('Entry', 'Free registration')}
      </div>
    </div>

    <div class="qrcol">
      <div class="qrcard">
        <h2>Scan to register</h2>
        <p class="lead">Point your phone camera at the code</p>
        ${qrSvg}
        <div class="url">${esc(s.url)}</div>
        <div class="steps">
          <b>1.</b> Scan the code &nbsp; <b>2.</b> Complete the form<br>
          <b>3.</b> Show your QR badge at the door
        </div>
      </div>
    </div>

  </main>

  <footer class="footbar">
    <div class="row">
      <div>
        <div class="k">${esc(s.address)}</div>
        <div class="l">Accreditation opens 60 minutes before each session. Security screening applies at all KICC entrances. Bring the ID you registered with.</div>
      </div>
      <div class="r">
        <b>Enquiries</b>
        ${esc(s.supportPhone)}<br>${esc(s.supportEmail)}
      </div>
    </div>
  </footer>

</body></html>`;
}
