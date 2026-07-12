const { configTable, zonesTable, routePricingTable } = require("../lib/airtable");
const { applyCors } = require("../lib/cors");
const { escapeFormulaValue } = require("../lib/airtable-escape");
const { findMatchingZone, findMatchingRoute, zoneBasedTransferPrice } = require("../lib/pricing");

const CACHE_TTL_MS = 60 * 1000;
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

async function geocodePlaceId(placeId, serverKey) {
  const cacheKey = `geocode:en:${placeId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&key=${encodeURIComponent(serverKey)}` +
    "&language=en";

  try {
    const { json } = await fetchJsonWithTimeout(url, {}, 8000);
    if (json.status !== "OK" || !json.results?.[0]) return null;
    const loc = json.results[0].geometry.location;
    const geo = { lat: loc.lat, lng: loc.lng };
    return setCache(cacheKey, geo, 3600 * 1000);
  } catch (err) {
    console.error("GEOCODE_FAILED", { place_id: placeId, error: err.message });
    return null;
  }
}

async function getAllZones() {
  const cached = getCache("zones:all");
  if (cached) return cached;
  const rows = await zonesTable().select().all();
  return setCache("zones:all", rows.map((r) => r.fields));
}

async function getAllRoutes() {
  const cached = getCache("routes:all");
  if (cached) return cached;
  const rows = await routePricingTable().select().all();
  return setCache("routes:all", rows.map((r) => r.fields));
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

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  const startedAt = Date.now();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      pickup_place_id,
      dropoff_place_id,
      night_transfer = false,
    } = body || {};

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

    const night = !!night_transfer;
    const nightType = vcfg.night_type ?? globalCfg.night_type;
    const nightValue = Number((vcfg.night_value ?? globalCfg.night_value) || 0);

    const [metrics, pickupGeo, dropoffGeo] = await Promise.all([
      getDistanceMetrics({ originPlaceId: pickup_place_id, destinationPlaceId: dropoff_place_id, serverKey }),
      geocodePlaceId(pickup_place_id, serverKey),
      geocodePlaceId(dropoff_place_id, serverKey),
    ]);

    const distance_km = metrics.distance_km;
    const duration_min = metrics.duration_min;

    // Zone-based pricing attempt
    let zones = [];
    let routes = [];
    try {
      [zones, routes] = await Promise.all([getAllZones(), getAllRoutes()]);
    } catch (err) {
      console.error("ZONE_LOOKUP_FAILED", { error: err.message });
    }

    if (pickupGeo && dropoffGeo && zones.length > 0) {
      const pickupZone = findMatchingZone(pickupGeo.lat, pickupGeo.lng, zones);
      const dropoffZone = findMatchingZone(dropoffGeo.lat, dropoffGeo.lng, zones);

      if (pickupZone && dropoffZone) {
        const matchedRoute = findMatchingRoute(pickupZone.zone_id, dropoffZone.zone_id, routes);

        if (matchedRoute) {
          const zonePricing = zoneBasedTransferPrice({
            distance_km,
            is_night: night,
            route: matchedRoute,
            vehicleCfg: vcfg,
            globalCfg,
          });

          console.log("LANDING TRANSFER QUOTE OK", {
            pickup_place_id,
            dropoff_place_id,
            night,
            pricing_source: "zone_route",
            elapsed_ms: Date.now() - startedAt,
          });

          return res.status(200).json({
            ok: true,
            vehicle: "Mercedes Vito",
            vehicle_key: vehicleKey,
            is_night: night,
            distance_km,
            duration_min,
            price_total_eur: zonePricing.total,
            price_breakdown: zonePricing.breakdown,
          });
        }
      }
    }

    // Formula fallback
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

    if (night) {
      if (nightType === "PERCENT") total = subtotal * (1 + nightValue / 100);
      if (nightType === "FIXED") total = subtotal + nightValue;
    }

    total = Math.floor(total);

    console.log("LANDING TRANSFER QUOTE OK", {
      pickup_place_id,
      dropoff_place_id,
      night,
      pricing_source: "formula",
      elapsed_ms: Date.now() - startedAt,
    });

    return res.status(200).json({
      ok: true,
      vehicle: "Mercedes Vito",
      vehicle_key: vehicleKey,
      is_night: night,
      distance_km,
      duration_min,
      price_total_eur: total,
      price_breakdown: {
        pricing_source: "formula",
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
  } catch (err) {
    console.error("LANDING TRANSFER QUOTE ERROR", {
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
