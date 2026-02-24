const Stripe = require("stripe");
const getRawBody = require("raw-body");
const crypto = require("crypto");
const { bookingsTable } = require("../lib/airtable");
const { sendBookingEmails } = require("../lib/email");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const buf = await getRawBody(req);
    const sig = req.headers["stripe-signature"];

    const event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata.booking_id;

      if (bookingId) {
        const records = await bookingsTable()
          .select({
            maxRecords: 1,
            filterByFormula: `{booking_id}='${bookingId}'`,
          })
          .firstPage();

        if (records.length) {
          const rec = records[0];
          const f = rec.fields;

          // Generate cancel token (raw) + store only hash
          const rawToken = crypto.randomBytes(32).toString("hex");
          const tokenHash = sha256(rawToken);

          await bookingsTable().update([
            {
              id: rec.id,
              fields: {
                status: "CONFIRMED",
                stripe_payment_intent_id: session.payment_intent,
                cancel_token_hash: tokenHash,
              },
            },
          ]);

          // Build cancel link
          const cancelBase =
            process.env.CANCEL_LINK_BASE ||
            "https://vein-booking-api.vercel.app/api/cancel";
          const cancelLink = `${cancelBase}?token=${rawToken}`;

          // Email content
          const subject = `Booking Confirmed (${bookingId})`;

          const text =
            `Your booking is confirmed ✅\n\n` +
            `Booking ID: ${bookingId}\n` +
            `Service: ${f.service_type || ""}\n` +
            `Start: ${f.start_time || ""}\n` +
            `Price: €${f.price_total_eur || ""}\n\n` +
            `Cancellation (not allowed within 24h of start):\n${cancelLink}\n`;

          const html = `
            <div style="font-family:Arial,sans-serif;line-height:1.4">
              <h2>Booking Confirmed ✅</h2>
              <p><b>Booking ID:</b> ${bookingId}</p>
              <p><b>Service:</b> ${f.service_type || ""}</p>
              <p><b>Start:</b> ${f.start_time || ""}</p>
              <p><b>Price:</b> €${f.price_total_eur || ""}</p>
              <p><b>Cancellation:</b> Not allowed within 24 hours of start time.</p>
              <p><a href="${cancelLink}">Cancel booking</a></p>
            </div>
          `;

          // Send emails: customer (if present) + admin copy always
          await sendBookingEmails({
            toCustomer: f.customer_email || null,
            subject,
            html,
            text,
          });
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};