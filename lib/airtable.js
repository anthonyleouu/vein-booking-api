const Airtable = require("airtable");

function getBase() {
  // allow either variable name
  const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token) {
    throw new Error("Missing AIRTABLE_TOKEN (or AIRTABLE_API_KEY)");
  }

  if (!baseId) {
    throw new Error("Missing AIRTABLE_BASE_ID");
  }

  Airtable.configure({ apiKey: token });
  return Airtable.base(baseId);
}

function table(nameEnvVar) {
  const name = process.env[nameEnvVar];
  if (!name) {
    throw new Error(`Missing env var: ${nameEnvVar}`);
  }
  return getBase()(name);
}

module.exports = {
  getBase,
  bookingsTable: () => table("AIRTABLE_TABLE_BOOKINGS"),
  toursTable: () => table("AIRTABLE_TABLE_TOURS"),
  configTable: () => table("AIRTABLE_TABLE_CONFIG"),
};