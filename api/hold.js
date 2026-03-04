const crypto = require("crypto");
const { configTable, toursTable, bookingsTable } = require("../lib/airtable");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup } = require("../lib/pricing");

module.exports = async (req, res) => {
  try {
    // ---- CORS (Webflow -> Vercel) ----
    const allowedOrigins = [
      "https://vip-athens-transfer.webflow.io",
      // add custom domain later
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { service_type } = body;
    if (!service_type) return res.status(400).json({ ok: false, error: "service_type required" });

    // Load Config (single row)
    const cfgRows = await configTable().select({ maxRecords: 1, view: "Grid view" }).firstPage();
    if (!cfgRows.length) return res.status(500).json({ ok: false, error: "Config row missing" });
    const cfg = cfgRows[0].fields;

    const holdMins = Number(cfg.hold_expiry_minutes || 15);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + holdMins * 60 * 1000);

    // ---------------- TOUR HOLD ----------------
    if (service_type === "TOUR") {
      const {
        tour_id,
        passengers,
        extra_hours,
        pickup_datetime_iso,
        customer_name,
        customer_email,
        customer_phone,
      } = body;

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
      if (conflicts.length) return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });

      const bookingId = crypto.randomUUID();

      await bookingsTable().create([
        {
          fields: {
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
          },
        },
      ]);

      return res.status(200).json({
        ok: true,
        available: true,
        hold_booking_id: bookingId,
        expires_at: expiresAt.toISOString(),
        price_total_eur: pricing.total,
        vehicle: "Mercedes V-Class",
      });
    }

    // ---------------- TRANSFER HOLD (FULL FIELDS) ----------------
    if (service_type === "TRANSFER") {
      const {
        pickup_datetime_iso,

        pickup_place_id,
        dropoff_place_id,
        pickup_address,
        dropoff_address,

        distance_km,
        duration_min,

        vehicle,
        passengers,
        luggage,

        customer_first_name,
        customer_last_name,
        customer_email,
        customer_phone,

        arrival, // { flight_number, vessel_name }
      } = body;

      if (!pickup_datetime_iso) return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });
      if (!pickup_place_id) return res.status(400).json({ ok: false, error: "pickup_place_id required" });
      if (!dropoff_place_id) return res.status(400).json({ ok: false, error: "dropoff_place_id required" });

      const start = new Date(pickup_datetime_iso);

      const night = isNightPickup(
        start,
        Number(cfg.night_start_hour ?? 0),
        Number(cfg.night_end_hour ?? 6)
      );

      // Use duration_min if provided (from quote). Fallback to 60.
      const durMin = Number(duration_min || 60);
      const end = new Date(start.getTime() + durMin * 60 * 1000);

      const blockStart = new Date(start.getTime() - Number(cfg.transfer_buffer_before_min || 0) * 60 * 1000);
      const blockEnd = new Date(end.getTime() + Number(cfg.transfer_buffer_after_min || 0) * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });

      // Pricing: keep your current placeholder (base + night modifier)
      const base = Number(cfg.transfer_base_fare || 0);
      let total = base;
      if (night && cfg.night_type === "PERCENT") total = Math.round(base * (1 + Number(cfg.night_value || 0) / 100));
      if (night && cfg.night_type === "FIXED") total = base + Number(cfg.night_value || 0);

      // Arrival mapping -> Airtable fields you already have
      const flight = (arrival?.flight_number || "").trim();
      const vessel = (arrival?.vessel_name || "").trim();

      let arrival_type = "";
      let arrival_reference = "";
      if (flight) {
        arrival_type = "FLIGHT";
        arrival_reference = flight;
      } else if (vessel) {
        arrival_type = "BOAT";
        arrival_reference = vessel;
      }

      const fn = (customer_first_name || "").trim();
      const ln = (customer_last_name || "").trim();
      const customer_name = `${fn} ${ln}`.trim();

      const bookingId = crypto.randomUUID();

      await bookingsTable().create([
        {
          fields: {
            booking_id: bookingId,
            status: "HOLD",
            service_type: "TRANSFER",

            start_time: start.toISOString(),
            end_time: end.toISOString(),
            block_start: blockStart.toISOString(),
            block_end: blockEnd.toISOString(),

            created_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),

            // Contact
            customer_name: customer_name,
            customer_first_name: fn,
            customer_last_name: ln,
            customer_email: (customer_email || "").trim(),
            customer_phone: (customer_phone || "").trim(),

            // Route
            pickup_place_id: pickup_place_id || "",
            dropoff_place_id: dropoff_place_id || "",
            pickup_address: (pickup_address || "").trim(),
            dropoff_address: (dropoff_address || "").trim(),

            // Metrics
            distance_km: distance_km != null ? Number(distance_km) : null,
            duration_min: durMin,

            // Options
            vehicle: (vehicle || "vclass").trim(),
            passengers: Number(passengers || 0),
            luggage: Number(luggage || 0),
            is_night: night ? true : false,

            // Arrival
            arrival_type: arrival_type,
            arrival_reference: arrival_reference,

            // Price
            price_total_eur: total,
            price_breakdown_json: JSON.stringify({
              base_fare: base,
              night_applied: night,
              night_type: cfg.night_type,
              night_value: cfg.night_value,
              distance_km: distance_km != null ? Number(distance_km) : null,
              duration_min: durMin,
            }),
          },
        },
      ]);

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