const crypto = require("crypto");
const { bookingsTable, configTable } = require("../lib/airtable");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("GET only");

    const token = req.query.token;
    if (!token) return res.status(400).send("Missing token");

    // Load config for cancel window
    const cfgRows = await configTable().select({ maxRecords: 1 }).firstPage();
    const cfg = cfgRows.length ? cfgRows[0].fields : {};
    const lockHours = Number(cfg.cancel_lock_hours || 24);

    const tokenHash = sha256(token);

    const records = await bookingsTable()
      .select({
        maxRecords: 1,
        filterByFormula: `{cancel_token_hash}='${tokenHash}'`,
      })
      .firstPage();

    if (!records.length) return res.status(404).send("Invalid cancellation link");

    const rec = records[0];
    const f = rec.fields;

    if (f.status !== "CONFIRMED") {
      return res.status(400).send("Booking is not cancellable");
    }

    const start = new Date(f.start_time);
    const now = new Date();
    const lockPoint = new Date(start.getTime() - lockHours * 60 * 60 * 1000);

    if (now >= lockPoint) {
      return res
        .status(403)
        .send(`Cancellation not allowed within ${lockHours} hours of pickup/start time.`);
    }

    await bookingsTable().update([
      {
        id: rec.id,
        fields: {
          status: "CANCELLED",
          cancelled_at: now.toISOString(),
        },
      },
    ]);

    // Later: trigger refund logic (optional) or keep as "request received".
    return res.status(200).send("Booking cancelled successfully.");
  } catch (err) {
    return res.status(500).send(err.message);
  }
};