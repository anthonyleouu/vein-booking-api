const { Resend } = require("resend");

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendBookingEmails({ toCustomer, subject, html, text }) {
  const resend = getResend();
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const admin = process.env.ADMIN_EMAIL;

  // Send to customer (if provided)
  if (toCustomer) {
    await resend.emails.send({
      from,
      to: toCustomer,
      subject,
      html,
      text,
    });
  }

  // Always send admin copy
  if (admin) {
    await resend.emails.send({
      from,
      to: admin,
      subject: `[ADMIN COPY] ${subject}`,
      html,
      text,
    });
  }
}

module.exports = { sendBookingEmails };