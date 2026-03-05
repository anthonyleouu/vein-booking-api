function tourPrice({ passengers, extraHours, tour }) {
  const p = Number(passengers || 0);
  const eh = Number(extraHours || 0);

  if (p <= 0) throw new Error("Passengers required");
  if (p > 6) throw new Error("Max 6 passengers");

  const base = p <= 4 ? Number(tour.price_up_to_4) : Number(tour.price_up_to_6);
  const extra = eh * Number(tour.extra_hour_rate);
  return {
    total: base + extra,
    breakdown: { base, extra_hours: eh, extra_hour_rate: Number(tour.extra_hour_rate), extra },
  };
}

function isNightPickup(dateObj, nightStartHour, nightEndHour) {
  const h = dateObj.getHours();
  // handles windows like 00:00–06:00
  if (nightStartHour < nightEndHour) return h >= nightStartHour && h < nightEndHour;
  // handles wrap-around windows like 22:00–06:00
  return h >= nightStartHour || h < nightEndHour;
}

module.exports = { tourPrice, isNightPickup };

function tourPrice({ passengers, extraHours, tour }) {
  const p = Number(passengers || 0);
  const eh = Number(extraHours || 0);

  if (p <= 0) throw new Error("Passengers required");
  if (p > 6) throw new Error("Max 6 passengers");

  const base = p <= 4 ? Number(tour.price_up_to_4) : Number(tour.price_up_to_6);
  const extra = eh * Number(tour.extra_hour_rate);

  return {
    total: base + extra,
    breakdown: { base, extra_hours: eh, extra_hour_rate: Number(tour.extra_hour_rate), extra },
  };
}

function isNightPickup(dateObj, nightStartHour, nightEndHour) {
  const h = dateObj.getHours();

  if (nightStartHour < nightEndHour)
    return h >= nightStartHour && h < nightEndHour;

  return h >= nightStartHour || h < nightEndHour;
}

/* ================================
   TRANSFER PRICE (vehicle config)
================================ */

function transferPrice({ distance_km, is_night, vehicleCfg }) {

  const base = Number(vehicleCfg.transfer_base_fare || 0);
  const minFare = Number(vehicleCfg.transfer_minimum_fare || 0);
  const rate = Number(vehicleCfg.transfer_rate_per_km || 0);
  const freeKm = Number(vehicleCfg.transfer_free_km || 0);

  const nightType = vehicleCfg.night_type;
  const nightValue = Number(vehicleCfg.night_value || 0);

  const km = Number(distance_km || 0);
  const extraKm = Math.max(0, km - freeKm);

  const distanceCost = extraKm * rate;

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

  const round = (v) => Math.round(v * 100) / 100;

  return {
    total: round(total),
    breakdown: {
      base_fare: base,
      free_km: freeKm,
      distance_km: km,
      extra_km: round(extraKm),
      rate_per_km: rate,
      distance_cost: round(distanceCost),
      subtotal: round(subtotal),
      minimum_fare: minFare,
      night_applied: is_night,
      night_type: nightType,
      night_value: nightValue,
      total: round(total)
    }
  };
}

module.exports = {
  tourPrice,
  isNightPickup,
  transferPrice
};