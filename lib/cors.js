// Single source of truth for allowed browser origins.
// Driven by env var ALLOWED_ORIGINS (comma-separated). Falls back to a
// hard-coded list so a misconfigured Vercel deploy still works.
//
// Example Vercel value:
//   ALLOWED_ORIGINS=https://selenelux.co,https://www.selenelux.co,https://vip-athens-transfer.webflow.io

const FALLBACK_ORIGINS = [
  "https://selenelux.co",
  "https://www.selenelux.co",
  "https://vip-athens-transfer.webflow.io", // keep for Webflow staging until launch is fully cut over
];

function getAllowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return fromEnv.length ? fromEnv : FALLBACK_ORIGINS;
}

/**
 * Apply CORS headers. Returns true if the request is a preflight OPTIONS
 * that has already been answered (caller should `return` immediately).
 */
function applyCors(req, res, { methods = "POST, OPTIONS" } = {}) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin;

  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}

module.exports = { applyCors, getAllowedOrigins };
