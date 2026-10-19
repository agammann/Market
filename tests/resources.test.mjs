import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { digest, token } from "../server/security.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture(options, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "market-resources-"));
  const distDir = path.join(dir, "dist");
  mkdirSync(distDir);
  writeFileSync(
    path.join(distDir, "index.html"),
    "<!doctype html><title>Market fixture</title>",
  );
  writeFileSync(
    path.join(distDir, "large.bin"),
    Buffer.alloc(16 * 1024 * 1024, 42),
  );
  const instance = createApp({
    dataDir: path.join(dir, "data"),
    distDir,
    origins: ["http://market.test"],
    payments: { available: () => false },
    resourceLimits: { requestMax: 1000, ...options },
  });
  const server = http.createServer(instance.app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const api = request(server);
  const call = (method, url) =>
    api[method](url)
      .set("Host", "market.test")
      .set("Origin", "http://market.test");
  try {
    await run({ instance, server, api, call, dir });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    instance.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("aggregate rejection precedes JSON parsing and recovers without trusting forwarded clients", async () => {
  await fixture({ requestMax: 2, requestWindowMs: 2000 }, async ({ call }) => {
    for (let i = 0; i < 2; i++)
      await call("post", "/api/register").type("json").send("{").expect(400);
    const blocked = await call("post", "/api/register")
      .set("X-Forwarded-For", "198.51.100.77")
      .type("json")
      .send("{")
      .expect(429);
    assert.ok(Number(blocked.headers["retry-after"]) >= 1);
    await call("get", "/api/health")
      .expect(200)
      .expect("Cache-Control", "no-store");
    await call("head", "/api/health").expect(200);
    await call("get", "/api/health").set("Host", "evil.test").expect(400);
    await pause(2100);
    await call("get", "/api/session").expect(200);
  });
});

test("in-flight admission bounds incomplete bodies and releases an aborted request", async () => {
  await fixture({ inflightMax: 1 }, async ({ server, call }) => {
    const admitted = once(server, "request");
    const slow = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      path: "/api/register",
      method: "POST",
      headers: {
        Host: "market.test",
        Origin: "http://market.test",
        "Content-Type": "application/json",
        "Content-Length": "64",
      },
    });
    slow.on("error", () => {});
    slow.write("{");
    await admitted;
    await pause(25);
    const blocked = await call("get", "/api/session").expect(429);
    assert.equal(blocked.headers["retry-after"], "1");
    await call("get", "/api/health").expect(200);
    slow.destroy();
    await new Promise((resolve) => slow.once("close", resolve));
    await pause(25);
    for (let i = 0; i < 3; i++) await call("get", "/api/session").expect(200);
  });
});

function records(instance, dir) {
  const users = {};
  for (const name of ["seller", "buyer", "other"]) {
    const raw = token();
    instance.db
      .prepare(
        "INSERT INTO users(id,username,password,created_at) VALUES(?,?,?,0)",
      )
      .run(name, name, "unused-test-hash");
    instance.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(digest(raw), name, "fixture-csrf", Date.now() + 60000);
    users[name] = "market_session=" + raw;
  }
  const files = path.join(dir, "data", "files");
  writeFileSync(
    path.join(files, "photo"),
    Buffer.from("Fictional image fixture"),
  );
  writeFileSync(
    path.join(files, "download"),
    Buffer.from("Exact purchased fixture"),
  );
  const upload = instance.db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,0)");
  upload.run("photo", "seller", "image", "photo.webp", 24);
  upload.run("download", "seller", "digital", "fixture.txt", 23);
  instance.db
    .prepare(
      "INSERT INTO listings(id,seller_id,title,description,kind,category,price,currency,stock,image_id,file_id,status,created_at,updated_at) VALUES('listing','seller','Fixture','Fictional fixture','digital','Other','1','BTC',2,'photo','download','active',0,0)",
    )
    .run();
  instance.db
    .prepare(
      "INSERT INTO orders(id,buyer_id,seller_id,listing_id,title,kind,file_id,quantity,unit_price,shipping,total,currency,address,payment_address,status,created_at,updated_at,request_key) VALUES('paid','buyer','seller','listing','Fixture','digital','download',1,'1','0','1','BTC','','','fulfilled',0,0,'fixture-order')",
    )
    .run();
  return users;
}

