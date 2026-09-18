import { test } from "node:test";
import assert from "node:assert/strict";
import { createPayments, validateConnections } from "../server/payments.mjs";
import { amount, displayAmount } from "../server/money.mjs";
const c = {
  sellerId: "seller",
  url: "http://" + "a".repeat(56) + ".onion",
  storeId: "Store123456789",
  apiKey: "fixture-key-not-a-secret",
  assets: ["BTC", "XMR"],
};
const order = {
  id: "order1",
  seller_id: "seller",
  currency: "BTC",
  total: "100000",
  kind: "digital",
  payment_id: "Invoice12345",
  payment_connection: "",
};
function fixture(overrides = {}, methodOverride = {}) {
  const invoice = {
    id: "Invoice12345",
    storeId: c.storeId,
    currency: "BTC",
    amount: "0.001",
    metadata: { orderId: "order1" },
    status: "New",
    additionalStatus: "None",
    expirationTime: Date.now() / 1000 + 3600,
    monitoringExpiration: Date.now() / 1000 + 90000,
    ...overrides,
  };
  const calls = [];
  const payments = createPayments({
    connections: [c],
    request: async (_c, route, body) => {
      calls.push({ route, body });
      if (route.endsWith("/payment-methods"))
        return [
          {
            paymentMethodId: "BTC-CHAIN",
            destination: "fixture-only",
            totalPaid: "0",
            payments: [],
            ...methodOverride,
          },
        ];
      if (route.includes("?orderId=")) return [];
      return invoice;
    },
  });
  return { invoice, calls, payments };
}
test("Exact decimal amounts preserve satoshis and piconero", () => {
  assert.equal(amount("0.00000001", "BTC"), "1");
  assert.equal(amount("0.000000000001", "XMR"), "1");
  assert.equal(displayAmount("1000000000", "BTC"), "10");
  assert.throws(() => amount("0.000000001", "BTC"));
  assert.throws(() => amount("1", "ETH"));
  assert.throws(() => amount("1", "USDT"));
});
test("Connections reject clearnet and shared seller Monero instances", () => {
  assert.deepEqual(validateConnections([c]), [c]);
  assert.throws(() =>
    validateConnections([{ ...c, url: "https://example.com" }]),
  );
  assert.throws(() => validateConnections([c, { ...c, sellerId: "other" }]));
});
test("Invoice creation fixes exact asset, amount and no payment tolerance", async () => {
  const { payments, calls } = fixture();
  const result = await payments.create(order);
  assert.equal(result.id, "Invoice12345");
  const body = calls.find((c) => c.body).body;
  assert.equal(body.amount, "0.001");
  assert.deepEqual(body.checkout.paymentMethods, ["BTC-CHAIN"]);
  assert.equal(body.checkout.paymentTolerance, 0);
  assert.equal(body.checkout.speedPolicy, "LowSpeed");
});
test("Ambiguous creation recovers only and never blindly creates another invoice", async () => {
  const { payments, calls } = fixture();
  assert.equal(await payments.create(order, { recoverOnly: true }), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, undefined);
});
test("Failed recovery lookup can retry; a lost POST response crosses the durable attempt boundary", async () => {
  let attempted = false;
  let phase = "lookup";
  const payments = createPayments({
    connections: [c],
    request: async (_c, route) => {
      if (route.includes("?orderId=")) {
        if (phase === "lookup") throw Error("Temporary lookup failure");
        return [];
      }
      assert.equal(attempted, true);
      throw Error("Lost POST response");
    },
  });
  const onAttempt = () => {
    attempted = true;
  };
  await assert.rejects(() => payments.create(order, { onAttempt }));
  assert.equal(attempted, false);
  phase = "post";
  await assert.rejects(() => payments.create(order, { onAttempt }));
  assert.equal(attempted, true);
  assert.equal(
    await payments.create(order, { recoverOnly: attempted, onAttempt }),
    null,
  );
});
test("New and Processing invoices never unlock digital fulfillment", async () => {
  assert.equal(
    (await fixture().payments.read(order)).status,
    "awaiting_payment",
  );
  assert.equal(
    (await fixture({ status: "Processing" }).payments.read(order)).status,
    "confirming",
  );
});
test("Only settled invoices unlock delivery; manual marking remains review", async () => {
  assert.equal(
    (await fixture({ status: "Settled" }).payments.read(order)).status,
    "fulfilled",
  );
  assert.equal(
    (
      await fixture({ status: "Settled" }).payments.read({
        ...order,
        kind: "physical",
      })
    ).status,
    "paid",
  );
  assert.equal(
    (
      await fixture({
        status: "Settled",
        additionalStatus: "Marked",
      }).payments.read(order)
    ).status,
    "payment_review",
  );
});
test("Mismatched invoice asset, amount, store and order are rejected", async () => {
  for (const override of [
    { currency: "XMR" },
    { amount: "0.002" },
    { storeId: "OtherStore123" },
    { metadata: { orderId: "other" } },
  ])
    await assert.rejects(() => fixture(override).payments.read(order));
});
test("Unpaid expiry releases inventory only after the monitoring window; partial payments remain review", async () => {
  const fields = {
    status: "Expired",
    monitoringExpiration: Date.now() / 1000 - 5,
  };
  assert.equal((await fixture(fields).payments.read(order)).status, "expired");
  assert.equal(
    (
      await fixture(fields, {
        totalPaid: "0.0001",
        payments: [{ id: "partial" }],
      }).payments.read(order)
    ).status,
    "payment_review",
  );
  assert.equal(
    (await fixture({ status: "Expired" }).payments.read(order)).status,
    "payment_review",
  );
});
test("Old invoices cannot be checked against a changed seller connection", async () => {
  await assert.rejects(() =>
    fixture().payments.read({
      ...order,
      payment_connection: "different-instance",
    }),
  );
});
