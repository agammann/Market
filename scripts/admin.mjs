import path from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { openDatabase } from "../server/db.mjs";
import { validateConnections } from "../server/payments.mjs";
const [command, username, configPath] = process.argv.slice(2);
const dataDir = path.resolve(process.env.DATA_DIR || "data");
const db = openDatabase(dataDir);
try {
  if (!["promote", "connect"].includes(command) || !username)
    throw Error(
      "Usage: node scripts/admin.mjs promote USERNAME | connect USERNAME PRIVATE_JSON_FILE",
    );
  const user = db
    .prepare("SELECT id FROM users WHERE username=?")
    .get(username);
  if (!user) throw Error("Register the account through the marketplace first.");
  if (command === "promote") {
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
    console.log("Administrator role assigned. Reload your browser.");
  } else {
    if (!configPath)
      throw Error(
        "Provide a private JSON file containing url, storeId, apiKey and assets.",
      );
    const entry = {
      ...JSON.parse(readFileSync(configPath, "utf8")),
      sellerId: user.id,
    };
    const file = path.join(dataDir, "btcpay.json");
    const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    const existing = old.find((c) => c.sellerId === user.id);
    if (
      existing &&
      (existing.url !== entry.url || existing.storeId !== entry.storeId) &&
      db
        .prepare(
          "SELECT id FROM orders WHERE seller_id=? AND status NOT IN ('cancelled','expired','refunded')",
        )
        .get(user.id)
    )
      throw Error(
        "Cannot change an instance with existing orders. Preserve its URL and store ID; API keys may be rotated.",
      );
    const next = validateConnections([
      ...old.filter((c) => c.sellerId !== user.id),
      entry,
    ]);
    writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    console.log(
      "Connection saved. Restart the application to apply it. Credentials were not printed.",
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
