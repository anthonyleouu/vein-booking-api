// Escapes a value for safe use inside an Airtable filterByFormula() string.
// Airtable formula strings use single quotes; escaping the only special
// character (the single quote itself) is sufficient.
//
// Usage:
//   const formula = `{booking_id}='${escapeFormulaValue(id)}'`;
function escapeFormulaValue(value) {
  return String(value ?? "").replace(/'/g, "\\'");
}

module.exports = { escapeFormulaValue };
