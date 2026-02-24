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