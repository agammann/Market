import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase } from "../server/db.mjs";

test("Operator imports a seller connection through stdin without exposing credentials", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "market-admin-"));
  const db = openDatabase(dir);
  db.prepare(
    "INSERT INTO users VALUES('seller','seller_test','unused','member','',0)",
  ).run();
  db.close();
  const config = {
    url: "http://" + "a".repeat(56) + ".onion",
    storeId: "Store123456789",
    apiKey: "fixture-only-private-import",
    assets: ["BTC", "XMR"],
  };
  const run = (input) =>
    spawnSync(
      process.execPath,
      ["scripts/admin.mjs", "connect", "seller_test", "-"],
      {
        env: { ...process.env, DATA_DIR: dir },
        input,
        encoding: "utf8",
      },
    );
  try {
    const result = run(JSON.stringify(config));
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(config.apiKey));
    assert.ok(!result.stderr.includes(config.apiKey));
    const file = path.join(dir, "btcpay.json");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), [
      { ...config, sellerId: "seller" },
    ]);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o077, 0);
    assert.equal(readdirSync(dir).some((name) => name.startsWith(".btcpay-")), false);
    const previous = readFileSync(file, "utf8");
    assert.notEqual(
      run(JSON.stringify({ ...config, assets: ["ETH"] })).status,
      0,
    );
    assert.equal(readFileSync(file, "utf8"), previous);
    const target = path.join(dir, "preserved-target.json");
    writeFileSync(target, previous);
    rmSync(file);
    try {
      symlinkSync(target, file, "file");
      const linked = run(JSON.stringify(config));
      assert.equal(linked.status, 0, linked.stderr);
      assert.equal(readFileSync(target, "utf8"), previous);
      assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), [
        { ...config, sellerId: "seller" },
      ]);
    } catch (error) {
      if (process.platform !== "win32" || error.code !== "EPERM") throw error;
      writeFileSync(file, previous);
    }
    const malformed = run(config.apiKey);
    assert.notEqual(malformed.status, 0);
    assert.ok(!malformed.stdout.includes(config.apiKey));
    assert.ok(!malformed.stderr.includes(config.apiKey));
    assert.equal(readFileSync(file, "utf8"), previous);
  } finally {
    assert.equal(path.dirname(dir), tmpdir());
    rmSync(dir, { recursive: true, force: true });
  }
});
