const Stripe = require("stripe");
const getRawBody = require("raw-body");
const { bookingsTable } = require("../lib/airtable");

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
          await bookingsTable().update([
            {
              id: records[0].id,
              fields: {
                status: "CONFIRMED",
                stripe_payment_intent: session.payment_intent,
              },
            },
          ]);
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
};