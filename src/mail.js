// SMTP email delivery for magic links and password resets.
// Configured via env vars (see README). When SMTP is not configured (e.g. local dev
// without credentials), sendMail logs the intended email to the console instead, so
// the app still works and secrets are never required to run locally.
//
// Works with any SMTP provider (SMTP2GO, Brevo, Resend SMTP, Gmail App Password…).

import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST || '';
const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.SMTP_FROM || '';

let transporter = null;
let transporterError = null;

function getTransporter() {
  if (!host || !user || !pass) return null;
  if (!transporter && !transporterError) {
    try {
      transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });
    } catch (err) {
      transporterError = err;
    }
  }
  return transporterError ? null : transporter;
}

// The base URL of the app, used to build magic-link / reset URLs.
export function appBaseUrl() {
  return (process.env.APP_URL || 'http://localhost:4173').replace(/\/$/, '');
}

/**
 * Send an email. When SMTP is unconfigured, logs a clickable link to stdout so an
 * operator can complete the flow manually. Returns an object describing what happened.
 * @param {{to:string, subject:string, html:string, textOptional?:string}} opts
 */
export async function sendEmail({ to, subject, html }) {
  const sender = getTransporter();
  const mail = {
    from,
    to,
    subject,
    html,
    text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };

  if (!sender) {
    // Extract the URL (e.g. first https?:// link) for the console affordance.
    const link = (html.match(/href="(https?:\/\/[^"]+)"/) || [])[1] || '(no link in email)';
    console.log(`[mail/fallback] to=${to} subject="${subject}"`);
    console.log(`[mail/fallback] ${link}`);
    return { ok: false, mode: 'log', link };
  }

  try {
    const info = await sender.sendMail(mail);
    return { ok: true, mode: 'smtp', id: info.messageId };
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    return { ok: false, mode: 'smtp', error: err.message };
  }
}
