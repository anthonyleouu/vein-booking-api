export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    message: "vein booking api is alive"
  });
}