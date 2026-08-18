const MAX_BODY_LENGTH = 8192;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    let data = "";
    let oversized = false;
    req.on("data", (chunk) => {
      if (oversized) return;
      data += chunk;
      if (data.length > MAX_BODY_LENGTH) oversized = true;
    });
    req.on("end", () => {
      if (oversized) {
        resolve({ __oversized: true });
        return;
      }
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

function isUniqueViolation(err) {
  return err && (err.code === "23505" || /duplicate key value/.test(err.message || ""));
}

function toKarachiIso(date) {
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+05:00");
}

module.exports = { readJsonBody, isUniqueViolation, toKarachiIso, MAX_BODY_LENGTH };
