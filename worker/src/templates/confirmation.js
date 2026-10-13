/**
 * Confirmation email template.
 * Branding values come from config/event.config.json, so editing the config
 * restyles the email too. Kept table-based for Outlook compatibility.
 */

const esc = (s) =>
  String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export function renderConfirmation({ record, event, cfg, siteUrl }) {
  const b = cfg.brand;
  const ev = event || {};
  const badgeUrl = `${siteUrl}/badge.html?t=${encodeURIComponent(record.badge_token || '')}`;
  const checkinUrl = `${siteUrl}/checkin.html`;

  const row = (label, value) => `
    <tr>
      <td style="padding:7px 0;color:${b.muted};font-size:14px;">${esc(label)}</td>
      <td style="padding:7px 0;color:${b.ink};font-size:14px;font-weight:600;text-align:right;">${esc(value)}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.email.subject.replace('{{regId}}', record.id))}</title></head>
<body style="margin:0;padding:0;background:${b.bg};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${b.bg};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${b.line};">

    <tr><td style="background:${b.navy};border-bottom:4px solid ${b.gold};padding:22px 28px;">
      <div style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:.2px;">${esc(cfg.site.organisation)}</div>
      <div style="color:${b.gold};font-family:Georgia,serif;font-style:italic;font-size:13px;margin-top:3px;">${esc(cfg.site.tagline)}</div>
    </td></tr>

    <tr><td style="padding:28px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${b.red};">Registration confirmed</p>
      <h1 style="margin:0 0 14px;font-size:24px;color:${b.navy};line-height:1.25;">You are registered, ${esc(record.name.split(' ')[0])}</h1>
      <p style="margin:0 0 20px;font-size:15px;color:${b.muted};line-height:1.6;">
        Your place at <strong style="color:${b.ink};">${esc(ev.name || record.event_id)}</strong> is confirmed.
        Present the QR badge below — or just your registration number — at the accreditation desk.
      </p>

      <div style="background:${b.goldSoft};border:1px dashed ${b.gold};border-radius:10px;padding:16px;text-align:center;margin-bottom:22px;">
        <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${b.muted};font-weight:700;">Registration number</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:24px;font-weight:700;color:${b.navy};margin-top:6px;letter-spacing:1px;">${esc(record.id)}</div>
      </div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${b.line};border-bottom:1px solid ${b.line};margin-bottom:22px;">
        ${row('Event', ev.name || record.event_id)}
        ${row('Dates', ev.dates || '—')}
        ${row('Venue', ev.venue || 'KICC, Nairobi')}
        ${row('Category', record.category)}
        ${row('Days attending', record.days || 'All days')}
        ${row('Registered email', record.email)}
        ${row('Mobile', record.phone)}
      </table>

      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:10px;">
          <a href="${esc(badgeUrl)}" style="display:inline-block;background:${b.red};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:9px;">View my QR badge</a>
        </td>
        <td>
          <a href="${esc(siteUrl)}" style="display:inline-block;background:#ffffff;color:${b.navy};text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:9px;border:1.5px solid ${b.line};">Registration page</a>
        </td>
      </tr></table>

      <div style="background:#FBF9F6;border-left:4px solid ${b.gold};border-radius:8px;padding:14px 16px;margin-top:24px;">
        <div style="font-size:13px;font-weight:700;color:${b.navy};margin-bottom:6px;">Before you arrive</div>
        <ul style="margin:0;padding-left:18px;font-size:13.5px;color:${b.muted};line-height:1.7;">
          <li>Bring the ID or passport number you registered with.</li>
          <li>Accreditation opens 60 minutes before the session.</li>
          <li>Security screening applies at all KICC entrances.</li>
          <li>Parking is available at the KICC basement and the adjacent City Hall car park.</li>
        </ul>
      </div>

      <p style="margin:22px 0 0;font-size:13px;color:${b.muted};line-height:1.6;">
        Questions? Email <a href="mailto:${esc(cfg.site.supportEmail)}" style="color:${b.red};">${esc(cfg.site.supportEmail)}</a>
        or call ${esc(cfg.site.supportPhone)}.
      </p>
    </td></tr>

    <tr><td style="background:${b.navy};padding:20px 28px;color:#9FB3C0;font-size:12.5px;line-height:1.6;">
      <strong style="color:#ffffff;">${esc(cfg.site.organisation)}</strong><br>
      ${esc(cfg.site.address)}<br>
      <span style="color:${b.gold};font-family:Georgia,serif;font-style:italic;">${esc(cfg.site.tagline)}</span>
    </td></tr>

  </table>
  <div style="max-width:600px;font-size:11.5px;color:${b.muted};padding:14px 6px;line-height:1.6;">
    You received this because you registered at ${esc(cfg.site.url)}. Your details are processed for event
    accreditation, security clearance and attendance records under the Kenya Data Protection Act, 2019.
    To be removed from the register, contact ${esc(cfg.site.supportEmail)}.
  </div>
</td></tr></table>
</body></html>`;

  const text = [
    `Registration confirmed — ${record.id}`,
    ``,
    `Name:     ${record.name}`,
    `Event:    ${ev.name || record.event_id}`,
    `Dates:    ${ev.dates || '-'}`,
    `Venue:    ${ev.venue || 'KICC, Nairobi'}`,
    `Category: ${record.category}`,
    `Days:     ${record.days || 'All days'}`,
    ``,
    `Show this number, or your QR badge, at the accreditation desk:`,
    `${badgeUrl}`,
    ``,
    `Accreditation opens 60 minutes before the session. Bring the ID you registered with.`,
    `Questions: ${cfg.site.supportEmail} · ${cfg.site.supportPhone}`,
    ``,
    `${cfg.site.organisation} — ${cfg.site.tagline}`,
    checkinUrl
  ].join('\n');

  return { html, text };
}
