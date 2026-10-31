import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { passwordHash, passwordMatches } from "../server/security.mjs";

test("password attempts use the account, not ignored body data", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "market-password-fixture-"));
  const instance = createApp({
    dataDir: dir,
    origins: ["http://market.test"],
    limits: true,
    payments: {},
  });
  const route = instance.app.router.stack.find(
    (layer) => layer.route?.path === "/api/account/password",
  ).route;
  const handlers = route.stack.map((layer) => layer.handle);
  const hash = await passwordHash("Fictional password 42!");
  const insert = instance.db.prepare(
    "INSERT INTO users(id,username,password,created_at) VALUES(?,?,?,?)",
  );
  insert.run("fixture-a", "fixture_a", hash, Date.now());
  insert.run("fixture-b", "fixture_b", hash, Date.now());
  instance.db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .run("old-session", "fixture-b", "old-csrf", Date.now() + 60_000);
  const call = async (id, username, currentPassword = "Incorrect fixture!") => {
    const user = instance.db.prepare("SELECT * FROM users WHERE id=?").get(id);
    const req = {
      user,
      ip: username,
      body: { username, currentPassword, password: "Another fictional pass!" },
    };
    const res = {
      statusCode: 200,
      headers: {},
      status(n) {
        this.statusCode = n;
        return this;
      },
      set(k, v) {
        this.headers[k] = v;
        return this;
      },
      cookie(name, value) {
        this.cookieName = name;
        this.cookieValue = value;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    for (const handler of handlers) {
      let advanced = false;
      try {
        await handler(req, res, () => {
          advanced = true;
        });
      } catch (error) {
        return { status: error.status, res };
      }
      if (!advanced) return { status: res.statusCode, res };
    }
    throw Error("route did not terminate");
  };
  try {
    for (let i = 0; i < 20; i++)
      assert.equal((await call("fixture-a", `ignored_${i}`)).status, 403);
    const blocked = await call("fixture-a", "ignored_next");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.res.headers["Retry-After"]) > 0);
    const success = await call(
      "fixture-b",
      "ignored_next",
      "Fictional password 42!",
    );
    assert.equal(success.status, 200);
    assert.equal(success.res.cookieName, "market_session");
    assert.ok(success.res.cookieValue);
    assert.ok(success.res.body.csrf);
    assert.equal(
      instance.db
        .prepare("SELECT COUNT(*) AS n FROM sessions WHERE token=?")
        .get("old-session").n,
      0,
    );
    const changed = instance.db
      .prepare("SELECT password FROM users WHERE id=?")
      .get("fixture-b");
    assert.equal(
      await passwordMatches("Another fictional pass!", changed.password),
      true,
    );
  } finally {
    instance.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
