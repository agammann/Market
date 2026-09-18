import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "market.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
      bio TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      csrf TEXT NOT NULL, expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL,
      category TEXT NOT NULL, price TEXT NOT NULL, currency TEXT NOT NULL,
      stock INTEGER NOT NULL, shipping TEXT NOT NULL DEFAULT '0',
      ships_to TEXT NOT NULL DEFAULT '', image_id TEXT REFERENCES uploads(id),
      file_id TEXT REFERENCES uploads(id), status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS listings_status ON listings(status,created_at);
    CREATE INDEX IF NOT EXISTS listings_seller ON listings(seller_id);
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL REFERENCES users(id),
      seller_id TEXT NOT NULL REFERENCES users(id), listing_id TEXT NOT NULL REFERENCES listings(id),
      title TEXT NOT NULL, kind TEXT NOT NULL, file_id TEXT REFERENCES uploads(id),
      quantity INTEGER NOT NULL, unit_price TEXT NOT NULL, shipping TEXT NOT NULL,
      total TEXT NOT NULL, currency TEXT NOT NULL, address TEXT NOT NULL,
      payment_address TEXT NOT NULL, payment_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'awaiting_payment', tracking TEXT NOT NULL DEFAULT '',
      payment_id TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      payment_connection TEXT NOT NULL DEFAULT '', invoice_attempted INTEGER NOT NULL DEFAULT 0, payment_checked_at INTEGER NOT NULL DEFAULT 0,
      request_key TEXT NOT NULL, UNIQUE(buyer_id,request_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS orders_buyer ON orders(buyer_id,created_at);
    CREATE INDEX IF NOT EXISTS orders_seller ON orders(seller_id,created_at);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
      sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS messages_order ON messages(order_id,created_at);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id),
      reporter_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      target TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT NOT NULL REFERENCES users(id), currency TEXT NOT NULL,
      address TEXT NOT NULL, PRIMARY KEY(user_id,currency)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reviews (
      order_id TEXT PRIMARY KEY REFERENCES orders(id), buyer_id TEXT NOT NULL REFERENCES users(id),
      seller_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL,
      body TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
  `);
  return db;
}

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
