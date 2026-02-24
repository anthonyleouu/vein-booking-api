const Stripe = require("stripe");
const getRawBody = require("raw-body");
const crypto = require("crypto");
const { bookingsTable } = require("../lib/airtable");

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

          // Create cancel token once
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

          // For now we are NOT emailing yet.
          // We'll email rawToken later; keep it ready by storing it temporarily in logs (optional).
          // console.log("CANCEL_TOKEN_FOR_BOOKING", bookingId, rawToken);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};