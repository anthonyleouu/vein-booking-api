const crypto = require("crypto");
const { configTable, toursTable, bookingsTable } = require("../lib/airtable");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup } = require("../lib/pricing");

module.exports = async (req, res) => {
  // ---- CORS (Webflow -> Vercel) ----
  const allowedOrigins = [
    "https://vip-athens-transfer.webflow.io",
    // add your custom domain later, e.g.
    // "https://veindigital.co"
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
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { service_type } = body;
    if (!service_type) return res.status(400).json({ ok: false, error: "service_type required" });

    // ---- Arrival monitoring (optional) ----
    // Accept either:
    // body.arrival.flight_number / body.arrival.vessel_name  (your current Webflow state)
    // OR body.arrival_type / body.arrival_reference          (direct)
    const flight = (body?.arrival?.flight_number || "").trim();
    const vessel = (body?.arrival?.vessel_name || "").trim();

    let arrival_type = (body?.arrival_type || "").trim();
    let arrival_reference = (body?.arrival_reference || "").trim();

    if (!arrival_reference) {
      if (flight) {
        arrival_type = "FLIGHT";
        arrival_reference = flight;
      } else if (vessel) {
        arrival_type = "BOAT";
        arrival_reference = vessel;
      }
    }

    // ---- Customer fields (tolerant) ----
    // Support both:
    // customer_name (old) OR customer_first_name + customer_last_name (new)
    const customer_first_name = (body.customer_first_name || "").trim();
    const customer_last_name = (body.customer_last_name || "").trim();
    const customer_name =
      (body.customer_name || `${customer_first_name} ${customer_last_name}`.trim() || "").trim();

    const customer_email = (body.customer_email || "").trim();
    const customer_phone = (body.customer_phone || "").trim();

    // Load Config (single row)
    const cfgRows = await configTable().select({ maxRecords: 1 }).firstPage();
    if (!cfgRows.length) return res.status(500).json({ ok: false, error: "Config row missing" });
    const cfg = cfgRows[0].fields;

    const holdMins = Number(cfg.hold_expiry_minutes || 15);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + holdMins * 60 * 1000);

    // ---------------- TOUR HOLD ----------------
    if (service_type === "TOUR") {
      const { tour_id, passengers, extra_hours, pickup_datetime_iso } = body;
      if (!tour_id) return res.status(400).json({ ok: false, error: "tour_id required" });
      if (!pickup_datetime_iso) return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });

      const tourRows = await toursTable()
        .select({ maxRecords: 1, filterByFormula: `{tour_id}='${tour_id}'` })
        .firstPage();
      if (!tourRows.length) return res.status(404).json({ ok: false, error: "Tour not found" });
      const tour = tourRows[0].fields;

      const pricing = tourPrice({ passengers, extraHours: extra_hours, tour });

      const start = new Date(pickup_datetime_iso);
      const durationHours = Number(tour.included_duration_hours) + Number(extra_hours || 0);
      const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

      const blockStart = new Date(start.getTime() - Number(tour.buffer_before_min || 0) * 60 * 1000);
      const blockEnd = new Date(end.getTime() + Number(tour.buffer_after_min || 0) * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });
      }

      const bookingId = crypto.randomUUID();

      const fields = {
        booking_id: bookingId,
        status: "HOLD",
        service_type: "TOUR",

        start_time: start.toISOString(),
        end_time: end.toISOString(),
        block_start: blockStart.toISOString(),
        block_end: blockEnd.toISOString(),

        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),

        customer_name: customer_name || "",
        customer_email: customer_email || "",
        customer_phone: customer_phone || "",

        tour_id: tour_id,
        tour_name: tour.tour_name || "",

        passengers: Number(passengers || 0),
        extra_hours: Number(extra_hours || 0),

        price_total_eur: pricing.total,
        price_breakdown_json: JSON.stringify(pricing.breakdown),
      };

      // ✅ Save arrival monitoring into Airtable (only if provided)
      if (arrival_reference) fields.arrival_reference = arrival_reference;
      if (arrival_type) fields.arrival_type = arrival_type;

      await bookingsTable().create([{ fields }]);

      return res.status(200).json({
        ok: true,
        available: true,
        hold_booking_id: bookingId,
        expires_at: expiresAt.toISOString(),
        price_total_eur: pricing.total,
        vehicle: "Mercedes V-Class",
      });
    }

    // ---------------- TRANSFER HOLD ----------------
    if (service_type === "TRANSFER") {
      const { pickup_datetime_iso } = body;
      if (!pickup_datetime_iso) return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });

      const pickup = new Date(pickup_datetime_iso);
      const night = isNightPickup(pickup, Number(cfg.night_start_hour ?? 0), Number(cfg.night_end_hour ?? 6));

      // temporary pricing: base fare + night modifier (we’ll replace later with km/min)
      const base = Number(cfg.transfer_base_fare || 0);
      let total = base;
      if (night && cfg.night_type === "PERCENT") total = Math.round(base * (1 + Number(cfg.night_value || 0) / 100));
      if (night && cfg.night_type === "FIXED") total = base + Number(cfg.night_value || 0);

      // temporary duration: 60 minutes
      const start = pickup;
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const blockStart = new Date(start.getTime() - Number(cfg.transfer_buffer_before_min || 0) * 60 * 1000);
      const blockEnd = new Date(end.getTime() + Number(cfg.transfer_buffer_after_min || 0) * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });
      }

      const bookingId = crypto.randomUUID();

      const fields = {
        booking_id: bookingId,
        status: "HOLD",
        service_type: "TRANSFER",

        start_time: start.toISOString(),
        end_time: end.toISOString(),
        block_start: blockStart.toISOString(),
        block_end: blockEnd.toISOString(),

        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),

        // optional customer info (will be filled once Step 4 submits)
        customer_name: customer_name || "",
        customer_email: customer_email || "",
        customer_phone: customer_phone || "",

        is_night: night ? true : false,
        price_total_eur: total,
        price_breakdown_json: JSON.stringify({
          base_fare: base,
          night_applied: night,
          night_type: cfg.night_type,
          night_value: cfg.night_value,
        }),
      };

      // ✅ Save arrival monitoring into Airtable (only if provided)
      if (arrival_reference) fields.arrival_reference = arrival_reference;
      if (arrival_type) fields.arrival_type = arrival_type;

      await bookingsTable().create([{ fields }]);

      return res.status(200).json({
        ok: true,
        available: true,
        hold_booking_id: bookingId,
        expires_at: expiresAt.toISOString(),
        price_total_eur: total,
        vehicle: "Mercedes V-Class",
        is_night: night,
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown service_type" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};