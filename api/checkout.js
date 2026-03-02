const Stripe = require("stripe");
const { bookingsTable } = require("../lib/airtable");

module.exports = async (req, res) => {
  // ---- CORS (Webflow -> Vercel) ----
  const allowedOrigins = [
    "https://vip-athens-transfer.webflow.io",
    // add later:
    // "https://vip-athens-transfer.webflow.io",
    // "https://veindigital.co",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { hold_booking_id } = body;

    if (!hold_booking_id) {
      return res.status(400).json({ ok: false, error: "hold_booking_id required" });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY" });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const records = await bookingsTable()
      .select({
        maxRecords: 1,
        filterByFormula: `{booking_id}='${hold_booking_id}'`,
      })
      .firstPage();

    if (!records.length) return res.status(404).json({ ok: false, error: "Booking not found" });

    const booking = records[0];
    const f = booking.fields;

    if (f.status !== "HOLD") return res.status(400).json({ ok: false, error: "Booking not in HOLD state" });
    if (f.expires_at && new Date(f.expires_at) < new Date()) return res.status(400).json({ ok: false, error: "Hold expired" });

    const amount = Math.round(Number(f.price_total_eur || 0) * 100);
    if (!amount || amount < 50) return res.status(400).json({ ok: false, error: "Invalid amount" });

    // Your real Webflow pages (you gave these)
    const successUrl =
      process.env.SUCCESS_URL || "https://vip-athens-transfer.webflow.io/successful-book";
    const cancelUrl =
      process.env.CANCEL_URL || "https://vip-athens-transfer.webflow.io/failed-book";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${f.service_type || "Booking"} - Mercedes V-Class`,
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        booking_id: hold_booking_id,
      },
    });

    // Save session id (optional)
    await bookingsTable().update([
      {
        id: booking.id,
        fields: { stripe_session_id: session.id },
      },
    ]);

    // ✅ Return BOTH keys for compatibility (your front-end expects `url`)
    return res.status(200).json({
      ok: true,
      url: session.url,
      checkout_url: session.url,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};