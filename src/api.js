let csrf = null;
export function setCsrf(value) {
  csrf = value;
}
export async function api(url, options = {}) {
  const { body, ...rest } = options;
  const form = body instanceof FormData;
  const response = await fetch("/api" + url, {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(form ? {} : { "Content-Type": "application/json" }),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  if ("csrf" in data) csrf = data.csrf;
  return data;
}
export async function upload(file, kind) {
  const form = new FormData();
  form.set("file", file);
  return api("/uploads/" + kind, { method: "POST", body: form });
}
export const categories = [
  "Art & collectibles",
  "Books & zines",
  "Clothing & accessories",
  "Electronics",
  "Home & living",
  "Software & templates",
  "Other",
];
export const assetLabels = { BTC: "Bitcoin", XMR: "Monero" };
export const statusLabel = (s) =>
  ({
    awaiting_invoice: "Preparing invoice",
    confirming: "Waiting for confirmations",
    payment_review: "Payment needs review",
    awaiting_payment: "Awaiting payment",
    payment_submitted: "Seller checking payment",
    paid: "Payment confirmed",
    shipped: "Shipped",
    fulfilled: "Fulfilled",
    cancelled: "Cancelled",
    expired: "Expired",
    refunded: "Refund recorded",
    pending: "Awaiting approval",
    active: "Published",
    paused: "Paused",
    rejected: "Not approved",
  })[s] || s;
