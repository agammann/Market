import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";

test("Persistent marketplace: authorization, exact totals, inventory, invoices and protected fulfillment", async () => {
  const root = path.resolve("../../work/market-tests");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, "case-"));
  const invoiceStates = new Map();
  const configured = new Set();
  let created = 0;
  // An explicit test double. No processor, chain transaction or live payment is represented here.
  const payments = {
    available: (s) => configured.has(s),
    info: (s) => ({
      connected: configured.has(s),
      assets: ["BTC", "XMR"],
      url: "http://" + "a".repeat(56) + ".onion",
    }),
    checkout: (o) => "http://" + "a".repeat(56) + ".onion/i/" + o.payment_id,
    create: async (o) => {
      created++;
      invoiceStates.set(o.id, "awaiting_payment");
      return {
        id: "fixture" + o.id.replaceAll("-", ""),
        connection: "test-only",
      };
    },
    read: async (o) => ({
      status: invoiceStates.get(o.id),
      destination: "test-fixture-not-a-wallet",
    }),
  };
  let instance = createApp({
    dataDir: dir,
    origins: ["http://market.test"],
    limits: false,
    payments,
  });
  const api = request(instance.app);
  const client = async (username) => {
    const r = await api
      .post("/api/register")
      .set("Host", "market.test")
      .set("Origin", "http://market.test")
      .send({ username, password: "Fictional password 42!" })
      .expect(200);
    return {
      id: r.body.user.id,
      cookie: r.headers["set-cookie"][0].split(";")[0],
      csrf: r.body.csrf,
    };
  };
  const send = (actor, method, url, body) => {
    let r = api[method](url)
      .set("Host", "market.test")
      .set("Origin", "http://market.test");
    if (actor)
      r = r.set("Cookie", actor.cookie).set("X-CSRF-Token", actor.csrf);
    return body ? r.send(body) : r;
  };
  try {
    const seller = await client("fixture_seller");
    const buyer = await client("fixture_buyer");
    const stranger = await client("fixture_stranger");
    instance.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(stranger.id);
    configured.add(seller.id);
    await api.get("/api/health").set("Host", "evil.test").expect(400);
    await api
      .post("/api/account")
      .set("Host", "market.test")
      .set("Origin", "http://evil.test")
      .expect(403);
    await api
      .patch("/api/account")
      .set("Host", "market.test")
      .set("Origin", "http://market.test")
      .set("Cookie", seller.cookie)
      .send({ bio: "test" })
      .expect(403);
    await send(buyer, "get", "/api/admin").expect(403);
    const file = await send(seller, "post", "/api/uploads/digital")
      .attach(
        "file",
        Buffer.from("A real private test download."),
        "fixture.txt",
      )
      .expect(201);
    const body = {
      title: "Fixture digital booklet",
      description: "Fictional data used only by automated tests.",
      kind: "digital",
      category: "Books & zines",
      price: "0.00000001",
      currency: "BTC",
      stock: 2,
      file_id: file.body.id,
    };
    await send(buyer, "post", "/api/listings", body).expect(400);
    const l = await send(seller, "post", "/api/listings", body).expect(201);
    const id = l.body.id;
    assert.equal((await send(null, "get", "/api/listings")).body.total, 0);
    await send(buyer, "get", "/api/listings/" + id).expect(404);
    await send(stranger, "post", "/api/admin/listings/" + id, {
      status: "active",
    }).expect(200);
    assert.equal(
      (await send(null, "get", "/api/listings?currency=BTC")).body.total,
      1,
    );
    const key = randomUUID();
    const order = await send(buyer, "post", "/api/orders", {
      listing_id: id,
      quantity: 1,
      request_key: key,
    }).expect(201);
    const oid = order.body.id;
    const repeated = await send(buyer, "post", "/api/orders", {
      listing_id: id,
      quantity: 1,
      request_key: key,
    }).expect(200);
    assert.equal(repeated.body.id, oid);
    assert.equal(created, 1);
    await send(buyer, "get", "/api/orders/" + oid + "/download").expect(403);
    await send(stranger, "get", "/api/orders/" + oid).expect(404);
    await send(seller, "post", "/api/orders/" + oid + "/action", {
      action: "confirm_payment",
      password: "Fictional password 42!",
    }).expect(409);
    await send(buyer, "post", "/api/orders/" + oid + "/action", {
      action: "ship",
      tracking: "not allowed",
    }).expect(409);
    invoiceStates.set(oid, "confirming");
    await send(buyer, "post", "/api/orders/" + oid + "/refresh").expect(200);
    await send(buyer, "get", "/api/orders/" + oid + "/download").expect(403);
    invoiceStates.set(oid, "fulfilled");
    await send(buyer, "post", "/api/orders/" + oid + "/refresh").expect(200);
    const download = await send(
      buyer,
      "get",
      "/api/orders/" + oid + "/download",
    ).expect(200);
    assert.equal(download.body.toString(), "A real private test download.");
    assert.match(download.headers["content-disposition"], /attachment/);
    assert.equal(download.headers["cache-control"], "no-store");
    await send(seller, "get", "/api/orders/" + oid + "/download").expect(403);
    await send(buyer, "post", "/api/orders/" + oid + "/review", {
      rating: 5,
      body: "Fixture review from fulfilled order.",
    }).expect(201);
    await send(buyer, "post", "/api/orders/" + oid + "/review", {
      rating: 5,
      body: "Duplicate review.",
    }).expect(409);
    await send(buyer, "post", "/api/orders/" + oid + "/messages", {
      body: "<script>not executed</script>",
    }).expect(201);
    await send(stranger, "post", "/api/orders/" + oid + "/messages", {
      body: "No access",
    }).expect(404);
    const privateMessages = (await send(buyer, "get", "/api/orders/" + oid))
      .body.messages;
    assert.equal(privateMessages.at(-1).body, "<script>not executed</script>");
    assert.ok(
      instance.db
        .prepare("SELECT body FROM messages WHERE order_id=?")
        .all(oid)
        .every((m) => m.body.startsWith("enc1:")),
    );
    await send(seller, "post", "/api/orders/" + oid + "/action", {
      action: "record_refund",
      reference: "fixture-refund-reference-only",
    }).expect(200);
    await send(buyer, "get", "/api/orders/" + oid + "/download").expect(403);
    const physical = await send(seller, "post", "/api/listings", {
      ...body,
      title: "Fixture physical book",
      kind: "physical",
      currency: "XMR",
      price: "0.100000000001",
      shipping: "0.000000000001",
      ships_to: "Test region",
      stock: 1,
      file_id: null,
    }).expect(201);
    await send(stranger, "post", "/api/admin/listings/" + physical.body.id, {
      status: "active",
    }).expect(200);
    await send(buyer, "post", "/api/orders", {
      listing_id: physical.body.id,
      quantity: 1,
      request_key: randomUUID(),
    }).expect(400);
    const p = await send(buyer, "post", "/api/orders", {
      listing_id: physical.body.id,
      quantity: 1,
      address: "Fictional recipient, 123 Example Street, Test Region",
      request_key: randomUUID(),
    }).expect(201);
    const pId = p.body.id;
    const detail = await send(buyer, "get", "/api/orders/" + pId);
    assert.equal(detail.body.order.total, "0.100000000002");
    assert.equal(
      detail.body.order.address,
      "Fictional recipient, 123 Example Street, Test Region",
    );
    assert.ok(
      instance.db
        .prepare("SELECT address FROM orders WHERE id=?")
        .get(pId)
        .address.startsWith("enc1:"),
    );
    await send(buyer, "post", "/api/orders", {
      listing_id: physical.body.id,
      quantity: 1,
      address: "Fictional recipient, Test Region",
      request_key: randomUUID(),
    }).expect(409);
    invoiceStates.set(pId, "paid");
    await send(buyer, "post", "/api/orders/" + pId + "/refresh").expect(200);
    await send(seller, "post", "/api/orders/" + pId + "/action", {
      action: "ship",
      tracking: "Fictional carrier and tracking",
    }).expect(200);
    await send(buyer, "post", "/api/orders/" + pId + "/action", {
      action: "complete",
    }).expect(200);
    await send(buyer, "get", "/api/orders/" + pId + "/download").expect(403);
    await send(seller, "post", "/api/listings", {
      ...body,
      currency: "ETH",
    }).expect(400);
    await send(seller, "post", "/api/listings", {
      ...body,
      currency: "USDT",
    }).expect(400);
    await send(buyer, "post", "/api/listings/" + id + "/report", {
      reason: "A fictional moderation report for testing.",
    }).expect(201);
    assert.equal(
      (await send(stranger, "get", "/api/admin")).body.reports.length,
      1,
    );
    const cookie = buyer.cookie;
    instance.close();
    instance = createApp({
      dataDir: dir,
      origins: ["http://market.test"],
      limits: false,
      payments,
    });
    const persisted = await request(instance.app)
      .get("/api/orders/" + pId)
      .set("Host", "market.test")
      .set("Cookie", cookie)
      .expect(200);
    assert.equal(persisted.body.order.status, "fulfilled");
    assert.equal(
      persisted.body.order.address,
      "Fictional recipient, 123 Example Street, Test Region",
    );
    assert.equal(
      persisted.body.order.tracking,
      "Fictional carrier and tracking",
    );
  } finally {
    instance.close();
    if (path.dirname(dir) !== root) throw Error("Test cleanup path mismatch");
    rmSync(dir, { recursive: true, force: true });
  }
});
