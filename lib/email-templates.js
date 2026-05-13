function formatDateTime(iso) {
  if (!iso) return "-";

  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Europe/Athens",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSiteUrl(booking) {
  return (
    booking?.site_url ||
    process.env.PUBLIC_BASE_URL ||
    "https://selenelux.co"
  ).replace(/\/+$/, "");
}

function getContactEmail() {
  return process.env.CONTACT_EMAIL || "contact@selenelux.co";
}

function getContactPhone() {
  return process.env.CONTACT_PHONE || "+30 698 725 3536";
}

function baseEmailLayout({
  previewText,
  header,
  bodyHtml,
  primaryLabel,
  primaryUrl,
  secondaryLabel,
  secondaryUrl,
  footerLines,
}) {
  const safePreview = esc(previewText);
  const safeHeader = esc(header);

  const primaryHtml = primaryUrl
    ? `
      <div style="margin:28px 0 12px 0;text-align:center;">
        <a href="${esc(primaryUrl)}"
           style="display:inline-block;background:#2b2b2b;color:#f4f1ea;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;">
          ${esc(primaryLabel || "Open")}
        </a>
      </div>
    `
    : "";

  const secondaryHtml = secondaryUrl
    ? `
      <div style="margin:0 0 12px 0;text-align:center;">
        <a href="${esc(secondaryUrl)}"
           style="display:inline-block;color:#2b2b2b;text-decoration:underline;padding:8px 12px;font-size:14px;">
          ${esc(secondaryLabel || "Cancel booking")}
        </a>
      </div>
    `
    : "";

  const footerHtml = footerLines
    .map((line) => `<div style="margin:2px 0;">${line}</div>`)
    .join("");

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeHeader}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f1ea;font-family:Arial,sans-serif;color:#2b2b2b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      ${safePreview}
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#2b2b2b;padding:28px 24px;text-align:center;">
                <div style="font-size:30px;line-height:1.2;font-weight:700;color:#f4f1ea;">
                  ${safeHeader}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 20px;">
                ${bodyHtml}
                ${primaryHtml}
                ${secondaryHtml}
              </td>
            </tr>

            <tr>
              <td style="padding:22px 20px;background:#faf8f3;border-top:1px solid #e6e0d5;font-size:14px;line-height:1.6;color:#5c564d;">
                ${footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}

