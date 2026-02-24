const { configTable } = require("../lib/airtable");

module.exports = async (req, res) => {
  try {
    const records = await configTable()
      .select({ maxRecords: 1, view: "Grid view" })
      .firstPage();

    if (!records.length) {
      return res.status(404).json({ ok: false, error: "No Config rows found" });
    }

    return res.status(200).json({ ok: true, config: records[0].fields });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};