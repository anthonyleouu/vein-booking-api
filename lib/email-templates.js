const { normalizePlaceName } = require("./place-normalize");

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
        ${summaryRow("Pickup Address", normalizePlaceName(booking.pickup_address))}
        ${summaryRow("Dropoff Address", normalizePlaceName(booking.dropoff_address))}
        ${summaryRow("Passengers", booking.passengers)}
        ${summaryRow("Luggages", booking.luggage)}
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
Pickup Address: ${normalizePlaceName(booking.pickup_address) || "-"}
Dropoff Address: ${normalizePlaceName(booking.dropoff_address) || "-"}
Passengers: ${booking.passengers ?? "-"}
Luggages: ${booking.luggage ?? "-"}
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
        ${summaryRow("Pickup Address", normalizePlaceName(booking.pickup_address))}
        ${summaryRow("Dropoff Address", normalizePlaceName(booking.dropoff_address))}
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
Pickup Address: ${normalizePlaceName(booking.pickup_address) || "-"}
Dropoff Address: ${normalizePlaceName(booking.dropoff_address) || "-"}
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

// ─── Admin email helpers ──────────────────────────────────────────────────────

function formatDateParts(iso) {
  if (!iso) return { date: "-", time: "-" };
  try {
    const d = new Date(iso);
    const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "Europe/Athens" }).format(d);
    const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "Europe/Athens" }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Athens",
    }).format(d);
    return { date: `${month} ${day}`, time };
  } catch {
    return { date: "-", time: "-" };
  }
}

