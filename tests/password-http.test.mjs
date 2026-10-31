import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

test("password attempts across sessions use one account budget", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "market-password-http-fixture-"));
  const instance = createApp({
    dataDir: dir,
    origins: ["http://market.test"],
    limits: true,
    payments: {},
  });
  const api = request(instance.app);
  const call = (method, url) =>
    api[method](url)
      .set("Host", "market.test")
      .set("Origin", "http://market.test");
  const session = (r) => ({
    cookie: r.headers["set-cookie"][0].split(";")[0],
    csrf: r.body.csrf,
  });
  const register = async (username) =>
    session(
      await call("post", "/api/register")
        .send({ username, password: "Fictional password 42!" })
        .expect(200),
    );
  const change = (actor, body) =>
    call("post", "/api/account/password")
      .set("Cookie", actor.cookie)
      .set("X-CSRF-Token", actor.csrf)
      .send(body);
  try {
    const first = await register("fixture_first");
    const secondSession = session(
      await call("post", "/api/login")
        .send({ username: "fixture_first", password: "Fictional password 42!" })
        .expect(200),
    );
    const secondAccount = await register("fixture_second");
    await call("post", "/api/account/password")
      .send({ currentPassword: "Incorrect fixture!" })
      .expect(401);
    await call("post", "/api/account/password")
      .set("Cookie", first.cookie)
      .send({ currentPassword: "Incorrect fixture!" })
      .expect(403);
    for (let i = 0; i < 20; i++)
      await change(i % 2 ? first : secondSession, {
        username: `ignored_${i}`,
        currentPassword: "Incorrect fixture!",
        password: "Another fictional pass!",
      }).expect(403);
    const blocked = await change(secondSession, {
      username: "ignored_next",
      currentPassword: "Incorrect fixture!",
      password: "Another fictional pass!",
    }).expect(429);
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
    const changed = await change(secondAccount, {
      currentPassword: "Fictional password 42!",
      password: "Another fictional pass!",
    }).expect(200);
    assert.ok(changed.body.csrf);
    await call("post", "/api/login")
      .send({ username: "fixture_second", password: "Another fictional pass!" })
      .expect(200);
  } finally {
    instance.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
