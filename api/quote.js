const { configTable, toursTable } = require("../lib/airtable");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup } = require("../lib/pricing");

module.exports = async (req, res) => {
  // ---- CORS (Webflow -> Vercel) ----
  const allowedOrigins = [
    "https://vip-athens-transfer.webflow.io",
    "https://veindigital.co",
    "https://www.veindigital.co",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // ✅ quick sanity output if you open in browser
    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        message: "quote endpoint reachable (use POST)",
        env: {
          has_AIRTABLE_TOKEN: !!process.env.AIRTABLE_TOKEN,
          has_AIRTABLE_API_KEY: !!process.env.AIRTABLE_API_KEY,
          has_AIRTABLE_BASE_ID: !!process.env.AIRTABLE_BASE_ID,
          has_GOOGLE_MAPS_SERVER_KEY: !!process.env.GOOGLE_MAPS_SERVER_KEY,
        },
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { service_type } = body;
    if (!service_type) return res.status(400).json({ ok: false, error: "service_type required" });

    // ---------------- TOUR QUOTE ----------------
    if (service_type === "TOUR") {
      // Load GLOBAL config (for hold/availability windows etc.)
      const cfgRows = await configTable()
        .select({ maxRecords: 1, filterByFormula: `{key}='GLOBAL'` })
        .firstPage();

      if (!cfgRows.length) return res.status(500).json({ ok: false, error: "Config row GLOBAL missing" });
      const cfg = cfgRows[0].fields;

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

      return res.status(200).json({
        ok: true,
        available: true,
        vehicle: "Mercedes V-Class",
        price_total_eur: pricing.total,
        price_breakdown: pricing.breakdown,
        time: {
          start: start.toISOString(),
          end: end.toISOString(),
          block_start: blockStart.toISOString(),
          block_end: blockEnd.toISOString(),
        },
      });
    }

    // ---------------- TRANSFER QUOTE ----------------
    if (service_type === "TRANSFER") {
      const { pickup_datetime_iso, pickup_place_id, dropoff_place_id } = body;

      if (!pickup_datetime_iso) return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });
      if (!pickup_place_id) return res.status(400).json({ ok: false, error: "pickup_place_id required" });
      if (!dropoff_place_id) return res.status(400).json({ ok: false, error: "dropoff_place_id required" });

      const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
      if (!serverKey) return res.status(500).json({ ok: false, error: "Missing GOOGLE_MAPS_SERVER_KEY env var" });

      // ✅ Since quote happens before vehicle selection, default vehicle is vclass
      const vehicleKey = "vclass";

      // Load GLOBAL + VEHICLE config rows
      const cfgRows = await configTable()
        .select({
          filterByFormula: `OR({key}='GLOBAL',{key}='${vehicleKey}')`,
        })
        .firstPage();

      const globalRow = cfgRows.find((r) => r.fields?.key === "GLOBAL");
      const vehicleRow = cfgRows.find((r) => r.fields?.key === vehicleKey);

      if (!globalRow) return res.status(500).json({ ok: false, error: "Config row GLOBAL missing" });
      if (!vehicleRow) return res.status(500).json({ ok: false, error: `Config row ${vehicleKey} missing` });

      const globalCfg = globalRow.fields;
      const vcfg = vehicleRow.fields;

      const pickup = new Date(pickup_datetime_iso);

      // night hours come from GLOBAL if set, otherwise fallback to vehicle row
      const nightStart = Number(
        (globalCfg.night_start_hour ?? vcfg.night_start_hour ?? 0)
      );
      const nightEnd = Number(
        (globalCfg.night_end_hour ?? vcfg.night_end_hour ?? 6)
      );

      const night = isNightPickup(pickup, nightStart, nightEnd);

      // Distance Matrix
      const origins = `place_id:${pickup_place_id}`;
      const destinations = `place_id:${dropoff_place_id}`;

      const dmUrl =
        "https://maps.googleapis.com/maps/api/distancematrix/json" +
        `?origins=${encodeURIComponent(origins)}` +
        `&destinations=${encodeURIComponent(destinations)}` +
        `&mode=driving` +
        `&units=metric` +
        `&key=${encodeURIComponent(serverKey)}`;

      const dmRes = await fetch(dmUrl);
      const dmJson = await dmRes.json();

      if (!dmRes.ok || dmJson.status !== "OK") {
        return res.status(500).json({ ok: false, error: "Distance Matrix failed", details: dmJson });
      }

      const element = dmJson?.rows?.[0]?.elements?.[0];
      if (!element || element.status !== "OK") {
        return res.status(500).json({ ok: false, error: "No route found", details: dmJson });
      }

      const distance_m = element.distance.value; // meters
      const duration_s = element.duration.value; // seconds

      const distance_km = Math.round((distance_m / 1000) * 10) / 10; // 1 decimal
      const duration_min = Math.round(duration_s / 60);

      // ✅ Pricing from VEHICLE row using your Airtable field names
      const base = Number(vcfg.transfer_base_fare || 0);
      const rate = Number(vcfg.transfer_rate_per_km || 0);
      const freeKm = Number(vcfg.transfer_free_km || 0);
      const minFare = Number(vcfg.transfer_minimum_fare || 0);

      const extraKm = Math.max(0, distance_km - freeKm);
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

      total = Math.floor(total);

      // Availability demo: still 60 minutes (same as your current logic)
      const start = pickup;
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const bufferBefore = Number(globalCfg.transfer_buffer_before_min ?? 0);
      const bufferAfter = Number(globalCfg.transfer_buffer_after_min ?? 0);

      const blockStart = new Date(start.getTime() - bufferBefore * 60 * 1000);
      const blockEnd = new Date(end.getTime() + bufferAfter * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });
      }

      return res.status(200).json({
        ok: true,
        available: true,
        vehicle: "Mercedes V-Class",
        vehicle_key: vehicleKey,
        is_night: night,
        distance_km,
        duration_min,
        price_total_eur: total,
        price_breakdown: {
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
        },
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown service_type" });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message,
      name: err.name,
      stack: err.stack,
    });
  }
};