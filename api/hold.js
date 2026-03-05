const crypto = require("crypto");
const { configTable, toursTable, bookingsTable } = require("../lib/airtable");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup } = require("../lib/pricing");

module.exports = async (req, res) => {
  // ---- CORS (Webflow -> Vercel) ----
  const allowedOrigins = [
    "https://vip-athens-transfer.webflow.io",
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
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { service_type } = body;
    if (!service_type) return res.status(400).json({ ok: false, error: "service_type required" });

    // Load GLOBAL config (explicit)
    const globalRows = await configTable()
      .select({ maxRecords: 1, filterByFormula: `{key}='GLOBAL'` })
      .firstPage();
    if (!globalRows.length) return res.status(500).json({ ok: false, error: "Config row GLOBAL missing" });
    const globalCfg = globalRows[0].fields;

    const holdMins = Number(globalCfg.hold_expiry_minutes || 15);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + holdMins * 60 * 1000);

    // ---------------- TOUR HOLD ----------------
    if (service_type === "TOUR") {
      const {
        tour_id,
        passengers,
        extra_hours,
        pickup_datetime_iso,

        // accept either naming style
        customer_name,
        customer_email,
        customer_phone,
        customer_first_name,
        customer_last_name,
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
      if (conflicts.length) {
        return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });
      }

      const bookingId = crypto.randomUUID();

      const nameCombined =
        (customer_name && String(customer_name).trim()) ||
        `${(customer_first_name || "").trim()} ${(customer_last_name || "").trim()}`.trim();

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

            // ✅ use existing Airtable fields
            customer_name: nameCombined || "",
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

    // ---------------- TRANSFER HOLD ----------------
    if (service_type === "TRANSFER") {
      const {
        pickup_datetime_iso,
        pickup_place_id,
        dropoff_place_id,
        distance_km,
        duration_min,
        vehicle,
        passengers,
        luggage,

        customer_first_name,
        customer_last_name,
        customer_email,
        customer_phone,

        arrival,
      } = body;

      if (!pickup_datetime_iso) return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });

      // determine vehicle key (default vclass)
      const vehicleKey = (vehicle || "vclass").toString().trim() || "vclass";

      // load vehicle config row
      const vehicleRows = await configTable()
        .select({ maxRecords: 1, filterByFormula: `{key}='${vehicleKey}'` })
        .firstPage();
      if (!vehicleRows.length) return res.status(500).json({ ok: false, error: `Config row ${vehicleKey} missing` });
      const vcfg = vehicleRows[0].fields;

      const pickup = new Date(pickup_datetime_iso);

      // night hours from GLOBAL if available, else from vehicle row
      const nightStart = Number(globalCfg.night_start_hour ?? vcfg.night_start_hour ?? 0);
      const nightEnd = Number(globalCfg.night_end_hour ?? vcfg.night_end_hour ?? 6);
      const night = isNightPickup(pickup, nightStart, nightEnd);

      // Use passed distance/duration from quote
      const distKm =
        typeof distance_km === "number" ? distance_km : Number(distance_km || 0) || 0;
      const durMin =
        typeof duration_min === "number" ? duration_min : Number(duration_min || 0) || 0;

      // Pricing from VEHICLE row using your Airtable field names
      const base = Number(vcfg.transfer_base_fare || 0);
      const rate = Number(vcfg.transfer_rate_per_km || 0);
      const freeKm = Number(vcfg.transfer_free_km || 0);
      const minFare = Number(vcfg.transfer_minimum_fare || 0);

      const extraKm = Math.max(0, distKm - freeKm);
      const distanceCost = extraKm * rate;

      let subtotal = base + distanceCost;
      if (minFare > 0) subtotal = Math.max(minFare, subtotal);

      let total = subtotal;

      const nightType = vcfg.night_type ?? globalCfg.night_type;
      const nightValue = Number((vcfg.night_value ?? globalCfg.night_value) || 0);

      if (night) {
        if (nightType === "PERCENT") total = subtotal * (1 + nightValue / 100);
        if (nightType === "FIXED") total = subtotal + nightValue;
      }

      total = Math.round(total * 100) / 100;

      // temporary duration: 60 minutes (kept same as your existing logic)
      const start = pickup;
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const bufferBefore = Number(globalCfg.transfer_buffer_before_min || 0);
      const bufferAfter = Number(globalCfg.transfer_buffer_after_min || 0);

      const blockStart = new Date(start.getTime() - bufferBefore * 60 * 1000);
      const blockEnd = new Date(end.getTime() + bufferAfter * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });
      }

      const bookingId = crypto.randomUUID();

      const nameCombined = `${(customer_first_name || "").trim()} ${(customer_last_name || "").trim()}`.trim();

      // Arrival mapping -> your Airtable fields: arrival_type + arrival_reference
      const flight = (arrival?.flight_number || "").trim();
      const vessel = (arrival?.vessel_name || "").trim();

      let arrival_type = "";
      let arrival_reference = "";
      if (flight) {
        arrival_type = "FLIGHT";
        arrival_reference = flight;
      } else if (vessel) {
        arrival_type = "SHIP";
        arrival_reference = vessel;
      }

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

            // ✅ IMPORTANT: these MUST match your Airtable column headers
            customer_name: nameCombined || "",
            customer_email: customer_email || "",
            customer_phone: customer_phone || "",

            pickup_place_id: pickup_place_id || "",
            dropoff_place_id: dropoff_place_id || "",
            distance_km: distKm,
            duration_min: durMin,
            vehicle: vehicleKey,
            passengers: Number(passengers || 0),
            luggage: Number(luggage || 0),

            arrival_type,
            arrival_reference,

            is_night: night ? true : false,
            price_total_eur: total,
            price_breakdown_json: JSON.stringify({
              base_fare: base,
              free_km: freeKm,
              extra_km: Math.round(extraKm * 10) / 10,
              rate_per_km: rate,
              distance_cost: Math.round(distanceCost * 100) / 100,
              minimum_fare: minFare,
              night_applied: night,
              night_type: nightType,
              night_value: nightValue,
              subtotal: Math.round(subtotal * 100) / 100,
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