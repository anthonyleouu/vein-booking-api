const { Resend } = require("resend");
const {
  buildTransferAdminEmail,
  buildTourAdminEmail,
} = require("./email-templates");

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendBookingEmails({ toCustomer, subject, html, text, bookingData }) {
  const resend = getResend();
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const admin = process.env.ADMIN_EMAIL;

  const customerSend = toCustomer
    ? resend.emails.send({ from, to: toCustomer, subject, html, text })
    : Promise.resolve();

  let adminSend = Promise.resolve();
  if (admin && bookingData) {
    try {
      let adminTemplate = null;
      if (bookingData.service_type === "TRANSFER") {
        adminTemplate = buildTransferAdminEmail(bookingData);
      } else if (bookingData.service_type === "TOUR") {
        adminTemplate = buildTourAdminEmail(bookingData);
      }
      if (adminTemplate) {
        adminSend = resend.emails
          .send({
            from,
            to: admin,
            subject: adminTemplate.subject,
            html: adminTemplate.html,
            text: adminTemplate.text,
          })
          .catch((err) => {
            console.error("Admin email send failed:", err.message);
          });
      }
    } catch (err) {
      console.error("Admin email template failed:", err.message);
    }
  }

  await Promise.all([customerSend, adminSend]);
}

module.exports = { sendBookingEmails };
