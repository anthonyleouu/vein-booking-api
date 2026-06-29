function normalizePlaceName(rawAddress) {
  if (rawAddress == null) return "";
  const s = String(rawAddress).trim();
  if (!s) return "";

  const lower = s.toLowerCase();

  const rules = [
    {
      latin: ["airport", "eleftherios venizelos", "attiki odos, spata", "ath airport"],
      greek: ["Αττική Οδός"],
      result: "Athens International Airport",
    },
    {
      latin: ["piraeus port", "piraeus cruise port", "great harbour piraeus"],
      greek: [],
      result: "Piraeus Port",
    },
    {
      latin: ["rafina port", "port of rafina"],
      greek: [],
      result: "Rafina Port",
    },
    {
      latin: ["lavrio port", "port of lavrio", "lavrion port"],
      greek: [],
      result: "Lavrio Port",
    },
  ];

  for (const rule of rules) {
    if (rule.latin.some((m) => lower.includes(m))) return rule.result;
    if (rule.greek.some((m) => s.includes(m))) return rule.result;
  }

  return s;
}

module.exports = { normalizePlaceName };

// Test block — run with: node lib/place-normalize.js
if (require.main === module) {
  const tests = [
    [normalizePlaceName("Αττική Οδός, Σπάτα 19019, Ελλάδα"), "Athens International Airport"],
    [normalizePlaceName("Athens International Airport, Greece"), "Athens International Airport"],
    [normalizePlaceName("Eleftherios Venizelos Airport, Spata"), "Athens International Airport"],
    [normalizePlaceName("Πλ. Συντάγματος, Αθήνα, Ελλάδα"), "Πλ. Συντάγματος, Αθήνα, Ελλάδα"],
    [normalizePlaceName("Piraeus Port, Greece"), "Piraeus Port"],
    [normalizePlaceName(""), ""],
    [normalizePlaceName(null), ""],
  ];

  let pass = 0;
  let fail = 0;
  for (const [got, expected] of tests) {
    if (got === expected) {
      console.log(`PASS: "${got}"`);
      pass++;
    } else {
      console.log(`FAIL: got "${got}", expected "${expected}"`);
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
}
