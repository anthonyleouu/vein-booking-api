const { bookingsTable } = require("./airtable");

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

async function findConflicts(blockStartISO, blockEndISO) {
  const records = await bookingsTable()
    .select({
      maxRecords: 50,
      view: "Grid view",
      filterByFormula:
        "OR({status}='CONFIRMED', AND({status}='HOLD', {expires_at} > NOW()))",
    })
    .firstPage();

  const reqStart = new Date(blockStartISO);
  const reqEnd = new Date(blockEndISO);

  const conflicts = records.filter((r) => {
    const bStart = new Date(r.get("block_start"));
    const bEnd = new Date(r.get("block_end"));
    return overlaps(reqStart, reqEnd, bStart, bEnd);
  });

  return conflicts;
}

module.exports = { findConflicts };