const Stripe = require("stripe");
const getRawBody = require("raw-body");
const crypto = require("crypto");
const { bookingsTable } = require("../lib/airtable");
const { escapeFormulaValue } = require("../lib/airtable-escape");
const { sendBookingEmails } = require("../lib/email");
const {
  buildTransferConfirmationEmail,
  buildTourConfirmationEmail,
} = require("../lib/email-templates");

// CRITICAL: Stripe webhooks require the raw, unmodified request body in order
// to verify the signature. Vercel's default JSON body parser would mutate the
// payload and break verification. This config disables it for THIS endpoint
// only. Without it, live webhooks may fail intermittently under load.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function getPublicBaseUrl() {
  // Used to build the customer-facing cancel link inserted into the email.
  // PUBLIC_BASE_URL should be the live website root (e.g. https://selenelux.co).
  return (
    process.env.PUBLIC_BASE_URL ||
    "https://selenelux.co"
  ).replace(/\/+$/, "");
}

function getApiBaseUrl() {
  // Used to build the /api/cancel link the customer clicks from their email.
  // API_BASE_URL should be the Vercel deployment URL of this API.
  return (
    process.env.API_BASE_URL ||
    "https://vein-booking-api.vercel.app"
  ).replace(/\/+$/, "");
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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Pin the API version explicitly so Stripe never silently upgrades the
      // behaviour of our integration. Bump intentionally during maintenance.
      apiVersion: "2024-06-20",
    });

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
            filterByFormula: `{booking_id}='${escapeFormulaValue(bookingId)}'`,
          })
          .firstPage();

        if (records.length) {
          const rec = records[0];
          const f = rec.fields;

          // ---- IDEMPOTENCY ----
          // Stripe retries webhooks aggressively. If this booking is already
          // CONFIRMED, just acknowledge and move on. Without this guard a
          // network blip during the email send would cause Stripe to retry
          // and the customer would receive duplicate confirmation emails.
          if (f.status === "CONFIRMED") {
            console.log("Webhook idempotent skip — already CONFIRMED:", bookingId);
            return res.status(200).json({ received: true, idempotent: true });
          }

          // Generate cancel token (raw) + store only hash.
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
            site_url: getPublicBaseUrl(),
          };

          let emailPayload = null;

          if (bookingData.service_type === "TRANSFER") {
            emailPayload = buildTransferConfirmationEmail(bookingData);
          }

          if (bookingData.service_type === "TOUR") {
            emailPayload = buildTourConfirmationEmail(bookingData);
          }

          if (emailPayload) {
            try {
              await sendBookingEmails({
                toCustomer: bookingData.customer_email || null,
                subject: emailPayload.subject,
                html: emailPayload.html,
                text: emailPayload.text,
              });
            } catch (emailErr) {
              // Booking IS confirmed (payment was successful + Airtable
              // updated). Email is best-effort. Log it but return 200 so
              // Stripe doesn't retry and double-confirm. The admin still
              // sees the booking in Airtable and Stripe; we can resend
              // the email manually from there.
              console.error("Email send failed (booking still confirmed):", emailErr.message);
            }
          } else {
            console.warn("No email template matched service_type:", bookingData.service_type);
          }
        } else {
          console.warn("Webhook: booking not found for id:", bookingId);
        }
      } else {
        console.warn("Webhook: checkout.session.completed missing booking_id metadata");
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};
