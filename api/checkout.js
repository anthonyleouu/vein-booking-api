const Stripe = require("stripe");
const { bookingsTable } = require("../lib/airtable");
const { applyCors } = require("../lib/cors");
const { escapeFormulaValue } = require("../lib/airtable-escape");

function getPublicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "https://selenelux.co").replace(/\/+$/, "");
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { hold_booking_id } = body || {};

    if (!hold_booking_id) {
      return res.status(400).json({ ok: false, error: "hold_booking_id required" });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const records = await bookingsTable()
      .select({
        maxRecords: 1,
        filterByFormula: `{booking_id}='${escapeFormulaValue(hold_booking_id)}'`,
      })
      .firstPage();

    if (!records.length) {
      return res.status(404).json({ ok: false, error: "Booking not found" });
    }

    const booking = records[0];
    const f = booking.fields;

    if (f.status !== "HOLD") {
      return res.status(400).json({ ok: false, error: "Booking not in HOLD state" });
    }

    if (f.expires_at && new Date(f.expires_at) < new Date()) {
      return res.status(400).json({ ok: false, error: "Hold expired" });
    }

    // ---- IDEMPOTENCY ----
    // If the customer already clicked Confirm once and we already created a
    // Stripe Checkout Session for this hold, return the same URL instead of
    // creating a duplicate session. Protects against double-click / refresh.
    if (f.stripe_session_id) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(f.stripe_session_id);
        if (existing && existing.status !== "expired" && existing.url) {
          return res.status(200).json({
            ok: true,
            url: existing.url,
            checkout_url: existing.url,
            reused: true,
          });
        }
      } catch (err) {
        // If retrieve fails for any reason, fall through and create a fresh session.
        console.warn("Existing session retrieve failed, creating new:", err.message);
      }
    }

    const amount = Math.round(Number(f.price_total_eur || 0) * 100);
    if (!amount || amount < 50) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const baseUrl = getPublicBaseUrl();
    const successUrl = process.env.SUCCESS_URL || `${baseUrl}/successful-book`;
    const cancelUrl = process.env.CANCEL_URL || `${baseUrl}/failed-book`;

    const productName =
      f.service_type === "TOUR"
        ? `Tour Booking - ${f.tour_name || "Private Tour"}`
        : `${f.service_type || "Booking"} - Mercedes Vito`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: f.customer_email || undefined,
        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: { name: productName },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        // client_reference_id is a Stripe-native fallback for matching
        // the booking if metadata is ever stripped by a proxy.
        client_reference_id: hold_booking_id,
        metadata: {
          booking_id: hold_booking_id,
          service_type: f.service_type || "",
          tour_id: f.tour_id || "",
          tour_name: f.tour_name || "",
          customer_email: f.customer_email || "",
          passengers: String(f.passengers || ""),
          extra_hours: String(f.extra_hours || ""),
          pickup_mode: f.pickup_mode || "",
          dropoff_mode: f.dropoff_mode || "",
          // Stripe metadata values must be <= 500 chars; truncate addresses.
          pickup_address: String(f.pickup_address || "").slice(0, 500),
          dropoff_address: String(f.dropoff_address || "").slice(0, 500),
          start_time: f.start_time || "",
        },
      },
      {
        // Stripe-side idempotency key. If a network blip causes us to
        // accidentally fire this request twice, Stripe returns the same
        // session instead of creating two charges. Booking ID is unique
        // per hold so this is safe.
        idempotencyKey: `checkout:${hold_booking_id}`,
      }
    );

    await bookingsTable().update([
      {
        id: booking.id,
        fields: { stripe_session_id: session.id },
      },
    ]);

    return res.status(200).json({
      ok: true,
      url: session.url,
      checkout_url: session.url,
    });
  } catch (err) {
    console.error("CHECKOUT ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
