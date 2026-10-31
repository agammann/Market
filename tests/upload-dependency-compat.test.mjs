import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

test("rejected multipart fields leave no temporary files and do not block a later upload", async () => {
  const root = path.resolve(tmpdir());
  const dir = mkdtempSync(path.join(root, "market-upload-dependency-"));
  const instance = createApp({
    dataDir: dir,
    origins: ["http://market.test"],
    limits: false,
    payments: { available: () => false },
  });
  const api = request(instance.app);
  const send = (url) =>
    api.post(url).set("Host", "market.test").set("Origin", "http://market.test");
  try {
    const account = await send("/api/register")
      .send({ username: "upload_fixture", password: "Fictional password 42!" })
      .expect(200);
    const cookie = account.headers["set-cookie"][0].split(";")[0];
    const csrf = account.body.csrf;
    const upload = () =>
      send("/api/uploads/digital").set("Cookie", cookie).set("X-CSRF-Token", csrf);

    await upload().attach("unexpected", Buffer.from("fictional"), "x.txt").expect(400);
    assert.deepEqual(readdirSync(path.join(dir, "tmp")), []);
    await upload().attach("file", Buffer.from("fictional"), "ok.txt").expect(201);
    assert.deepEqual(readdirSync(path.join(dir, "tmp")), []);
  } finally {
    instance.close();
    assert(path.resolve(dir).startsWith(root + path.sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