function summaryRow(label, value) {
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee7db;">
        <div style="font-size:13px;color:#6a655c;margin-bottom:4px;">
          ${esc(label)}
        </div>
        <div style="font-size:16px;font-weight:600;color:#2b2b2b;">
          ${esc(value || "-")}
        </div>
      </td>
    </tr>
  `;
}

function buildTransferConfirmationEmail(booking) {
  const customerName = booking.customer_name || "Guest";
  const subject = "Your transfer booking with Selene Lux is confirmed";
  const previewText = "Your transfer has been confirmed. Review your booking information below.";

  const siteUrl = getSiteUrl(booking);
  const contactEmail = getContactEmail();
  const contactPhone = getContactPhone();
  const contactUrl = `${siteUrl}/contact`;

  const footerLines = [
    "<strong>Selene Lux</strong>",
    "Private Transfers & Tours",
    contactEmail,
    contactPhone,
    siteUrl,
  ];

  const bodyHtml = `
    <div style="font-size:16px;line-height:1.7;color:#2b2b2b;">
      <p style="margin:0 0 16px 0;">Hello ${esc(customerName)},</p>

      <p style="margin:0 0 16px 0;">
        Thank you for choosing Selene Lux. Your booking has been successfully confirmed and your payment has been received.
      </p>

      <p style="margin:0 0 24px 0;">
        Below you will find a summary of your transfer details. If you have any questions or need to update any information, please feel free to contact us.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;border:1px solid #eee7db;border-radius:12px;padding:0 18px;background:#fffdf9;box-shadow:0 6px 18px rgba(0,0,0,0.05);">
        ${summaryRow("Full Name", booking.customer_name)}
        ${summaryRow("Email", booking.customer_email)}
        ${summaryRow("Phone Number", booking.customer_phone)}
        ${summaryRow("Booking ID", booking.booking_id)}
        ${summaryRow("Pickup Date & Time", formatDateTime(booking.start_time))}
        ${summaryRow("Pickup Address", booking.pickup_address)}
        ${summaryRow("Dropoff Address", booking.dropoff_address)}
        ${summaryRow("Passengers", booking.passengers)}
        ${summaryRow("Luggage", booking.luggage)}
        ${summaryRow("Vehicle", "Mercedes Vito")}
        ${summaryRow("Total Price", booking.price_total_eur != null ? `€${booking.price_total_eur}` : "-")}
      </table>

      <h3 style="margin:0 0 12px 0;font-size:18px;color:#2b2b2b;">Cancellation Policy</h3>
      <p style="margin:0 0 12px 0;">
        You may cancel your booking free of charge up to 24 hours before the scheduled pickup time. Cancellations made within 24 hours of the pickup time may not be eligible for a refund.
      </p>
      <p style="margin:0 0 8px 0;">
        If you need to modify or cancel your booking, please contact us as soon as possible.
      </p>
    </div>
  `;

  const html = baseEmailLayout({
    previewText,
    header: "Selene Lux",
    bodyHtml,
    primaryLabel: "Contact Support",
    primaryUrl: contactUrl,
    secondaryLabel: null,
    secondaryUrl: null,
    footerLines,
  });

  const text = `
Your transfer booking with Selene Lux is confirmed

Hello ${booking.customer_name || "Guest"},

Thank you for choosing Selene Lux. Your booking has been successfully confirmed and your payment has been received.

Below you will find a summary of your transfer details. If you have any questions or need to update any information, please feel free to contact us.

Full Name: ${booking.customer_name || "-"}
Email: ${booking.customer_email || "-"}
Phone Number: ${booking.customer_phone || "-"}
Booking ID: ${booking.booking_id || "-"}
Pickup Date & Time: ${formatDateTime(booking.start_time)}
Pickup Address: ${booking.pickup_address || "-"}
Dropoff Address: ${booking.dropoff_address || "-"}
Passengers: ${booking.passengers ?? "-"}
Luggage: ${booking.luggage ?? "-"}
Vehicle: Mercedes Vito
Total Price: ${booking.price_total_eur != null ? `€${booking.price_total_eur}` : "-"}

Cancellation Policy:
You may cancel your booking free of charge up to 24 hours before the scheduled pickup time. Cancellations made within 24 hours of the pickup time may not be eligible for a refund.
If you need to modify or cancel your booking, please contact us as soon as possible.
Selene Lux
Private Transfers & Tours
${contactEmail}
${contactPhone}
${siteUrl}
  `.trim();

  return { subject, html, text };
}

function buildTourConfirmationEmail(booking) {
  const customerName = booking.customer_name || "Guest";
  const subject = "Your private tour booking with Selene Lux is confirmed";
  const previewText = "Your trip has been confirmed. Review your booking information below.";

  const siteUrl = getSiteUrl(booking);
  const contactEmail = getContactEmail();
  const contactPhone = getContactPhone();
  const contactUrl = `${siteUrl}/contact`;

  const footerLines = [
    "<strong>Selene Lux</strong>",
    "Private Transfers & Tours",
    contactEmail,
    contactPhone,
    siteUrl,
  ];

  const tourName =
    booking.tour_name ||
    booking.tour_title ||
    booking.tour ||
    booking.service_name ||
    "-";

  const bodyHtml = `
    <div style="font-size:16px;line-height:1.7;color:#2b2b2b;">
      <p style="margin:0 0 16px 0;">Hello ${esc(customerName)},</p>

      <p style="margin:0 0 16px 0;">
        Thank you for choosing Selene Lux. Your booking has been successfully confirmed and your payment has been received.
      </p>

      <p style="margin:0 0 24px 0;">
        Below you will find a summary of your private tour details. If you have any questions or need to update any information, please feel free to contact us.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;border:1px solid #eee7db;border-radius:12px;padding:0 18px;background:#fffdf9;box-shadow:0 6px 18px rgba(0,0,0,0.05);">
        ${summaryRow("Full Name", booking.customer_name)}
        ${summaryRow("Email", booking.customer_email)}
        ${summaryRow("Phone Number", booking.customer_phone)}
        ${summaryRow("Booking ID", booking.booking_id)}
        ${summaryRow("Tour Name", tourName)}
        ${summaryRow("Pickup Date & Time", formatDateTime(booking.start_time))}
        ${summaryRow("Pickup Address", booking.pickup_address)}
        ${summaryRow("Dropoff Address", booking.dropoff_address)}
        ${summaryRow("Passengers", booking.passengers)}
        ${summaryRow("Total Price", booking.price_total_eur != null ? `€${booking.price_total_eur}` : "-")}
      </table>

      <h3 style="margin:0 0 12px 0;font-size:18px;color:#2b2b2b;">Cancellation Policy</h3>
      <p style="margin:0 0 12px 0;">
        You may cancel your booking free of charge up to 24 hours before the scheduled pickup time. Cancellations made within 24 hours of the pickup time may not be eligible for a refund.
      </p>
      <p style="margin:0 0 8px 0;">
        If you need to modify or cancel your booking, please contact us as soon as possible.
      </p>
    </div>
  `;

  const html = baseEmailLayout({
    previewText,
    header: "Selene Lux",
    bodyHtml,
    primaryLabel: "Contact Support",
    primaryUrl: contactUrl,
    secondaryLabel: null,
    secondaryUrl: null,
    footerLines,
  });

  const text = `
Your private tour booking with Selene Lux is confirmed

Hello ${booking.customer_name || "Guest"},

Thank you for choosing Selene Lux. Your booking has been successfully confirmed and your payment has been received.

Below you will find a summary of your private tour details. If you have any questions or need to update any information, please feel free to contact us.

Full Name: ${booking.customer_name || "-"}
Email: ${booking.customer_email || "-"}
Phone Number: ${booking.customer_phone || "-"}
Booking ID: ${booking.booking_id || "-"}
Tour Name: ${tourName}
Pickup Date & Time: ${formatDateTime(booking.start_time)}
Pickup Address: ${booking.pickup_address || "-"}
Dropoff Address: ${booking.dropoff_address || "-"}
Passengers: ${booking.passengers ?? "-"}
Total Price: ${booking.price_total_eur != null ? `€${booking.price_total_eur}` : "-"}

Cancellation Policy:
You may cancel your booking free of charge up to 24 hours before the scheduled pickup time. Cancellations made within 24 hours of the pickup time may not be eligible for a refund.
If you need to modify or cancel your booking, please contact us as soon as possible.
Selene Lux
Private Transfers & Tours
${contactEmail}
${contactPhone}
${siteUrl}
  `.trim();

  return { subject, html, text };
}

module.exports = {
  buildTransferConfirmationEmail,
  buildTourConfirmationEmail,
};
