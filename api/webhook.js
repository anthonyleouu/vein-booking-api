const Stripe = require("stripe");
const getRawBody = require("raw-body");
const crypto = require("crypto");
const { bookingsTable } = require("../lib/airtable");
const { sendBookingEmails } = require("../lib/email");
const {
  buildTransferConfirmationEmail,
  buildTourConfirmationEmail,
} = require("../lib/email-templates");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("POST only");

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).send("Missing STRIPE_SECRET_KEY");
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).send("Missing stripe-signature header");
    }

    const buf = await getRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        buf,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const bookingId =
        (session.metadata && session.metadata.booking_id) ||
        session.client_reference_id;

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
                stripe_payment_intent_id: session.payment_intent || "",
                stripe_session_id: session.id || "",
                cancel_token_hash: tokenHash,
              },
            },
          ]);

          // Re-read latest booking state if needed later
          const bookingData = {
            booking_id: f.booking_id || bookingId,
            service_type: f.service_type || "",
            customer_name: f.customer_name || "",
            customer_email: f.customer_email || "",
            customer_phone: f.customer_phone || "",
            start_time: f.start_time || "",
            pickup_address: f.pickup_address || "",
            dropoff_address: f.dropoff_address || "",
            passengers: f.passengers || "",
            luggage: f.luggage || "",
            vehicle: f.vehicle || "Mercedes V-Class",
            price_total_eur: f.price_total_eur || "",
            tour_id: f.tour_id || "",
            tour_name: f.tour_name || "",
            extra_hours: f.extra_hours || "",
          };

          let emailPayload = null;

          if (bookingData.service_type === "TRANSFER") {
            emailPayload = buildTransferConfirmationEmail(bookingData);
          }

          if (bookingData.service_type === "TOUR") {
            emailPayload = buildTourConfirmationEmail(bookingData);
          }

          if (emailPayload) {
            await sendBookingEmails({
              toCustomer: bookingData.customer_email || null,
              subject: emailPayload.subject,
              html: emailPayload.html,
              text: emailPayload.text,
            });
          } else {
            console.warn("No email template matched service_type:", bookingData.service_type);
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};