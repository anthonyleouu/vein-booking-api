function splitNational(digits) {
  const groups = [];
  let rest = digits;
  while (rest.length > 0) {
    if (rest.length <= 4) {
      groups.push(rest);
      break;
    }
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  return groups.join(" ");
}

function normalizePhone(rawPhone, defaultCountryCode = "30") {
  if (rawPhone == null) return "";
  const s = String(rawPhone).trim();
  if (!s) return "";

  const hasPlus = s.startsWith("+");
  const hasOO = !hasPlus && s.startsWith("00");

  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";

  let cc, national;

  if (hasPlus) {
    const ccLen = Math.min(3, Math.max(1, digits.length - 10));
    cc = digits.slice(0, ccLen);
    national = digits.slice(ccLen);
  } else if (hasOO) {
    const rest = digits.slice(2);
    const ccLen = Math.min(3, Math.max(1, rest.length - 10));
    cc = rest.slice(0, ccLen);
    national = rest.slice(ccLen);
  } else if (digits.startsWith(defaultCountryCode)) {
    cc = defaultCountryCode;
    national = digits.slice(defaultCountryCode.length);
  } else {
    cc = defaultCountryCode;
    national = digits;
  }

  if (!national) return `+${cc}`;
  return `+${cc} ${splitNational(national)}`;
}

module.exports = { normalizePhone };

// Test block — run with: node lib/phone-format.js
if (require.main === module) {
  const tests = [
    [normalizePhone("+306987253536"),   "+30 698 725 3536"],
    [normalizePhone("6987253536"),      "+30 698 725 3536"],
    [normalizePhone("306987253536"),    "+30 698 725 3536"],
    [normalizePhone("00306987253536"),  "+30 698 725 3536"],
    [normalizePhone("+44 7123 456789"), "+44 712 345 6789"],
    [normalizePhone("7888357237"),      "+30 788 835 7237"],
    [normalizePhone(""),               ""],
    [normalizePhone(null),             ""],
    [normalizePhone(undefined),        ""],
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
