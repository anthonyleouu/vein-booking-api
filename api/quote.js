const { configTable, toursTable } = require("../lib/airtable");
const { applyCors } = require("../lib/cors");
const { escapeFormulaValue } = require("../lib/airtable-escape");
const { findConflicts } = require("../lib/availability");
const { tourPrice, isNightPickup, transferPrice } = require("../lib/pricing");

const CACHE_TTL_MS = 60 * 1000; // 1 minute
const _cache = new Map();

function getCache(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value, ttlMs = CACHE_TTL_MS) {
  _cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const json = await res.json();
    return { res, json };
  } finally {
    clearTimeout(timer);
  }
}

async function getGlobalConfig() {
  const cached = getCache("cfg:GLOBAL");
  if (cached) return cached;

  const rows = await configTable()
    .select({ maxRecords: 1, filterByFormula: `{key}='GLOBAL'` })
    .firstPage();

  if (!rows.length) throw new Error("Config row GLOBAL missing");
  return setCache("cfg:GLOBAL", rows[0].fields);
}

async function getVehicleConfig(vehicleKey) {
  const cacheKey = `cfg:${vehicleKey}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const rows = await configTable()
    .select({ maxRecords: 1, filterByFormula: `{key}='${escapeFormulaValue(vehicleKey)}'` })
    .firstPage();

  if (!rows.length) throw new Error(`Config row ${vehicleKey} missing`);
  return setCache(cacheKey, rows[0].fields);
}

async function getTourById(tourId) {
  const cacheKey = `tour:${tourId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const rows = await toursTable()
    .select({ maxRecords: 1, filterByFormula: `{tour_id}='${escapeFormulaValue(tourId)}'` })
    .firstPage();

  if (!rows.length) throw new Error("Tour not found");
  return setCache(cacheKey, rows[0].fields);
}

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

  const { res: dmRes, json: dmJson } = await fetchJsonWithTimeout(dmUrl, {}, 8000);

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

async function getCustomTourAddon({ customPlaceId, homePlaceId, serverKey, vehicleCfg }) {
  const metrics = await getDistanceMetrics({
    originPlaceId: homePlaceId,
    destinationPlaceId: customPlaceId,
    serverKey,
  });

  const transferEquivalent = transferPrice({
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
  if (applyCors(req, res, { methods: "POST, OPTIONS, GET" })) return;

  const startedAt = Date.now();

  try {
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
    const { service_type } = body || {};

    if (!service_type) {
      return res.status(400).json({ ok: false, error: "service_type required" });
    }

    // ---------------- TOUR QUOTE ----------------
    if (service_type === "TOUR") {
      const cfg = await getGlobalConfig();

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

      const startHour = Number(cfg.tour_pickup_start_hour ?? 8);
      const endHour = Number(cfg.tour_pickup_end_hour ?? 11);

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

      const tour = await getTourById(tour_id);

      const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
      if (!serverKey) {
        return res.status(500).json({ ok: false, error: "Missing GOOGLE_MAPS_SERVER_KEY env var" });
      }

      let vclassCfg = null;
      const needsCustomAddon = pickupMode === "custom" || effectiveDropoffMode === "custom";

      if (needsCustomAddon) {
        vclassCfg = await getVehicleConfig("vclass");

        if (!cfg.tour_custom_home_place_id) {
          return res.status(500).json({
            ok: false,
            error: "Missing tour_custom_home_place_id in GLOBAL config",
          });
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
          homePlaceId: cfg.tour_custom_home_place_id,
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
          homePlaceId: cfg.tour_custom_home_place_id,
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

      console.log("QUOTE TOUR OK", {
        tour_id,
        elapsed_ms: Date.now() - startedAt,
      });

      return res.status(200).json({
        ok: true,
        available: true,
        vehicle: "Mercedes Vito",
        price_total_eur: pricing.total,
        price_breakdown: {
          ...pricing.breakdown,
          pickup_mode: pickupMode,
          dropoff_mode: requestedDropoffMode,
          effective_dropoff_mode: effectiveDropoffMode,
          pickup_address: pickup_address || presetAddressForMode(pickupMode),
          dropoff_address: effectiveDropoffAddress,
          pickup_custom_meta: pickupCustomMeta,
          dropoff_custom_meta: dropoffCustomMeta,
        },
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

      if (!pickup_datetime_iso) {
        return res.status(400).json({ ok: false, error: "pickup_datetime_iso required" });
      }

      if (!pickup_place_id) {
        return res.status(400).json({ ok: false, error: "pickup_place_id required" });
      }

      if (!dropoff_place_id) {
        return res.status(400).json({ ok: false, error: "dropoff_place_id required" });
      }

      const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
      if (!serverKey) {
        return res.status(500).json({ ok: false, error: "Missing GOOGLE_MAPS_SERVER_KEY env var" });
      }

      const vehicleKey = "vclass";
      const globalCfg = await getGlobalConfig();
      const vcfg = await getVehicleConfig(vehicleKey);

      const pickup = new Date(pickup_datetime_iso);

      const nightStart = Number(globalCfg.night_start_hour ?? vcfg.night_start_hour ?? 0);
      const nightEnd = Number(globalCfg.night_end_hour ?? vcfg.night_end_hour ?? 6);

      const night = isNightPickup(pickup, nightStart, nightEnd);

      const metrics = await getDistanceMetrics({
        originPlaceId: pickup_place_id,
        destinationPlaceId: dropoff_place_id,
        serverKey,
      });

      const distance_km = metrics.distance_km;
      const duration_min = metrics.duration_min;

      const base = Number(vcfg.transfer_base_fare || 0);
      const rate = Number(vcfg.transfer_rate_per_km || 0);
      const freeKm = Number(vcfg.transfer_free_km || 0);
      const minFare = Number(vcfg.transfer_minimum_fare || 0);

      // Optional tiered long-distance pricing.
      const tierBreakKm = Number(vcfg.transfer_tier_break_km || 0);
      const rateLong = Number(vcfg.transfer_rate_per_km_long || 0);

      const extraKm = Math.max(0, distance_km - freeKm);

      let distanceCost;
      let tierApplied = false;
      let tier1Km = extraKm;
      let tier2Km = 0;

      if (tierBreakKm > 0 && rateLong > 0 && distance_km > tierBreakKm) {
        tier1Km = Math.max(0, tierBreakKm - freeKm);
        tier2Km = distance_km - tierBreakKm;
        distanceCost = (tier1Km * rate) + (tier2Km * rateLong);
        tierApplied = true;
      } else {
        distanceCost = extraKm * rate;
      }

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

      const start = pickup;
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const bufferBefore = Number(globalCfg.transfer_buffer_before_min ?? 0);
      const bufferAfter = Number(globalCfg.transfer_buffer_after_min ?? 0);

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

      console.log("QUOTE TRANSFER OK", {
        pickup_place_id,
        dropoff_place_id,
        elapsed_ms: Date.now() - startedAt,
      });

      return res.status(200).json({
        ok: true,
        available: true,
        vehicle: "Mercedes Vito",
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
          rate_per_km_long: rateLong || null,
          tier_break_km: tierBreakKm || null,
          tier_applied: tierApplied,
          tier_1_km: Math.round(tier1Km * 10) / 10,
          tier_2_km: Math.round(tier2Km * 10) / 10,
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
    console.error("QUOTE ERROR", {
      message: err.message,
      name: err.name,
      elapsed_ms: Date.now() - startedAt,
    });

    return res.status(500).json({
      ok: false,
      error: err.message || "Quote failed",
    });
  }
};
