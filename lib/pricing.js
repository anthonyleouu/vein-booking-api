function tourPrice({ passengers, extraHours, tour, pickupAddon = 0, dropoffAddon = 0 }) {
  const p = Number(passengers || 0);
  const eh = Number(extraHours || 0);

  if (p <= 0) throw new Error("Passengers required");
  if (p > 7) throw new Error("Max 7 passengers");
  if (eh < 0) throw new Error("Extra hours cannot be negative");

  const base = p <= 4 ? Number(tour.price_up_to_4 || 0) : Number(tour.price_up_to_6 || 0);
  const extraHourRate = Number(tour.extra_hour_rate || 0);
  const extra = eh * extraHourRate;

  const pickup_addon = Number(pickupAddon || 0);
  const dropoff_addon = Number(dropoffAddon || 0);

  const rawTotal = base + extra + pickup_addon + dropoff_addon;
  const total = Math.floor(rawTotal);

  return {
    total,
    breakdown: {
      guest_tier: p <= 4 ? "up_to_4" : "up_to_7",
      base,
      extra_hours: eh,
      extra_hour_rate: extraHourRate,
      extra_hours_total: extra,
      pickup_addon,
      dropoff_addon,
      raw_total: rawTotal,
      total,
    },
  };
}

function isNightPickup(dateObj, nightStartHour, nightEndHour) {
  const h = dateObj.getHours();
  if (nightStartHour < nightEndHour) return h >= nightStartHour && h < nightEndHour;
  return h >= nightStartHour || h < nightEndHour;
}

function transferPrice({ distance_km, is_night, vehicleCfg }) {
  const base = Number(vehicleCfg.transfer_base_fare || 0);
  const minFare = Number(vehicleCfg.transfer_minimum_fare || 0);
  const rate = Number(vehicleCfg.transfer_rate_per_km || 0);
  const freeKm = Number(vehicleCfg.transfer_free_km || 0);

  // Optional tiered long-distance pricing.
  // If both transfer_tier_break_km and transfer_rate_per_km_long are set
  // (and the trip exceeds the break point), the km past the break point
  // are billed at the lower long-distance rate. Otherwise behaves exactly
  // like the original flat-rate formula.
  const tierBreakKm = Number(vehicleCfg.transfer_tier_break_km || 0);
  const rateLong = Number(vehicleCfg.transfer_rate_per_km_long || 0);

  const nightType = vehicleCfg.night_type;
  const nightValue = Number(vehicleCfg.night_value || 0);

  const km = Number(distance_km || 0);
  const extraKm = Math.max(0, km - freeKm);

  let distanceCost;
  let tieredApplied = false;
  let tier1Km = extraKm;
  let tier2Km = 0;

  if (tierBreakKm > 0 && rateLong > 0 && km > tierBreakKm) {
    // Split: km from freeKm up to tierBreakKm at `rate`,
    // km past tierBreakKm at `rateLong`.
    tier1Km = Math.max(0, tierBreakKm - freeKm);
    tier2Km = km - tierBreakKm;
    distanceCost = (tier1Km * rate) + (tier2Km * rateLong);
    tieredApplied = true;
  } else {
    distanceCost = extraKm * rate;
  }

  let subtotal = base + distanceCost;
  if (subtotal < minFare) subtotal = minFare;

  let total = subtotal;

  if (is_night) {
    if (nightType === "PERCENT") {
      total = subtotal * (1 + nightValue / 100);
    } else if (nightType === "FIXED") {
      total = subtotal + nightValue;
    }
  }

  const round = (v) => Math.round(Number(v) * 100) / 100;

  return {
    total: round(total),
    breakdown: {
      base_fare: base,
      free_km: freeKm,
      distance_km: km,
      extra_km: round(extraKm),
      rate_per_km: rate,
      rate_per_km_long: rateLong || null,
      tier_break_km: tierBreakKm || null,
      tier_applied: tieredApplied,
      tier_1_km: round(tier1Km),
      tier_2_km: round(tier2Km),
      distance_cost: round(distanceCost),
      subtotal: round(subtotal),
      minimum_fare: minFare,
      night_applied: is_night,
      night_type: nightType,
      night_value: nightValue,
      total: round(total),
    },
  };
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findMatchingZone(lat, lng, zones) {
  for (const zone of zones) {
    const dist = haversineDistanceKm(lat, lng, Number(zone.lat), Number(zone.lng));
    if (dist <= Number(zone.radius_km)) return zone;
  }
  return null;
}

function findMatchingRoute(pickupZoneId, dropoffZoneId, routes) {
  for (const route of routes) {
    if (
      (route.from_zone === pickupZoneId && route.to_zone === dropoffZoneId) ||
      (route.from_zone === dropoffZoneId && route.to_zone === pickupZoneId)
    ) {
      return route;
    }
  }
  return null;
}

function zoneBasedTransferPrice({ distance_km, is_night, route, vehicleCfg, globalCfg }) {
  const minPrice = Number(route.min_price || 0);
  const maxPrice = Number(route.max_price || 0);
  const minKm = Number(route.min_km || 0);
  const maxKm = Number(route.max_km || 0);
  const km = Number(distance_km || 0);

  const clampedKm = Math.max(minKm, Math.min(maxKm, km));
  const ratio = maxKm === minKm ? 0 : (clampedKm - minKm) / (maxKm - minKm);
  let price = minPrice + ratio * (maxPrice - minPrice);

  const nightType =
    (vehicleCfg && vehicleCfg.night_type != null ? vehicleCfg.night_type : undefined) ??
    (globalCfg && globalCfg.night_type != null ? globalCfg.night_type : undefined);
  const nightValue = Number(
    (vehicleCfg && vehicleCfg.night_value != null
      ? vehicleCfg.night_value
      : globalCfg && globalCfg.night_value != null
      ? globalCfg.night_value
      : 0) || 0
  );

  const basePrice = Math.round(price * 100) / 100;
  let nightApplied = false;

  if (is_night) {
    nightApplied = true;
    if (nightType === "PERCENT") price = price * (1 + nightValue / 100);
    else if (nightType === "FIXED") price = price + nightValue;
  }

  const total = Math.floor(price);

  return {
    total,
    breakdown: {
      pricing_source: "zone_route",
      route_id: route.route_id,
      from_zone: route.from_zone,
      to_zone: route.to_zone,
      min_price: minPrice,
      max_price: maxPrice,
      min_km: minKm,
      max_km: maxKm,
      clamped_km: clampedKm,
      interpolation_ratio: Math.round(ratio * 10000) / 10000,
      base_price: basePrice,
      night_applied: nightApplied,
      night_type: nightType,
      night_value: nightValue,
      total,
    },
  };
}

module.exports = {
  tourPrice,
  isNightPickup,
  transferPrice,
  haversineDistanceKm,
  findMatchingZone,
  findMatchingRoute,
  zoneBasedTransferPrice,
};
