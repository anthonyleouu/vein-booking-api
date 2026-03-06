function tourPrice({ passengers, extraHours, tour, pickupAddon = 0, dropoffAddon = 0 }) {
  const p = Number(passengers || 0);
  const eh = Number(extraHours || 0);

  if (p <= 0) throw new Error("Passengers required");
  if (p > 6) throw new Error("Max 6 passengers");
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
      guest_tier: p <= 4 ? "up_to_4" : "up_to_6",
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

  const round = (v) => Math.round(Number(v) * 100) / 100;

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
      total: round(total),
    },
  };
}

module.exports = {
  tourPrice,
  isNightPickup,
  transferPrice,
};