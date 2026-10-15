import nodemailer from 'nodemailer';
import { config } from '../config.js';

// Без SMTP_HOST письма не отправляются, а ссылка печатается в консоль сервера — удобно для разработки.
const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  : null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const html = (title, lead, url, button) => `<!doctype html><html lang="ru"><body style="margin:0;background:#0a0a0a;font-family:Arial,sans-serif;color:#f4f4f5">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141416;border:1px solid #2a2a2e;border-radius:16px">
<tr><td style="padding:32px">
<div style="font-size:13px;letter-spacing:2px;color:#f4112c;font-weight:700">VOLOGDA AMATEUR LEAGUE</div>
<h1 style="margin:12px 0 8px;font-size:24px">${esc(title)}</h1>
<p style="margin:0 0 24px;color:#b4b4bc;line-height:1.5">${lead}</p>
<a href="${esc(url)}" style="display:inline-block;background:#f4112c;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:10px">${esc(button)}</a>
<p style="margin:24px 0 0;color:#7c7c85;font-size:12px;line-height:1.5">Если кнопка не работает, скопируйте ссылку в браузер:<br><span style="word-break:break-all">${esc(url)}</span></p>
</td></tr></table></td></tr></table></body></html>`;

export const mails = {
  verify: (nick, token) => {
    const url = `${config.clientUrl}/verify-email?token=${token}`;
    return {
      subject: 'Подтвердите почту — VAL',
      url,
      text: `Привет, ${nick}!\n\nПодтвердите почту, чтобы активировать аккаунт VAL: ${url}\n\nСсылка действует 24 часа. Если вы не регистрировались, просто проигнорируйте письмо.`,
      html: html('Подтвердите почту', `Привет, <b>${esc(nick)}</b>! Осталось подтвердить почту, чтобы активировать аккаунт. Ссылка действует 24 часа.`, url, 'Подтвердить почту'),
    };
  },
  reset: (nick, token) => {
    const url = `${config.clientUrl}/reset-password?token=${token}`;
    return {
      subject: 'Сброс пароля — VAL',
      url,
      text: `Привет, ${nick}!\n\nЧтобы задать новый пароль, перейдите по ссылке: ${url}\n\nСсылка действует 1 час. Если вы не запрашивали сброс, проигнорируйте письмо — пароль останется прежним.`,
      html: html('Сброс пароля', `Привет, <b>${esc(nick)}</b>! Вы запросили сброс пароля. Ссылка действует 1 час. Если это были не вы, просто проигнорируйте письмо.`, url, 'Задать новый пароль'),
    };
  },
};

/** Не бросает ошибок наружу: сбой почты не должен ломать регистрацию (письмо можно запросить повторно). */
export async function sendMail(to, mail) {
  try {
    if (!transport) { console.log(`\n[ПИСЬМО → ${to}] ${mail.subject}\n${mail.url}\n`); return; }
    await transport.sendMail({ from: config.mailFrom, to, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (e) {
    console.error('Не удалось отправить письмо:', e.message);
  }
}
