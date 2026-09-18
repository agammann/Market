import http from "node:http";
import https from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { SocksProxyAgent } from "socks-proxy-agent";
import { amount, displayAmount } from "./money.mjs";
import { fail } from "./security.mjs";

export function validateConnections(connections) {
  const hosts = new Set();
  const sellers = new Set();
  for (const c of connections) {
    const url = new URL(c.url);
    if (
      !/^https?:$/.test(url.protocol) ||
      !/^[a-z2-7]{56}\.onion$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port
    )
      throw Error(
        "BTCPay connections must use a root v3 onion URL with no custom port.",
      );
    if (
      !/^[a-zA-Z0-9]{10,100}$/.test(c.storeId) ||
      typeof c.apiKey !== "string" ||
      !/^[\x21-\x7e]{16,1024}$/.test(c.apiKey) ||
      typeof c.sellerId !== "string"
    )
      throw Error("Invalid BTCPay connection fields.");
    if (hosts.has(url.hostname) || sellers.has(c.sellerId))
      throw Error(
        "Each seller must have a separate BTCPay onion instance. The Monero plugin shares a wallet across stores.",
      );
    if (
      !Array.isArray(c.assets) ||
      !c.assets.length ||
      c.assets.some((a) => !["BTC", "XMR"].includes(a))
    )
      throw Error("Only BTC and XMR payment assets are supported.");
    hosts.add(url.hostname);
    sellers.add(c.sellerId);
  }
  return connections;
}
export function loadConnections(file) {
  if (!file || !existsSync(file)) return [];
  const connections = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(connections))
    throw Error("BTCPay configuration must be an array.");
  return validateConnections(connections);
}
export function onionRequest(proxyUrl) {
  const agent = new SocksProxyAgent(proxyUrl, { timeout: 30000 });
  return async function request(connection, route, body) {
    const url = new URL(route, connection.url);
    const payload = body ? JSON.stringify(body) : null;
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          agent,
          method: payload ? "POST" : "GET",
          headers: {
            Authorization: "token " + connection.apiKey,
            Accept: "application/json",
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (response) => {
          const chunks = [];
          let length = 0;
          response.on("data", (chunk) => {
            length += chunk.length;
            if (length > 1024 * 1024) {
              response.destroy();
              reject(Error("BTCPay response exceeded the size limit."));
            } else chunks.push(chunk);
          });
          response.on("error", () =>
            reject(Error("BTCPay response was interrupted.")),
          );
          response.on("end", () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(Error("BTCPay could not complete the request."));
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(Error("BTCPay returned invalid data."));
            }
          });
        },
      );
      const deadline = setTimeout(
        () => request.destroy(Error("BTCPay request timed out.")),
        45000,
      );
      request.on("close", () => clearTimeout(deadline));
      request.on("error", () =>
        reject(Error("BTCPay connection unavailable.")),
      );
      if (payload) request.write(payload);
      request.end();
    });
  };
}
export function createPayments({
  connections = [],
  request = onionRequest(
    process.env.TOR_SOCKS_URL || "socks5h://127.0.0.1:9050",
  ),
} = {}) {
  const bySeller = new Map(
    connections.map((c) => [
      c.sellerId,
      {
        ...c,
        fingerprint: createHash("sha256")
          .update(c.url + "|" + c.storeId)
          .digest("hex"),
      },
    ]),
  );
  const available = (seller, currency) => {
    const c = bySeller.get(seller);
    return Boolean(c && (!currency || c.assets.includes(currency)));
  };
  const connection = (o) => {
    const c = bySeller.get(o.seller_id);
    if (!c || !c.assets.includes(o.currency))
      fail(409, "This seller has not connected BTCPay for this payment asset.");
    if (o.payment_connection && o.payment_connection !== c.fingerprint)
      fail(
        409,
        "This invoice belongs to a different BTCPay connection. Operator review is required.",
      );
    return c;
  };
  const verify = (invoice, o, c) => {
    if (
      !invoice ||
      typeof invoice.id !== "string" ||
      !/^[a-zA-Z0-9]{5,100}$/.test(invoice.id) ||
      invoice.storeId !== c.storeId ||
      invoice.currency !== o.currency ||
      invoice.metadata?.orderId !== o.id ||
      amount(invoice.amount, o.currency) !== o.total
    )
      throw Error("BTCPay invoice does not match this order.");
    return invoice;
  };
  return {
    available,
    info: (seller) => {
      const c = bySeller.get(seller);
      return c
        ? { connected: true, assets: c.assets, url: c.url }
        : { connected: false, assets: [] };
    },
    checkout: (o) => {
      try {
        const c = connection(o);
        return new URL("/i/" + encodeURIComponent(o.payment_id), c.url).href;
      } catch {
        return null;
      }
    },
    async create(o, { recoverOnly = false, onAttempt = () => {} } = {}) {
      const c = connection(o);
      // Recover an invoice after a lost response. Never blindly create a second invoice.
      const matches = await request(
        c,
        `/api/v1/stores/${encodeURIComponent(c.storeId)}/invoices?orderId=${encodeURIComponent(o.id)}`,
      );
      if (!Array.isArray(matches) || matches.length > 1)
        throw Error("Invoice recovery needs operator review.");
      let invoice = matches[0];
      if (!invoice && recoverOnly) return null;
      if (!invoice) {
        // Persist the ambiguity boundary before POST, but not before a read-only lookup.
        await onAttempt();
        invoice = await request(
          c,
          `/api/v1/stores/${encodeURIComponent(c.storeId)}/invoices`,
          {
            amount: displayAmount(o.total, o.currency),
            currency: o.currency,
            metadata: { orderId: o.id },
            checkout: {
              paymentMethods: [`${o.currency}-CHAIN`],
              defaultPaymentMethod: `${o.currency}-CHAIN`,
              lazyPaymentMethods: false,
              expirationMinutes: 60,
              monitoringMinutes: 1440,
              paymentTolerance: 0,
              speedPolicy: "LowSpeed",
            },
            receipt: { enabled: false },
          },
        );
      }
      verify(invoice, o, c);
      return { id: invoice.id, connection: c.fingerprint };
    },
    async read(o) {
      const c = connection(o);
      const invoice = verify(
        await request(
          c,
          `/api/v1/invoices/${encodeURIComponent(o.payment_id)}`,
        ),
        o,
        c,
      );
      const methods = await request(
        c,
        `/api/v1/invoices/${encodeURIComponent(o.payment_id)}/payment-methods`,
      );
      if (!Array.isArray(methods))
        throw Error("BTCPay payment details are unavailable.");
      const method = methods.find(
        (m) => m.paymentMethodId === `${o.currency}-CHAIN`,
      );
      if (!method) throw Error("Expected payment method is missing.");
      const checkUrl = new URL(`/i/${encodeURIComponent(invoice.id)}`, c.url)
        .href;
      let status = "awaiting_payment";
      if (invoice.additionalStatus?.includes("Marked"))
        status = "payment_review";
      else if (invoice.status === "Settled")
        status = o.kind === "digital" ? "fulfilled" : "paid";
      else if (invoice.status === "Processing") status = "confirming";
      else if (["Expired", "Invalid"].includes(invoice.status))
        status = "payment_review";
      if (
        status === "payment_review" &&
        invoice.status === "Expired" &&
        Number(invoice.monitoringExpiration) * 1000 < Date.now() &&
        methods.length > 0 &&
        methods.every(
          (m) =>
            Array.isArray(m.payments) &&
            m.payments.length === 0 &&
            typeof m.totalPaid === "string" &&
            /^0+(\.0+)?$/.test(m.totalPaid),
        )
      )
        status = "expired";
      if (
        status === "awaiting_payment" &&
        Number(invoice.expirationTime) * 1000 < Date.now()
      )
        status = "payment_review";
      return {
        status,
        invoiceStatus: invoice.status,
        destination: method?.destination || "",
        due: method?.due || null,
        expires: Number(invoice.expirationTime) * 1000,
        checkoutUrl: checkUrl,
      };
    },
  };
}
