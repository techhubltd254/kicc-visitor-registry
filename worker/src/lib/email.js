/**
 * Confirmation email.
 *
 * Providers are pluggable and every credential comes from an environment
 * binding — nothing is ever written into this file.
 *
 *   EMAIL_PROVIDER  resend | mailchannels | webhook | none
 *   RESEND_API_KEY            (provider = resend)
 *   EMAIL_WEBHOOK_URL         (provider = webhook)
 *   EMAIL_WEBHOOK_SECRET      (provider = webhook)
 */

import { renderConfirmation } from '../templates/confirmation.js';

export function emailProvider(env) {
  const p = (env.EMAIL_PROVIDER || 'none').toLowerCase();
  if (p === 'resend' && !env.RESEND_API_KEY) return 'none';
  if (p === 'webhook' && !env.EMAIL_WEBHOOK_URL) return 'none';
  if (p === 'mailchannels') return 'mailchannels';
  return p;
}

export async function sendConfirmationEmail(env, record, event, cfg) {
  const provider = emailProvider(env);
  if (provider === 'none') return { skipped: true, reason: 'no_email_provider_configured' };

  const subject = String(cfg.email.subject).replace('{{regId}}', record.id);
  const from = `${cfg.email.fromName} <${cfg.email.fromEmail}>`;
  const siteUrl = (env.PUBLIC_SITE_URL || cfg.site.url).replace(/\/$/, '');
  const { html, text } = renderConfirmation({ record, event, cfg, siteUrl });

  const body = { from, to: [record.email], subject, html, text, reply_to: cfg.email.replyTo };

  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`resend ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return { sent: true, provider, id: data.id };
  }

  if (provider === 'mailchannels') {
    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: record.email, name: record.name }] }],
        from: { email: cfg.email.fromEmail, name: cfg.email.fromName },
        reply_to: { email: cfg.email.replyTo },
        subject,
        content: [{ type: 'text/html', value: html }]
      })
    });
    if (!res.ok) throw new Error(`mailchannels ${res.status}`);
    return { sent: true, provider };
  }

  if (provider === 'webhook') {
    const res = await fetch(env.EMAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.EMAIL_WEBHOOK_SECRET ? { 'x-webhook-secret': env.EMAIL_WEBHOOK_SECRET } : {})
      },
      body: JSON.stringify({ to: record.email, subject, html, text, from, replyTo: cfg.email.replyTo })
    });
    if (!res.ok) throw new Error(`email webhook ${res.status}`);
    return { sent: true, provider };
  }

  return { skipped: true, reason: `unknown_provider_${provider}` };
}
