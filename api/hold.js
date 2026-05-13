const crypto = require("crypto");
const { configTable, toursTable, bookingsTable } = require("../lib/airtable");
const { applyCors } = require("../lib/cors");
const { escapeFormulaValue } = require("../lib/airtable-escape");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup } = require("../lib/pricing");

function presetAddressForMode(mode) {
  if (mode === "airport") return "Athens International Airport";
  if (mode === "piraeus_port") return "Piraeus Port";
  if (mode === "athens_center") return "Athens Center";
  return "";
}

function getAthensMinutes(dateObj) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dateObj);

  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

async function getDistanceMetrics({ originPlaceId, destinationPlaceId, serverKey }) {
  const origins = `place_id:${originPlaceId}`;
  const destinations = `place_id:${destinationPlaceId}`;

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
    throw new Error("Distance Matrix failed");
  }

  const element = dmJson?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") {
    throw new Error("No route found");
  }

  const distance_km = Math.round((element.distance.value / 1000) * 10) / 10;
  const duration_min = Math.round(element.duration.value / 60);

  return { distance_km, duration_min };
}

function transferPriceEquivalent({ distance_km, is_night, vehicleCfg }) {
  const base = Number(vehicleCfg.transfer_base_fare || 0);
  const rate = Number(vehicleCfg.transfer_rate_per_km || 0);
  const freeKm = Number(vehicleCfg.transfer_free_km || 0);
  const minFare = Number(vehicleCfg.transfer_minimum_fare || 0);

  const extraKm = Math.max(0, Number(distance_km || 0) - freeKm);
  const distanceCost = extraKm * rate;

  let subtotal = base + distanceCost;
  if (minFare > 0) subtotal = Math.max(minFare, subtotal);

  let total = subtotal;

  const nightType = vehicleCfg.night_type;
  const nightValue = Number(vehicleCfg.night_value || 0);

  if (is_night) {
    if (nightType === "PERCENT") total = subtotal * (1 + nightValue / 100);
    if (nightType === "FIXED") total = subtotal + nightValue;
  }

  total = Math.floor(total);

  return {
    total,
    subtotal,
    distance_km: Math.round(Number(distance_km || 0) * 10) / 10,
  };
}

