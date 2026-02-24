const { configTable, toursTable } = require("../lib/airtable");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup } = require("../lib/pricing");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { service_type } = body;
    if (!service_type) return res.status(400).json({ ok: false, error: "service_type required" });

    // Load Config (single row)
    const cfgRows = await configTable().select({ maxRecords: 1, view: "Grid view" }).firstPage();
    if (!cfgRows.length) return res.status(500).json({ ok: false, error: "Config row missing" });
    const cfg = cfgRows[0].fields;

    // ---- TOUR QUOTE ----
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

    // ---- TRANSFER QUOTE (placeholder pricing for now) ----
    if (service_type === "TRANSFER") {
      const { pickup_datetime_iso } = body;
      if (!pickup_datetime_iso) return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });

      const pickup = new Date(pickup_datetime_iso);
      const night = isNightPickup(pickup, Number(cfg.night_start_hour ?? 0), Number(cfg.night_end_hour ?? 6));

      // For now: just demonstrate night surcharge working
      const base = Number(cfg.transfer_base_fare || 0);
      let total = base;

      if (night && cfg.night_type === "PERCENT") total = Math.round(base * (1 + Number(cfg.night_value || 0) / 100));
      if (night && cfg.night_type === "FIXED") total = base + Number(cfg.night_value || 0);

      // For availability demo: assume transfer takes 60 minutes
      const start = pickup;
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const blockStart = new Date(start.getTime() - Number(cfg.transfer_buffer_before_min || 0) * 60 * 1000);
      const blockEnd = new Date(end.getTime() + Number(cfg.transfer_buffer_after_min || 0) * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({ ok: true, available: false, message: "No Vehicles Available" });
      }

      return res.status(200).json({
        ok: true,
        available: true,
        vehicle: "Mercedes V-Class",
        is_night: night,
        price_total_eur: total,
        price_breakdown: { base_fare: base, night_applied: night, night_type: cfg.night_type, night_value: cfg.night_value },
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown service_type" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};