function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function truncate(str, n) {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

function phoneForWA(phone) {
  return (phone || "").replace(/[^\d]/g, "");
}

function adminSummaryRow(label, value) {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee7db;">
        <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">${esc(label)}</div>
        <div style="font-size:15px;font-weight:600;color:#2b2b2b;">${esc(value || "-")}</div>
      </td>
    </tr>
  `;
}

function sectionHeader(label) {
  return `<h3 style="margin:24px 0 10px 0;font-size:13px;color:#6a655c;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">${esc(label)}</h3>`;
}

function shortenLocation(fullAddress) {
  const lower = String(fullAddress || "").toLowerCase();
  const replacements = [
    { match: ["athens international airport", "eleftherios venizelos", "ath airport", "attiki odos, spata 19019, greece"], short: "Airport" },
    { match: ["piraeus port", "piraeus cruise"], short: "Piraeus Port" },
    { match: ["rafina port"], short: "Rafina Port" },
    { match: ["lavrio port"], short: "Lavrio Port" },
    { match: ["syntagma square"], short: "Syntagma" },
    { match: ["monastiraki square"], short: "Monastiraki" },
    { match: ["plaka, athens"], short: "Plaka" },
    { match: ["acropolis"], short: "Acropolis" },
    { match: ["voula"], short: "Voula" },
  ];
  for (const r of replacements) {
    if (r.match.some((m) => lower.includes(m))) return r.short;
  }
  const first = String(fullAddress || "").split(",")[0].trim();
  return first.length > 22 ? first.slice(0, 22) : first;
}

// ─── Transfer admin email ─────────────────────────────────────────────────────

function buildTransferAdminEmail(booking) {
  const { date, time } = formatDateParts(booking.start_time);
  const { first, last } = splitName(booking.customer_name);
  const routeSummary = `${shortenLocation(booking.pickup_address)} → ${shortenLocation(booking.dropoff_address)}`;
  const customerLabel = [first, last].filter(Boolean).join(" ");

  const subject = "You have a new booking for Selene Lux";

  const waPhone = phoneForWA(booking.customer_phone);
  const waText = `Hi ${first || "there"}, this is Anthony from Selene Lux. Confirming your booking for ${date}, ${time}.`;
  const waUrl = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`
    : null;
  const stripeUrl = booking.stripe_payment_intent_id
    ? `https://dashboard.stripe.com/payments/${booking.stripe_payment_intent_id}`
    : null;

  const siteUrl = getSiteUrl(booking);
  const contactEmail = getContactEmail();
  const contactPhone = getContactPhone();

  const footerLines = [
    "<strong>Selene Lux</strong> — Operator View",
    contactEmail,
    contactPhone,
    siteUrl,
  ];

  const arrival =
    booking.arrival_reference
      ? `${booking.arrival_type ? booking.arrival_type + " " : ""}${booking.arrival_reference}`.trim()
      : null;

  const cta = `
    <div style="margin:0 0 24px 0;text-align:center;">
      ${waUrl ? `<a href="${esc(waUrl)}" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;margin:4px;">📱 WhatsApp customer</a>` : ""}
      <a href="mailto:${esc(booking.customer_email || "")}" style="display:inline-block;background:#2b2b2b;color:#f4f1ea;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;margin:4px;">✉️ Email customer</a>
      ${stripeUrl ? `<a href="${esc(stripeUrl)}" style="display:inline-block;background:#635BFF;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;margin:4px;">💳 View in Stripe</a>` : ""}
    </div>
  `;

  const customerBlock = `
    ${sectionHeader("Customer")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7db;border-radius:12px;padding:0 16px;background:#fffdf9;margin-bottom:4px;">
      ${adminSummaryRow("Full Name", booking.customer_name)}
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee7db;">
          <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">Email</div>
          <div style="font-size:15px;font-weight:600;color:#2b2b2b;">
            <a href="mailto:${esc(booking.customer_email || "")}" style="color:#2b2b2b;text-decoration:underline;">${esc(booking.customer_email || "-")}</a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee7db;">
          <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">Phone</div>
          <div style="font-size:15px;font-weight:600;color:#2b2b2b;">
            <a href="tel:${esc(booking.customer_phone || "")}" style="color:#2b2b2b;text-decoration:none;">${esc(booking.customer_phone || "-")}</a>
            ${waUrl ? `&nbsp;&nbsp;<a href="${esc(waUrl)}" style="color:#25D366;font-size:13px;font-weight:600;text-decoration:none;">WhatsApp</a>` : ""}
          </div>
        </td>
      </tr>
      ${adminSummaryRow("Booking ID", booking.booking_id)}
    </table>
  `;

  const bookingBlock = `
    ${sectionHeader("Transfer Details")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7db;border-radius:12px;padding:0 16px;background:#fffdf9;margin-bottom:4px;">
      ${adminSummaryRow("Pickup Date & Time", `${date} ${time}`)}
      ${adminSummaryRow("Pickup Address", normalizePlaceName(booking.pickup_address))}
      ${adminSummaryRow("Dropoff Address", normalizePlaceName(booking.dropoff_address))}
      ${booking.distance_km ? adminSummaryRow("Distance", `${booking.distance_km} km`) : ""}
      ${booking.duration_min ? adminSummaryRow("Est. Duration", `${booking.duration_min} min`) : ""}
      ${arrival ? adminSummaryRow("Arrival Reference", arrival) : ""}
      ${adminSummaryRow("Passengers", String(booking.passengers ?? "-"))}
      ${adminSummaryRow("Luggage", String(booking.luggage ?? "-"))}
      ${adminSummaryRow("Vehicle", "Mercedes Vito")}
    </table>
  `;

  const paymentBlock = `
    ${sectionHeader("Payment")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7db;border-radius:12px;padding:0 16px;background:#fffdf9;margin-bottom:4px;">
      ${adminSummaryRow("Total", booking.price_total_eur != null ? `€${booking.price_total_eur}` : "-")}
      ${adminSummaryRow("Status", "Paid via Stripe")}
      <tr>
        <td style="padding:10px 0;">
          <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">Payment Intent</div>
          <div style="font-family:monospace;font-size:13px;color:#5c564d;">${esc(booking.stripe_payment_intent_id || "-")}</div>
        </td>
      </tr>
    </table>
  `;

  const bodyHtml = `
    <div style="font-size:15px;line-height:1.7;color:#2b2b2b;">
      ${cta}
      ${customerBlock}
      ${bookingBlock}
      ${paymentBlock}
    </div>
  `;

  const html = baseEmailLayout({
    previewText: `${booking.customer_name || "Guest"} — ${routeSummary} — ${date} ${time} — €${booking.price_total_eur ?? "?"}`,
    header: "Selene Lux — New Booking",
    bodyHtml,
    primaryLabel: null,
    primaryUrl: null,
    secondaryLabel: null,
    secondaryUrl: null,
    footerLines,
  });

  const arrivalLine = arrival ? `Arrival Reference: ${arrival}\n` : "";
  const distanceLine = booking.distance_km ? `Distance:   ${booking.distance_km} km\n` : "";
  const durationLine = booking.duration_min ? `Duration:   ${booking.duration_min} min\n` : "";

  const text = `
NEW TRANSFER BOOKING -- Selene Lux
===================================

CUSTOMER
--------
Full Name:  ${booking.customer_name || "-"}
Email:      ${booking.customer_email || "-"}
Phone:      ${booking.customer_phone || "-"}
Booking ID: ${booking.booking_id || "-"}

TRANSFER DETAILS
----------------
Pickup:     ${date} ${time}
            ${normalizePlaceName(booking.pickup_address) || "-"}
Dropoff:    ${normalizePlaceName(booking.dropoff_address) || "-"}
${distanceLine}${durationLine}${arrivalLine}Passengers: ${booking.passengers ?? "-"}
Luggage:    ${booking.luggage ?? "-"}
Vehicle:    Mercedes Vito

PAYMENT
-------
Total:  EUR ${booking.price_total_eur ?? "-"}
Status: Paid via Stripe
PI:     ${booking.stripe_payment_intent_id || "-"}
  `.trim();

  return { subject, html, text };
}

// ─── Tour admin email ─────────────────────────────────────────────────────────

function buildTourAdminEmail(booking) {
  const { date, time } = formatDateParts(booking.start_time);
  const { first, last } = splitName(booking.customer_name);
  const tourName =
    booking.tour_name ||
    booking.tour_title ||
    booking.tour ||
    booking.service_name ||
    "-";
  const customerLabel = [first, last].filter(Boolean).join(" ");

  const subject = "You have a new booking for Selene Lux";

  const waPhone = phoneForWA(booking.customer_phone);
  const waText = `Hi ${first || "there"}, this is Anthony from Selene Lux. Confirming your booking for ${date}, ${time}.`;
  const waUrl = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}`
    : null;
  const stripeUrl = booking.stripe_payment_intent_id
    ? `https://dashboard.stripe.com/payments/${booking.stripe_payment_intent_id}`
    : null;

  const siteUrl = getSiteUrl(booking);
  const contactEmail = getContactEmail();
  const contactPhone = getContactPhone();

  const footerLines = [
    "<strong>Selene Lux</strong> — Operator View",
    contactEmail,
    contactPhone,
    siteUrl,
  ];

  const cta = `
    <div style="margin:0 0 24px 0;text-align:center;">
      ${waUrl ? `<a href="${esc(waUrl)}" style="display:inline-block;background:#25D366;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;margin:4px;">📱 WhatsApp customer</a>` : ""}
      <a href="mailto:${esc(booking.customer_email || "")}" style="display:inline-block;background:#2b2b2b;color:#f4f1ea;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;margin:4px;">✉️ Email customer</a>
      ${stripeUrl ? `<a href="${esc(stripeUrl)}" style="display:inline-block;background:#635BFF;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;margin:4px;">💳 View in Stripe</a>` : ""}
    </div>
  `;

  const customerBlock = `
    ${sectionHeader("Customer")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7db;border-radius:12px;padding:0 16px;background:#fffdf9;margin-bottom:4px;">
      ${adminSummaryRow("Full Name", booking.customer_name)}
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee7db;">
          <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">Email</div>
          <div style="font-size:15px;font-weight:600;color:#2b2b2b;">
            <a href="mailto:${esc(booking.customer_email || "")}" style="color:#2b2b2b;text-decoration:underline;">${esc(booking.customer_email || "-")}</a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee7db;">
          <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">Phone</div>
          <div style="font-size:15px;font-weight:600;color:#2b2b2b;">
            <a href="tel:${esc(booking.customer_phone || "")}" style="color:#2b2b2b;text-decoration:none;">${esc(booking.customer_phone || "-")}</a>
            ${waUrl ? `&nbsp;&nbsp;<a href="${esc(waUrl)}" style="color:#25D366;font-size:13px;font-weight:600;text-decoration:none;">WhatsApp</a>` : ""}
          </div>
        </td>
      </tr>
      ${adminSummaryRow("Booking ID", booking.booking_id)}
    </table>
  `;

  const pickupLabel =
    booking.pickup_mode === "airport"
      ? "Airport"
      : booking.pickup_mode === "piraeus_port"
      ? "Piraeus Port"
      : booking.pickup_mode === "custom"
      ? "Custom location"
      : booking.pickup_mode || "Pickup";

  const dropoffLabel =
    booking.dropoff_mode === "same_as_pickup"
      ? "Same as pickup"
      : booking.dropoff_mode === "airport"
      ? "Airport"
      : booking.dropoff_mode === "piraeus_port"
      ? "Piraeus Port"
      : booking.dropoff_mode === "custom"
      ? "Custom location"
      : booking.dropoff_mode || "Dropoff";

  const bookingBlock = `
    ${sectionHeader("Tour Details")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7db;border-radius:12px;padding:0 16px;background:#fffdf9;margin-bottom:4px;">
      ${adminSummaryRow("Tour", tourName)}
      ${adminSummaryRow("Pickup Date & Time", `${date} ${time}`)}
      ${adminSummaryRow(`Pickup (${pickupLabel})`, normalizePlaceName(booking.pickup_address))}
      ${adminSummaryRow(`Dropoff (${dropoffLabel})`, normalizePlaceName(booking.dropoff_address))}
      ${booking.extra_hours ? adminSummaryRow("Extra Hours", String(booking.extra_hours)) : ""}
      ${adminSummaryRow("Passengers", String(booking.passengers ?? "-"))}
    </table>
  `;

  const paymentBlock = `
    ${sectionHeader("Payment")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee7db;border-radius:12px;padding:0 16px;background:#fffdf9;margin-bottom:4px;">
      ${adminSummaryRow("Total", booking.price_total_eur != null ? `€${booking.price_total_eur}` : "-")}
      ${adminSummaryRow("Status", "Paid via Stripe")}
      <tr>
        <td style="padding:10px 0;">
          <div style="font-size:12px;color:#6a655c;margin-bottom:3px;">Payment Intent</div>
          <div style="font-family:monospace;font-size:13px;color:#5c564d;">${esc(booking.stripe_payment_intent_id || "-")}</div>
        </td>
      </tr>
    </table>
  `;

  const bodyHtml = `
    <div style="font-size:15px;line-height:1.7;color:#2b2b2b;">
      ${cta}
      ${customerBlock}
      ${bookingBlock}
      ${paymentBlock}
    </div>
  `;

  const html = baseEmailLayout({
    previewText: `${booking.customer_name || "Guest"} — ${tourName} — ${date} ${time} — €${booking.price_total_eur ?? "?"}`,
    header: "Selene Lux — New Booking",
    bodyHtml,
    primaryLabel: null,
    primaryUrl: null,
    secondaryLabel: null,
    secondaryUrl: null,
    footerLines,
  });

  const extraHoursLine = booking.extra_hours ? `Extra Hours: ${booking.extra_hours}\n` : "";

  const text = `
NEW TOUR BOOKING -- Selene Lux
================================

CUSTOMER
--------
Full Name:  ${booking.customer_name || "-"}
Email:      ${booking.customer_email || "-"}
Phone:      ${booking.customer_phone || "-"}
Booking ID: ${booking.booking_id || "-"}

TOUR DETAILS
------------
Tour:       ${tourName}
Date/Time:  ${date} ${time}
Pickup (${pickupLabel}): ${normalizePlaceName(booking.pickup_address) || "-"}
Dropoff (${dropoffLabel}): ${normalizePlaceName(booking.dropoff_address) || "-"}
${extraHoursLine}Passengers: ${booking.passengers ?? "-"}

PAYMENT
-------
Total:  EUR ${booking.price_total_eur ?? "-"}
Status: Paid via Stripe
PI:     ${booking.stripe_payment_intent_id || "-"}
  `.trim();

  return { subject, html, text };
}

module.exports = {
  buildTransferConfirmationEmail,
  buildTourConfirmationEmail,
  buildTransferAdminEmail,
  buildTourAdminEmail,
};