async function getCustomTourAddon({ customPlaceId, homePlaceId, serverKey, vehicleCfg }) {
  const metrics = await getDistanceMetrics({
    originPlaceId: homePlaceId,
    destinationPlaceId: customPlaceId,
    serverKey,
  });

  const transferEquivalent = transferPriceEquivalent({
    distance_km: metrics.distance_km,
    is_night: false,
    vehicleCfg,
  });

  const addon = Math.round((Number(transferEquivalent.total || 0) / 2) * 100) / 100;

  return {
    addon,
    distance_km: metrics.distance_km,
    duration_min: metrics.duration_min,
    transfer_equivalent_total: transferEquivalent.total,
  };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { service_type } = body || {};

    if (!service_type) {
      return res.status(400).json({ ok: false, error: "service_type required" });
    }

    const globalRows = await configTable()
      .select({ maxRecords: 1, filterByFormula: `{key}='GLOBAL'` })
      .firstPage();

    if (!globalRows.length) {
      return res.status(500).json({ ok: false, error: "Config row GLOBAL missing" });
    }

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

        pickup_mode = "athens_center",
        dropoff_mode = "same_as_pickup",
        pickup_place_id,
        pickup_address,
        dropoff_place_id,
        dropoff_address,

        customer_name,
        customer_email,
        customer_phone,
        customer_first_name,
        customer_last_name,
      } = body;

      if (!tour_id) {
        return res.status(400).json({ ok: false, error: "tour_id required" });
      }

      if (!pickup_datetime_iso) {
        return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });
      }

      const pickupMode = String(pickup_mode || "athens_center").trim();
      const requestedDropoffMode = String(dropoff_mode || "same_as_pickup").trim();

      const allowedPickupModes = ["athens_center", "airport", "piraeus_port", "custom"];
      const allowedDropoffModes = ["same_as_pickup", "athens_center", "airport", "piraeus_port", "custom"];

      if (!allowedPickupModes.includes(pickupMode)) {
        return res.status(400).json({ ok: false, error: "Invalid pickup_mode" });
      }

      if (!allowedDropoffModes.includes(requestedDropoffMode)) {
        return res.status(400).json({ ok: false, error: "Invalid dropoff_mode" });
      }

      const pickupDate = new Date(pickup_datetime_iso);
      const pickupMinutes = getAthensMinutes(pickupDate);

      const startHour = Number(globalCfg.tour_pickup_start_hour ?? 8);
      const endHour = Number(globalCfg.tour_pickup_end_hour ?? 11);

      if (pickupMinutes < startHour * 60 || pickupMinutes > endHour * 60) {
        return res.status(400).json({
          ok: false,
          error: `Pickup time must be between ${String(startHour).padStart(2, "0")}:00 and ${String(endHour).padStart(2, "0")}:00`,
        });
      }

      const pickupNeedsAddress = pickupMode === "athens_center" || pickupMode === "custom";
      if (pickupNeedsAddress && !pickup_place_id) {
        return res.status(400).json({
          ok: false,
          error: "pickup_place_id required for selected pickup_mode",
        });
      }

      const effectiveDropoffMode =
        requestedDropoffMode === "same_as_pickup" ? pickupMode : requestedDropoffMode;

      const effectiveDropoffPlaceId =
        requestedDropoffMode === "same_as_pickup" ? (pickup_place_id || "") : (dropoff_place_id || "");

      const effectiveDropoffAddress =
        requestedDropoffMode === "same_as_pickup"
          ? (pickup_address || presetAddressForMode(pickupMode))
          : (dropoff_address || presetAddressForMode(requestedDropoffMode));

      const dropoffNeedsAddress =
        effectiveDropoffMode === "athens_center" || effectiveDropoffMode === "custom";

      if (dropoffNeedsAddress && !effectiveDropoffPlaceId) {
        return res.status(400).json({
          ok: false,
          error: "dropoff_place_id required for selected dropoff_mode",
        });
      }

      const tourRows = await toursTable()
        .select({ maxRecords: 1, filterByFormula: `{tour_id}='${escapeFormulaValue(tour_id)}'` })
        .firstPage();

      if (!tourRows.length) {
        return res.status(404).json({ ok: false, error: "Tour not found" });
      }

      const tour = tourRows[0].fields;

      const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
      if (!serverKey) {
        return res.status(500).json({ ok: false, error: "Missing GOOGLE_MAPS_SERVER_KEY env var" });
      }

      let vclassCfg = null;
      const needsCustomAddon = pickupMode === "custom" || effectiveDropoffMode === "custom";

      if (needsCustomAddon) {
        const vehicleRows = await configTable()
          .select({ maxRecords: 1, filterByFormula: `{key}='vclass'` })
          .firstPage();

        if (!vehicleRows.length) {
          return res.status(500).json({ ok: false, error: "Config row vclass missing" });
        }

        vclassCfg = vehicleRows[0].fields;

        if (!globalCfg.tour_custom_home_place_id) {
          return res.status(500).json({ ok: false, error: "Missing tour_custom_home_place_id in GLOBAL config" });
        }
      }

      let pickupAddon = 0;
      let dropoffAddon = 0;
      let pickupCustomMeta = null;
      let dropoffCustomMeta = null;

      if (pickupMode === "airport") pickupAddon = Number(tour.airport_fee || 0);
      if (pickupMode === "piraeus_port") pickupAddon = Number(tour.piraeus_port_fee || 0);

      if (pickupMode === "custom") {
        pickupCustomMeta = await getCustomTourAddon({
          customPlaceId: pickup_place_id,
          homePlaceId: globalCfg.tour_custom_home_place_id,
          serverKey,
          vehicleCfg: vclassCfg,
        });
        pickupAddon = pickupCustomMeta.addon;
      }

      if (effectiveDropoffMode === "airport") dropoffAddon = Number(tour.airport_fee || 0);
      if (effectiveDropoffMode === "piraeus_port") dropoffAddon = Number(tour.piraeus_port_fee || 0);

      if (effectiveDropoffMode === "custom") {
        dropoffCustomMeta = await getCustomTourAddon({
          customPlaceId: effectiveDropoffPlaceId,
          homePlaceId: globalCfg.tour_custom_home_place_id,
          serverKey,
          vehicleCfg: vclassCfg,
        });
        dropoffAddon = dropoffCustomMeta.addon;
      }

      const pricing = tourPrice({
        passengers,
        extraHours: extra_hours,
        tour,
        pickupAddon,
        dropoffAddon,
      });

      const start = new Date(pickup_datetime_iso);
      const durationHours =
        Number(tour.included_duration_hours || 0) + Number(extra_hours || 0);

      const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

      const blockStart = new Date(
        start.getTime() - Number(tour.buffer_before_min || 0) * 60 * 1000
      );
      const blockEnd = new Date(
        end.getTime() + Number(tour.buffer_after_min || 0) * 60 * 1000
      );

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({
          ok: true,
          available: false,
          message: "No Vehicles Available",
        });
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

            customer_name: nameCombined || "",
            customer_email: customer_email || "",
            customer_phone: customer_phone || "",

            tour_id: tour_id,
            tour_name: tour.tour_name || "",

            passengers: Number(passengers || 0),
            extra_hours: Number(extra_hours || 0),

            pickup_mode: pickupMode,
            dropoff_mode: requestedDropoffMode,

            pickup_place_id: pickup_place_id || "",
            pickup_address: pickup_address || presetAddressForMode(pickupMode),

            dropoff_place_id: effectiveDropoffPlaceId || "",
            dropoff_address: effectiveDropoffAddress || "",

            pickup_addon_eur: pickupAddon,
            dropoff_addon_eur: dropoffAddon,

            price_total_eur: pricing.total,
            price_breakdown_json: JSON.stringify({
              ...pricing.breakdown,
              pickup_mode: pickupMode,
              dropoff_mode: requestedDropoffMode,
              effective_dropoff_mode: effectiveDropoffMode,
              pickup_custom_meta: pickupCustomMeta,
              dropoff_custom_meta: dropoffCustomMeta,
            }),
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

        arrival,
      } = body;

      if (!pickup_datetime_iso) {
        return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });
      }

      const vehicleKey = (vehicle || "vclass").toString().trim() || "vclass";

      const vehicleRows = await configTable()
        .select({ maxRecords: 1, filterByFormula: `{key}='${escapeFormulaValue(vehicleKey)}'` })
        .firstPage();

      if (!vehicleRows.length) {
        return res.status(500).json({ ok: false, error: `Config row ${vehicleKey} missing` });
      }

      const vcfg = vehicleRows[0].fields;
      const pickup = new Date(pickup_datetime_iso);

      const nightStart = Number(globalCfg.night_start_hour ?? vcfg.night_start_hour ?? 0);
      const nightEnd = Number(globalCfg.night_end_hour ?? vcfg.night_end_hour ?? 6);
      const night = isNightPickup(pickup, nightStart, nightEnd);

      const distKm =
        typeof distance_km === "number" ? distance_km : Number(distance_km || 0) || 0;
      const durMin =
        typeof duration_min === "number" ? duration_min : Number(duration_min || 0) || 0;

      const pricing = transferPriceEquivalent({
        distance_km: distKm,
        is_night: night,
        vehicleCfg: {
          transfer_base_fare: vcfg.transfer_base_fare,
          transfer_rate_per_km: vcfg.transfer_rate_per_km,
          transfer_free_km: vcfg.transfer_free_km,
          transfer_minimum_fare: vcfg.transfer_minimum_fare,
          night_type: vcfg.night_type ?? globalCfg.night_type,
          night_value: vcfg.night_value ?? globalCfg.night_value,
        },
      });

      const start = pickup;
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const bufferBefore = Number(globalCfg.transfer_buffer_before_min || 0);
      const bufferAfter = Number(globalCfg.transfer_buffer_after_min || 0);

      const blockStart = new Date(start.getTime() - bufferBefore * 60 * 1000);
      const blockEnd = new Date(end.getTime() + bufferAfter * 60 * 1000);

      const conflicts = await findConflicts(blockStart.toISOString(), blockEnd.toISOString());
      if (conflicts.length) {
        return res.status(200).json({
          ok: true,
          available: false,
          message: "No Vehicles Available",
        });
      }

      const bookingId = crypto.randomUUID();
      const nameCombined =
        `${(customer_first_name || "").trim()} ${(customer_last_name || "").trim()}`.trim();

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

            customer_name: nameCombined || "",
            customer_email: customer_email || "",
            customer_phone: customer_phone || "",

            pickup_place_id: pickup_place_id || "",
            dropoff_place_id: dropoff_place_id || "",
            pickup_address: pickup_address || "",
            dropoff_address: dropoff_address || "",

            distance_km: distKm,
            duration_min: durMin,
            vehicle: vehicleKey,
            passengers: Number(passengers || 0),
            luggage: Number(luggage || 0),

            arrival_type,
            arrival_reference,

            is_night: night ? true : false,
            price_total_eur: pricing.total,
            price_breakdown_json: JSON.stringify({
              base_fare: Number(vcfg.transfer_base_fare || 0),
              free_km: Number(vcfg.transfer_free_km || 0),
              extra_km: Math.max(0, distKm - Number(vcfg.transfer_free_km || 0)),
              rate_per_km: Number(vcfg.transfer_rate_per_km || 0),
              distance_cost:
                Math.round(
                  Math.max(0, distKm - Number(vcfg.transfer_free_km || 0)) *
                    Number(vcfg.transfer_rate_per_km || 0) *
                    100
                ) / 100,
              minimum_fare: Number(vcfg.transfer_minimum_fare || 0),
              night_applied: night,
              night_type: vcfg.night_type ?? globalCfg.night_type,
              night_value: Number((vcfg.night_value ?? globalCfg.night_value) || 0),
              subtotal: pricing.subtotal,
            }),
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
        is_night: night,
      });
    }

    return res.status(400).json({ ok: false, error: "Unknown service_type" });
  } catch (err) {
    console.error("HOLD ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