async function holdFile(server) {
  const req = http.get({
    host: "127.0.0.1",
    port: server.address().port,
    path: "/large.bin",
    headers: { Host: "market.test" },
  });
  req.on("error", () => {});
  const [response] = await once(req, "response");
  response.on("error", () => {});
  response.pause();
  assert.equal(response.statusCode, 200);
  return { req, response };
}

test("media, paid files and SPA share bounded streaming capacity without changing authorization", async () => {
  await fixture({ fileMax: 1 }, async ({ instance, server, call, dir }) => {
    const users = records(instance, dir);
    const held = await holdFile(server);
    for (const url of ["/media/photo", "/browse", "/large.bin"]) {
      const blocked = await call("get", url).expect(429);
      assert.equal(blocked.headers["retry-after"], "1");
    }
    await call("get", "/api/orders/paid/download")
      .set("Cookie", users.buyer)
      .expect(429);
    await call("get", "/api/orders/paid/download").expect(401);
    held.response.destroy();
    held.req.destroy();
    await pause(50);
    const head = await call("head", "/large.bin").expect(200);
    assert.equal(Number(head.headers["content-length"]), 16 * 1024 * 1024);
    await call("get", "/large.bin")
      .set("If-None-Match", head.headers.etag)
      .expect(304);
    const part = await call("get", "/large.bin")
      .set("Range", "bytes=0-3")
      .expect(206);
    assert.deepEqual(part.body, Buffer.alloc(4, 42));
    await call("get", "/large.bin")
      .set("Range", "bytes=999999999-")
      .expect(416);
    await call("get", "/media/missing").expect(404);
    await call("get", "/browse").expect(200).expect("Content-Type", /html/);
    const download = await call("get", "/api/orders/paid/download")
      .set("Cookie", users.buyer)
      .expect(200);
    assert.equal(download.body.toString(), "Exact purchased fixture");
    assert.equal(download.headers["cache-control"], "no-store");
    assert.match(download.headers["content-disposition"], /attachment/);
    await call("get", "/api/orders/paid/download")
      .set("Cookie", users.seller)
      .expect(403);
    await call("get", "/api/orders/paid/download")
      .set("Cookie", users.other)
      .expect(404);
    instance.db
      .prepare("UPDATE listings SET status='pending' WHERE id='listing'")
      .run();
    await call("get", "/media/photo").expect(404);
    await call("get", "/media/photo").set("Cookie", users.other).expect(404);
    await call("get", "/media/photo")
      .set("Cookie", users.seller)
      .expect(200)
      .expect("Cache-Control", "no-store");
    instance.db
      .prepare("UPDATE sessions SET expires=0 WHERE user_id='seller'")
      .run();
    await call("get", "/media/photo").set("Cookie", users.seller).expect(404);
  });
});

for (const [kind, timeouts] of [
  ["total", { fileTotalMs: 150, fileIdleMs: 10000 }],
  ["idle", { fileTotalMs: 10000, fileIdleMs: 150 }],
])
  test(`a file ${kind} deadline frees capacity when the receiver stops reading`, async () => {
    await fixture({ fileMax: 1, ...timeouts }, async ({ server, call }) => {
      const held = await holdFile(server);
      await call("get", "/browse").expect(429);
      await pause(300);
      await call("get", "/browse").expect(200);
      held.response.destroy();
      held.req.destroy();
    });
  });

test("an earlier pipelined response cannot remove the next file's idle deadline", async () => {
  await fixture(
    { fileMax: 2, fileIdleMs: 300, fileTotalMs: 10000 },
    async ({ server }) => {
      const connection = once(server, "connection");
      const socket = net.connect(server.address().port, "127.0.0.1");
      socket.on("error", () => {});
      await once(socket, "connect");
      const [serverSocket] = await connection;
      const data = once(socket, "data");
      socket.write(
        "HEAD /large.bin HTTP/1.1\r\nHost: market.test\r\n\r\nGET /large.bin HTTP/1.1\r\nHost: market.test\r\n\r\n",
      );
      await data;
      socket.pause();
      try {
        await pause(700);
        assert.equal(serverSocket.destroyed, true);
      } finally {
        socket.destroy();
      }
    },
  );
});
