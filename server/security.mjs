import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("hex");
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
export function text(value, label, min = 1, max = 1000) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(400, `${label} must contain ${min} to ${max} characters.`);
  return value.trim();
}
export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(400, `${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
export async function passwordHash(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    fail(400, "Use a password between 12 and 128 characters.");
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${hash.toString("hex")}`;
}
export async function passwordMatches(password, encoded) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, expected] = encoded.split(":");
  const actual = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export function limiter(max, windowMs, key = (req) => req.user?.id || req.ip) {
  const entries = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [k, v] of entries) if (v.until < now) entries.delete(k);
    const k = key(req);
    const entry = entries.get(k) || { count: 0, until: now + windowMs };
    if (entries.size >= 10000 && !entries.has(k))
      return res.status(429).json({ error: "Please try again later." });
    entries.set(k, entry);
    entry.count++;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
      return res
        .status(429)
        .json({ error: "Too many requests. Please try again later." });
    }
    next();
  };
}
