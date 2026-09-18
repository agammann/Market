import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

// Protects a database-only copy. The running host can still read this key and data.
export function privateFields(directory, db) {
  const file = path.join(directory, "private-fields.key");
  if (!existsSync(file)) {
    const encrypted = db
      .prepare(
        "SELECT id FROM orders WHERE address LIKE 'enc1:%' OR tracking LIKE 'enc1:%' UNION ALL SELECT id FROM messages WHERE body LIKE 'enc1:%' LIMIT 1",
      )
      .get();
    if (encrypted)
      throw Error(
        "Private field key is missing. Restore it from the protected backup.",
      );
    writeFileSync(file, randomBytes(32), { flag: "wx", mode: 0o600 });
  }
  const key = readFileSync(file);
  if (key.length !== 32) throw Error("Private field key is invalid.");
  const seal = (value, context) => {
    if (!value) return "";
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return (
      "enc1:" +
      Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64")
    );
  };
  const open = (value, context) => {
    if (!value) return "";
    if (!value.startsWith("enc1:"))
      throw Error("Private field is not encrypted.");
    const data = Buffer.from(value.slice(5), "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of db
      .prepare(
        "SELECT id,address,tracking FROM orders WHERE (address<>'' AND address NOT LIKE 'enc1:%') OR (tracking<>'' AND tracking NOT LIKE 'enc1:%')",
      )
      .all()) {
      for (const field of ["address", "tracking"]) {
        if (row[field] && !row[field].startsWith("enc1:"))
          db.prepare(`UPDATE orders SET ${field}=? WHERE id=?`).run(
            seal(row[field], row.id + ":" + field),
            row.id,
          );
      }
    }
    for (const row of db
      .prepare(
        "SELECT id,order_id,body FROM messages WHERE body NOT LIKE 'enc1:%'",
      )
      .all())
      db.prepare("UPDATE messages SET body=? WHERE id=?").run(
        seal(row.body, row.order_id + ":message"),
        row.id,
      );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { seal, open };
}
