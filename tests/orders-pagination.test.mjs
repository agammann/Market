import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

test("Order history keeps purchases and all sales reachable across role-specific pages", async () => {
  const root = path.resolve(tmpdir());
  const dir = mkdtempSync(path.join(root, "market-orders-pagination-"));
  const instance = createApp({
    dataDir: dir,
    origins: ["http://market.test"],
    limits: false,
    payments: {
      available: () => false,
      info: () => ({ connected: false, assets: [] }),
      checkout: () => null,
      create: async () => assert.fail("This test must not create invoices."),
      read: async () => assert.fail("This test must not read invoices."),
    },
  });
  const api = request(instance.app);
  const register = async (username) => {
    const result = await api
      .post("/api/register")
      .set("Host", "market.test")
      .set("Origin", "http://market.test")
      .send({ username, password: "Fictional password 42!" })
      .expect(200);
    return {
      id: result.body.user.id,
      cookie: result.headers["set-cookie"][0].split(";")[0],
    };
  };
  const get = (actor, query = "") =>
    api
      .get("/api/orders" + query)
      .set("Host", "market.test")
      .set("Cookie", actor.cookie);
  try {
    const member = await register("history_member");
    const counterparty = await register("history_counterparty");
    const outsider = await register("history_outsider");
    const listing = instance.db.prepare(
      "INSERT INTO listings(id,seller_id,title,description,kind,category,price,currency,stock,created_at,updated_at) VALUES(?,?, 'History fixture','A fictional history fixture.','digital','Books & zines','1','BTC',1,0,0)",
    );
    listing.run("member-listing", member.id);
    listing.run("counterparty-listing", counterparty.id);
    const order = instance.db.prepare(
      "INSERT INTO orders(id,buyer_id,seller_id,listing_id,title,kind,quantity,unit_price,shipping,total,currency,address,payment_address,status,created_at,updated_at,request_key) VALUES(?,?,?,?,?,'digital',1,'1','0','1','BTC','','','fulfilled',?,?,?)",
    );
    order.run(
      "old-purchase",
      member.id,
      counterparty.id,
      "counterparty-listing",
      "Old purchase",
      1,
      1,
      "old-purchase-key",
    );
    const saleIds = Array.from(
      { length: 217 },
      (_, i) => "sale-" + String(i).padStart(3, "0"),
    );
    for (const [i, id] of saleIds.entries()) {
      const timestamp = 1000 + Math.floor(i / 31);
      order.run(
        id,
        counterparty.id,
        member.id,
        "member-listing",
        "Sale " + i,
        timestamp,
        timestamp,
        id,
      );
    }

    const buying = await get(member, "?view=buying&page=0").expect(200);
    const purchases = buying.body.items ?? buying.body;
    assert.ok(
      purchases.some((o) => o.id === "old-purchase"),
      "An older purchase must remain visible after more than 200 newer sales.",
    );
    assert.deepEqual(
      buying.body.items.map((o) => o.id),
      ["old-purchase"],
    );
    assert.equal(buying.body.total, 1);
    assert.equal(buying.body.page, 0);
    assert.equal(buying.body.pageSize, 24);
    assert.deepEqual((await get(member).expect(200)).body, buying.body);

    const seen = [];
    let lastPage;
    for (let page = 0; page < Math.ceil(saleIds.length / 24); page++) {
      const result = await get(member, `?view=selling&page=${page}`).expect(
        200,
      );
      assert.equal(result.body.total, saleIds.length);
      assert.equal(result.body.page, page);
      assert.equal(result.body.pageSize, 24);
      assert.equal(
        result.body.items.length,
        Math.min(24, saleIds.length - page * 24),
      );
      assert.ok(result.body.items.every((o) => o.seller_id === member.id));
      seen.push(...result.body.items.map((o) => o.id));
      lastPage = result.body;
    }
    assert.equal(new Set(seen).size, saleIds.length);
    assert.deepEqual(seen, saleIds.toReversed());
    assert.deepEqual(
      (await get(member, "?view=selling&page=999").expect(200)).body,
      lastPage,
    );

    for (const view of ["buying", "selling"]) {
      assert.deepEqual(
        (await get(outsider, `?view=${view}&page=999`).expect(200)).body,
        { items: [], total: 0, page: 0, pageSize: 24 },
      );
    }
    for (const query of [
      "?view=other",
      "?view=buying&view=selling",
      "?page=-1",
      "?page=1.5",
      "?page=abc",
      "?page=1&page=2",
    ])
      await get(member, query).expect(400);
    await api.get("/api/orders").set("Host", "market.test").expect(401);
  } finally {
    instance.close();
    assert.equal(path.dirname(dir), root);
    rmSync(dir, { recursive: true, force: true });
  }
});
