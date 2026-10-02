import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.mjs";

async function fixture(run) {
  const root = path.resolve(tmpdir());
  const dir = mkdtempSync(path.join(root, "market-moderation-"));
  const instance = createApp({
    dataDir: dir,
    origins: ["http://market.test"],
    limits: false,
    payments: { available: () => false },
  });
  const api = request(instance.app);
  const send = (actor, method, url, body) => {
    let call = api[method](url)
      .set("Host", "market.test")
      .set("Origin", "http://market.test");
    if (actor)
      call = call.set("Cookie", actor.cookie).set("X-CSRF-Token", actor.csrf);
    return body ? call.send(body) : call;
  };
  async function account(username) {
    const result = await send(null, "post", "/api/register", {
      username,
      password: "Fictional local password 42!",
    }).expect(200);
    return {
      id: result.body.user.id,
      csrf: result.body.csrf,
      cookie: result.headers["set-cookie"][0].split(";")[0],
    };
  }
  try {
    await run({ instance, send, account });
  } finally {
    instance.close();
    assert(path.resolve(dir).startsWith(root + path.sep));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("unpublished photos are visible to their seller and moderator, but not other visitors", async () =>
  fixture(async ({ instance, send, account }) => {
    const seller = await account("photo_seller"),
      admin = await account("photo_admin"),
      other = await account("photo_other");
    instance.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(admin.id);
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#cc7733" },
    })
      .png()
      .toBuffer();
    const upload = await send(seller, "post", "/api/uploads/image")
      .attach("file", png, "photo.png")
      .expect(201);
    const listing = await send(seller, "post", "/api/listings", {
      title: "Fictional product",
      description: "A fictional physical product for moderation.",
      kind: "physical",
      category: "Other",
      currency: "BTC",
      price: "0.001",
      stock: 2,
      shipping: "0",
      ships_to: "Fictional region",
      image_id: upload.body.id,
    }).expect(201);
    const url = "/media/" + upload.body.id;
    for (const status of ["pending", "paused", "rejected"]) {
      if (status !== "pending")
        await send(admin, "post", "/api/admin/listings/" + listing.body.id, {
          status,
        }).expect(200);
      for (const actor of [seller, admin])
        await send(actor, "get", url)
          .expect(200)
          .expect("Content-Type", /image\/webp/)
          .expect("Cache-Control", /no-store/);
      for (const actor of [null, other])
        await send(actor, "get", url).expect(404);
    }
    await send(admin, "post", "/api/admin/listings/" + listing.body.id, {
      status: "active",
    }).expect(200);
    await send(null, "get", url).expect(200);
    await send(admin, "post", "/api/admin/listings/" + listing.body.id, {
      status: "paused",
    }).expect(200);
    instance.db
      .prepare("UPDATE sessions SET expires=0 WHERE user_id=?")
      .run(seller.id);
    await send(seller, "get", url).expect(404);
  }));

test("moderation keeps older pending listings and all report pages reachable", async () =>
  fixture(async ({ instance, send, account }) => {
    const seller = await account("queue_seller"),
      second = await account("queue_second"),
      admin = await account("queue_admin");
    instance.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(admin.id);
    const insert = instance.db.prepare(
      "INSERT INTO listings(id,seller_id,title,description,kind,category,price,currency,stock,status,created_at,updated_at) VALUES(?,?,?,'Fictional product','physical','Other','100','BTC',1,?,?,?)",
    );
    const pending = randomUUID(),
      ids = [pending];
    insert.run(pending, seller.id, "Old edited submission", "pending", 1, 500);
    for (let i = 0; i < 301; i++) {
      const id = randomUUID();
      ids.push(id);
      insert.run(
        id,
        i < 150 ? seller.id : second.id,
        "Newer listing " + i,
        "active",
        100,
        100,
      );
    }
    const first = await send(admin, "get", "/api/admin").expect(200);
    assert(
      first.body.listings.some((l) => l.id === pending),
      "An older edited listing must remain reachable in moderation",
    );
    assert.equal(first.body.listings[0].id, pending);
    assert.equal(first.body.listingPagination.total, ids.length);
    const seen = [];
    for (let page = 0; page < Math.ceil(ids.length / 24); page++) {
      const response = await send(
        admin,
        "get",
        "/api/admin?listingPage=" + page,
      ).expect(200);
      seen.push(...response.body.listings.map((l) => l.id));
    }
    assert.equal(new Set(seen).size, ids.length);
    assert.equal(seen.length, ids.length);
    const reportIds = [];
    for (let i = 0; i < 201; i++) {
      const id = randomUUID();
      reportIds.push(id);
      instance.db
        .prepare(
          "INSERT INTO reports(id,listing_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)",
        )
        .run(id, ids[i], admin.id, "Fictional report", 100);
    }
    const reports = [];
    for (let page = 0; page < Math.ceil(reportIds.length / 24); page++) {
      const response = await send(
        admin,
        "get",
        "/api/admin?reportPage=" + page,
      ).expect(200);
      assert.equal(response.body.reportPagination.total, reportIds.length);
      reports.push(...response.body.reports.map((r) => r.id));
    }
    assert.equal(new Set(reports).size, reportIds.length);
    assert.equal(reports.length, reportIds.length);
    for (const id of reports.slice(192))
      await send(admin, "post", "/api/admin/reports/" + id).expect(200);
    const resolved = await send(admin, "get", "/api/admin?reportPage=8").expect(
      200,
    );
    assert.deepEqual(resolved.body.reportPagination, {
      total: 192,
      page: 7,
      pageSize: 24,
    });
    assert.deepEqual(
      resolved.body.reports.map((r) => r.id),
      reports.slice(168, 192),
    );
    await send(seller, "get", "/api/admin").expect(403);
    await send(admin, "get", "/api/admin?listingPage=-1").expect(400);
    await send(admin, "get", "/api/admin?reportPage=0&reportPage=1").expect(
      400,
    );
  }));
