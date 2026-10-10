const nodemailer = require('nodemailer');

const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass }
  });
};

const sendMail = async ({ to, subject, html, text }) => {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('SMTP no configurado');
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM_NAME || 'POS Notificaciones';

  return transporter.sendMail({
    from: fromName ? `${fromName} <${from}>` : from,
    to,
    subject,
    text,
    html
  });
};

module.exports = { sendMail };
