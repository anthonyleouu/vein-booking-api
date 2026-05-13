const crypto = require("crypto");
const Stripe = require("stripe");
const { bookingsTable, configTable } = require("../lib/airtable");
const { escapeFormulaValue } = require("../lib/airtable-escape");

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function getPublicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "https://selenelux.co").replace(/\/+$/, "");
}

/**
 * Redirects the customer back to a styled Webflow status page after the
 * /api/cancel link is clicked. The Webflow page can read the `status` query
 * param to show the right message and styling.
 *
 * Statuses produced here:
 *   ok               — booking cancelled, refund initiated
 *   already          — booking already cancelled previously
 *   not-found        — token doesn't match any booking
 *   not-cancellable  — booking isn't in CONFIRMED state
 *   too-late         — inside the cancellation lock window
 *   error            — server error
 */
function redirect(res, status, extra = {}) {
  const params = new URLSearchParams({ status, ...extra });
  const url = `${getPublicBaseUrl()}/cancellation?${params.toString()}`;
  res.writeHead(302, { Location: url });
  res.end();
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).send("GET only");

    const token = req.query?.token;
    if (!token) return redirect(res, "not-found");

    // Load global config for cancel-window length.
    const cfgRows = await configTable()
      .select({ maxRecords: 1, filterByFormula: `{key}='GLOBAL'` })
      .firstPage();
    const cfg = cfgRows.length ? cfgRows[0].fields : {};
    const lockHours = Number(cfg.cancel_lock_hours || 24);

    const tokenHash = sha256(String(token));

    const records = await bookingsTable()
      .select({
        maxRecords: 1,
        filterByFormula: `{cancel_token_hash}='${escapeFormulaValue(tokenHash)}'`,
      })
      .firstPage();

    if (!records.length) return redirect(res, "not-found");

    const rec = records[0];
    const f = rec.fields;

    if (f.status === "CANCELLED") {
      return redirect(res, "already");
    }

    if (f.status !== "CONFIRMED") {
      return redirect(res, "not-cancellable");
    }

    const start = new Date(f.start_time);
    const now = new Date();
    const lockPoint = new Date(start.getTime() - lockHours * 60 * 60 * 1000);

    if (now >= lockPoint) {
      return redirect(res, "too-late", { hours: String(lockHours) });
    }

    // ---- Process Stripe refund ----
    // The cancellation policy says cancellations more than `lockHours` before
    // pickup get a full refund. We do that automatically here. If the refund
    // fails, the customer still sees a "cancelled" page, but admin gets
    // alerted via logs to issue a manual refund.
    let refundStatus = "none";
    let refundId = "";

    if (f.stripe_payment_intent_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
          apiVersion: "2024-06-20",
        });

        const refund = await stripe.refunds.create(
          {
            payment_intent: f.stripe_payment_intent_id,
            reason: "requested_by_customer",
            metadata: {
              booking_id: f.booking_id || "",
            },
          },
          {
            idempotencyKey: `refund:${f.booking_id || rec.id}`,
          }
        );

        refundId = refund.id || "";
        refundStatus = refund.status || "pending";
      } catch (refundErr) {
        console.error("REFUND ERROR — manual refund required for booking", f.booking_id, refundErr.message);
        refundStatus = "manual_required";
      }
    } else {
      console.warn("Cancel without Stripe refund — missing payment_intent for booking", f.booking_id);
      refundStatus = "manual_required";
    }

    await bookingsTable().update([
      {
        id: rec.id,
        fields: {
          status: "CANCELLED",
          cancelled_at: now.toISOString(),
          stripe_refund_id: refundId,
          refund_status: refundStatus,
        },
      },
    ]);

    return redirect(res, "ok", { refund: refundStatus });
  } catch (err) {
    console.error("CANCEL ERROR:", err);
    return redirect(res, "error");
  }
};
