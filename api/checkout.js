const Stripe = require("stripe");
const { bookingsTable } = require("../lib/airtable");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

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

    // These can be placeholder Webflow pages for now
    const successUrl = process.env.SUCCESS_URL || "https://example.com/success";
    const cancelUrl = process.env.CANCEL_URL || "https://example.com/cancel";

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

    // Save session id in Airtable (optional but useful)
    await bookingsTable().update([
      {
        id: booking.id,
        fields: {
          stripe_session_id: session.id,
        },
      },
    ]);

    return res.status(200).json({ ok: true, checkout_url: session.url });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};