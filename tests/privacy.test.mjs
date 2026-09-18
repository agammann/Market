import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../server/db.mjs";
import { privateFields } from "../server/privacy.mjs";

test("Private field encryption authenticates data and binds ciphertext to its order and field", () => {
  const root = path.resolve("../../work/privacy-tests");
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, "case-"));
  const db = openDatabase(dir);
  try {
    const fields = privateFields(dir, db);
    const encoded = fields.seal("Fictional address", "one:address");
    assert.equal(fields.open(encoded, "one:address"), "Fictional address");
    assert.notEqual(encoded, fields.seal("Fictional address", "one:address"));
    assert.throws(() => fields.open(encoded, "two:address"));
    assert.throws(() => fields.open(encoded, "one:tracking"));
    const tampered = Buffer.from(encoded.slice(5), "base64");
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() =>
      fields.open("enc1:" + tampered.toString("base64"), "one:address"),
    );
    assert.equal(
      privateFields(dir, db).open(encoded, "one:address"),
      "Fictional address",
    );
    db.prepare(
      "INSERT INTO users VALUES('u','fixture','unused','member','',0)",
    ).run();
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare("INSERT INTO messages VALUES('m','o','u',?,0)").run(
      "Legacy fictional message",
    );
    const migrated = privateFields(dir, db);
    const body = db
      .prepare("SELECT body FROM messages WHERE id='m'")
      .get().body;
    assert.equal(migrated.open(body, "o:message"), "Legacy fictional message");
    unlinkSync(path.join(dir, "private-fields.key"));
    assert.throws(() => privateFields(dir, db), /key is missing/);
  } finally {
    db.close();
    if (path.dirname(dir) !== root) throw Error("Test cleanup path mismatch");
    rmSync(dir, { recursive: true, force: true });
  }
});
