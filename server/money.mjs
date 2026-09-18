import { fail } from "./security.mjs";
export const assets = { BTC: 8, XMR: 12 };
export function amount(value, currency, zero = false) {
  if (!Object.hasOwn(assets, currency)) fail(400, "Choose BTC or XMR.");
  if (typeof value !== "string" || !/^\d{1,18}(\.\d+)?$/.test(value))
    fail(400, "Enter an exact decimal amount.");
  const [whole, frac = ""] = value.split(".");
  if (frac.length > assets[currency])
    fail(400, `Too many decimal places for ${currency}.`);
  const n =
    BigInt(whole) * 10n ** BigInt(assets[currency]) +
    BigInt(frac.padEnd(assets[currency], "0"));
  if (n < (zero ? 0n : 1n)) fail(400, "Price must be greater than zero.");
  return n.toString();
}
export function displayAmount(value, currency) {
  const s = BigInt(value)
    .toString()
    .padStart(assets[currency] + 1, "0");
  return (
    (s.slice(0, -assets[currency]) + "." + s.slice(-assets[currency])).replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
}
