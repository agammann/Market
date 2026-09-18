import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, statSync } from "node:fs";
import { unlink, rename } from "node:fs/promises";
import path from "node:path";
import { openDatabase, transaction } from "./db.mjs";
import {
  token,
  digest,
  fail,
  text,
  integer,
  passwordHash,
  passwordMatches,
  limiter,
} from "./security.mjs";
import { assets, amount, displayAmount } from "./money.mjs";
import { createPayments, loadConnections } from "./payments.mjs";
import { privateFields } from "./privacy.mjs";

export const categories = [
  "Art & collectibles",
  "Books & zines",
  "Clothing & accessories",
  "Electronics",
  "Home & living",
  "Software & templates",
  "Other",
];
const DAY = 86400000;
const publicUser = (u) =>
  u ? { id: u.id, username: u.username, role: u.role, bio: u.bio } : null;
export function createApp({
  dataDir = path.resolve("data"),
  origins = ["http://127.0.0.1:3100", "http://localhost:3100"],
  distDir = path.resolve("dist"),
  secureCookies = false,
  limits = true,
  payments = createPayments({
    connections: loadConnections(
      process.env.BTCPAY_CONFIG || path.join(dataDir, "btcpay.json"),
    ),
  }),
} = {}) {
  const db = openDatabase(dataDir);
  const privateData = privateFields(dataDir, db);
  const app = express();
  const filesDir = path.join(dataDir, "files");
  const tmpDir = path.join(dataDir, "tmp");
  mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const audit = (actor, action, target) =>
    run(
      "INSERT INTO audit VALUES(?,?,?,?,?)",
      randomUUID(),
      actor,
      action,
      target,
      Date.now(),
    );
  const requireUser = (req, res, next) => {
    if (!req.user)
      return res.status(401).json({ error: "Sign in to continue." });
    next();
  };
  const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "admin")
      return res.status(403).json({ error: "Administrator access required." });
    next();
  };
  const sessionCookie = {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookies,
    path: "/",
    maxAge: 7 * DAY,
  };
  const paymentLocks = new Map();
  async function syncPayment(orderId) {
    if (paymentLocks.has(orderId)) return paymentLocks.get(orderId);
    const work = (async () => {
      let o = q("SELECT * FROM orders WHERE id=?", orderId);
      if (
        !o ||
        ![
          "awaiting_invoice",
          "awaiting_payment",
          "confirming",
          "payment_review",
        ].includes(o.status)
      )
        return null;
      run(
        "UPDATE orders SET payment_checked_at=? WHERE id=?",
        Date.now(),
        o.id,
      );
      if (!o.payment_id) {
        const attempted = Boolean(o.invoice_attempted);
        const invoice = await payments.create(o, {
          recoverOnly: attempted,
          onAttempt: () =>
            run("UPDATE orders SET invoice_attempted=1 WHERE id=?", o.id),
        });
        if (!invoice) return null;
        run(
          "UPDATE orders SET payment_id=?,payment_connection=? WHERE id=?",
          invoice.id,
          invoice.connection,
          o.id,
        );
        o = q("SELECT * FROM orders WHERE id=?", o.id);
      }
      const detail = await payments.read(o);
      transaction(db, () => {
        run(
          "UPDATE orders SET status=?,payment_address=?,updated_at=? WHERE id=?",
          detail.status,
          detail.destination,
          Date.now(),
          o.id,
        );
        if (detail.status === "expired")
          run(
            "UPDATE listings SET stock=stock+? WHERE id=?",
            o.quantity,
            o.listing_id,
          );
      });
      if (detail.status !== o.status)
        audit("btcpay", "invoice_" + detail.status, o.id);
      return detail;
    })();
    paymentLocks.set(orderId, work);
    try {
      return await work;
    } finally {
      paymentLocks.delete(orderId);
    }
  }
  let polling = false;
  async function pollPayments() {
    if (polling) return;
    polling = true;
    try {
      for (const o of all(
        "SELECT id FROM orders WHERE status IN ('awaiting_invoice','awaiting_payment','confirming','payment_review') ORDER BY payment_checked_at ASC LIMIT 10",
      ))
        await syncPayment(o.id).catch(() => {});
    } finally {
      polling = false;
    }
  }
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "blob:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      hsts: false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use((req, res, next) => {
    const hosts = origins.map((origin) => new URL(origin).host);
    if (!hosts.includes(req.headers.host))
      return res.status(400).json({ error: "Unrecognized host." });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !origins.includes(req.headers.origin)
    )
      return res.status(403).json({ error: "Request origin is not allowed." });
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const raw = req.cookies.market_session;
    if (typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw)) {
      req.session = q(
        "SELECT * FROM sessions WHERE token=? AND expires>?",
        digest(raw),
        Date.now(),
      );
      if (req.session)
        req.user = q("SELECT * FROM users WHERE id=?", req.session.user_id);
    }
    if (
      req.session &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("X-CSRF-Token") !== req.session.csrf
    )
      return res
        .status(403)
        .json({ error: "Session verification failed. Reload and try again." });
    run("DELETE FROM sessions WHERE expires<?", Date.now());
    next();
  });
  if (limits) app.use("/api", limiter(300, 60000));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/session", (req, res) =>
    res.json({
      user: publicUser(req.user),
      csrf: req.session?.csrf || null,
      categories,
      assets: Object.keys(assets),
      paymentMode: "btcpay",
    }),
  );
  const authLimit = limits
    ? limiter(
        20,
        15 * 60000,
        (req) =>
          (req.ip || "") +
          ":" +
          String(req.body.username || "")
            .toLowerCase()
            .slice(0, 32),
      )
    : (req, res, next) => next();
  const authGlobal = limits
    ? limiter(80, 15 * 60000, () => "global")
    : (req, res, next) => next();
  const newSession = (user, res, req) => {
    if (req.session)
      run("DELETE FROM sessions WHERE token=?", req.session.token);
    const raw = token();
    const csrf = token();
    run(
      "INSERT INTO sessions VALUES(?,?,?,?)",
      digest(raw),
      user.id,
      csrf,
      Date.now() + 7 * DAY,
    );
    res
      .cookie("market_session", raw, sessionCookie)
      .json({ user: publicUser(user), csrf });
  };
  app.post("/api/register", authGlobal, authLimit, async (req, res) => {
    const username = text(req.body.username, "Username", 3, 32);
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      fail(400, "Usernames use letters, numbers and underscores.");
    if (q("SELECT id FROM users WHERE username=?", username))
      fail(409, "That username is unavailable.");
    const password = await passwordHash(req.body.password);
    const id = randomUUID();
    try {
      run(
        "INSERT INTO users(id,username,password,created_at) VALUES(?,?,?,?)",
        id,
        username,
        password,
        Date.now(),
      );
    } catch (error) {
      if (String(error.code).includes("CONSTRAINT"))
        fail(409, "That username is unavailable.");
      throw error;
    }
    newSession(q("SELECT * FROM users WHERE id=?", id), res, req);
  });
  app.post("/api/login", authGlobal, authLimit, async (req, res) => {
    const username = text(req.body.username, "Username", 3, 32);
    const user = q("SELECT * FROM users WHERE username=?", username);
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    if (
      !(await passwordMatches(req.body.password, user?.password || dummy)) ||
      !user
    )
      fail(401, "Username or password is incorrect.");
    newSession(user, res, req);
  });
  app.post("/api/logout", requireUser, (req, res) => {
    run("DELETE FROM sessions WHERE token=?", req.session.token);
    res
      .clearCookie("market_session", { ...sessionCookie, maxAge: undefined })
      .json({ ok: true });
  });
  app.get("/api/account", requireUser, (req, res) =>
    res.json({
      user: publicUser(req.user),
      payment: payments.info(req.user.id),
    }),
  );
  app.patch("/api/account", requireUser, async (req, res) => {
    const bio = text(req.body.bio ?? "", "Profile", 0, 1500);
    run("UPDATE users SET bio=? WHERE id=?", bio, req.user.id);
    res.json({ ok: true });
  });
  app.post(
    "/api/account/password",
    requireUser,
    authLimit,
    async (req, res) => {
      if (!(await passwordMatches(req.body.currentPassword, req.user.password)))
        fail(403, "Current password is incorrect.");
      const password = await passwordHash(req.body.password);
      transaction(db, () => {
        run("UPDATE users SET password=? WHERE id=?", password, req.user.id);
        run("DELETE FROM sessions WHERE user_id=?", req.user.id);
      });
      newSession({ ...req.user, password }, res, req);
    },
  );
  const upload = multer({
    dest: tmpDir,
    limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  });
  app.post(
    "/api/uploads/:kind",
    requireUser,
    limits ? limiter(15, 3600000) : (req, res, next) => next(),
    (req, res, next) => {
      if (!["image", "digital"].includes(req.params.kind))
        return res.status(400).json({ error: "Unknown upload type." });
      const usage = q(
        "SELECT COALESCE(SUM(size),0) AS total,COUNT(*) AS count FROM uploads WHERE owner_id=?",
        req.user.id,
      );
      if (usage.total > 450 * 1024 * 1024 || usage.count >= 100)
        return res
          .status(409)
          .json({ error: "Upload quota reached. Contact the operator." });
      next();
    },
    upload.single("file"),
    async (req, res) => {
      if (!req.file) fail(400, "Choose a file.");
      const id = randomUUID();
      const dest = path.join(filesDir, id);
      const kind = req.params.kind;
      try {
        if (kind === "image") {
          if (req.file.size > 8 * 1024 * 1024)
            fail(400, "Images must be smaller than 8 MB.");
          const meta = await sharp(req.file.path, {
            limitInputPixels: 20000000,
          }).metadata();
          if (!["jpeg", "png", "webp"].includes(meta.format))
            fail(400, "Use a JPEG, PNG or WebP image.");
          await sharp(req.file.path, { limitInputPixels: 20000000 })
            .rotate()
            .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(dest);
          await unlink(req.file.path);
        } else await rename(req.file.path, dest);
        const filename =
          kind === "image"
            ? "product.webp"
            : req.file.originalname
                .replace(/[^a-zA-Z0-9._ -]/g, "_")
                .slice(0, 120) || "download.bin";
        run(
          "INSERT INTO uploads VALUES(?,?,?,?,?,?)",
          id,
          req.user.id,
          kind,
          filename,
          statSync(dest).size,
          Date.now(),
        );
        res.status(201).json({ id, filename });
      } catch (error) {
        await unlink(req.file.path).catch(() => {});
        await unlink(dest).catch(() => {});
        throw error;
      }
    },
  );
  app.get("/media/:id", (req, res) => {
    const upload = q(
      "SELECT u.* FROM uploads u JOIN listings l ON l.image_id=u.id WHERE u.id=? AND u.kind='image' AND l.status='active'",
      req.params.id,
    );
    if (!upload) fail(404, "Image not found.");
    res
      .type("webp")
      .set("Cache-Control", "private,max-age=300")
      .sendFile(path.resolve(filesDir, upload.id));
  });
  const serializeListing = (l) => ({
    ...l,
    price: displayAmount(l.price, l.currency),
    shipping: displayAmount(l.shipping, l.currency),
    file_id: undefined,
  });
  const listingColumns = "l.*,u.username AS seller";
  app.get("/api/listings", (req, res) => {
    const search = String(req.query.q || "").slice(0, 100);
    const category = String(req.query.category || "");
    const kind = String(req.query.kind || "");
    const currency = String(req.query.currency || "");
    const order =
      req.query.sort === "oldest" ? "l.created_at ASC" : "l.created_at DESC";
    const page = Math.max(
      0,
      Math.min(10000, Number.parseInt(req.query.page) || 0),
    );
    const args = [
      `%${search}%`,
      `%${search}%`,
      category,
      category,
      kind,
      kind,
      currency,
      currency,
    ];
    const where =
      "l.status='active' AND (l.title LIKE ? OR u.username LIKE ?) AND (?='' OR l.category=?) AND (?='' OR l.kind=?) AND (?='' OR l.currency=?)";
    const total = q(
      `SELECT COUNT(*) AS count FROM listings l JOIN users u ON u.id=l.seller_id WHERE ${where}`,
      ...args,
    ).count;
    res.json({
      items: all(
        `SELECT ${listingColumns} FROM listings l JOIN users u ON u.id=l.seller_id WHERE ${where} ORDER BY ${order} LIMIT 24 OFFSET ?`,
        ...args,
        page * 24,
      ).map(serializeListing),
      total,
      page,
    });
  });
  app.get("/api/listings/:id", (req, res) => {
    const l = q(
      `SELECT ${listingColumns} FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.id=?`,
      req.params.id,
    );
    if (
      !l ||
      (l.status !== "active" &&
        l.seller_id !== req.user?.id &&
        req.user?.role !== "admin")
    )
      fail(404, "Listing not found.");
    res.json(serializeListing(l));
  });
  app.get("/api/sellers/:id", (req, res) => {
    const seller = q(
      "SELECT id,username,bio,created_at FROM users WHERE id=?",
      req.params.id,
    );
    if (!seller) fail(404, "Seller not found.");
    res.json({
      seller,
      reviews: all(
        "SELECT r.rating,r.body,r.created_at,u.username FROM reviews r JOIN users u ON u.id=r.buyer_id WHERE r.seller_id=? ORDER BY r.created_at DESC LIMIT 50",
        seller.id,
      ),
      listings: all(
        `SELECT ${listingColumns} FROM listings l JOIN users u ON u.id=l.seller_id WHERE l.seller_id=? AND l.status='active' LIMIT 100`,
        seller.id,
      ).map(serializeListing),
    });
  });
  app.get("/api/seller/listings", requireUser, (req, res) =>
    res.json(
      all(
        "SELECT * FROM listings WHERE seller_id=? ORDER BY created_at DESC LIMIT 200",
        req.user.id,
      ).map(serializeListing),
    ),
  );
  const listingInput = (body, user) => {
    const title = text(body.title, "Title", 3, 120);
    const description = text(body.description, "Description", 10, 10000);
    if (!["physical", "digital"].includes(body.kind))
      fail(400, "Choose a product type.");
    if (!categories.includes(body.category)) fail(400, "Choose a category.");
    const price = amount(body.price, body.currency);
    const shipping =
      body.kind === "physical"
        ? amount(body.shipping || "0", body.currency, true)
        : "0";

    const stock = integer(body.stock, "Inventory", 0, 100000);
    const shipsTo =
      body.kind === "physical"
        ? text(body.ships_to, "Shipping regions", 2, 300)
        : "";
    for (const [key, kind] of [
      ["image_id", "image"],
      ["file_id", "digital"],
    ]) {
      if (
        body[key] &&
        !q(
          "SELECT id FROM uploads WHERE id=? AND owner_id=? AND kind=?",
          body[key],
          user.id,
          kind,
        )
      )
        fail(400, "File does not belong to your account.");
    }
    if (body.kind === "digital" && !body.file_id)
      fail(400, "Upload a digital product file.");
    return [
      title,
      description,
      body.kind,
      body.category,
      price,
      body.currency,
      stock,
      shipping,
      shipsTo,
      body.image_id || null,
      body.kind === "digital" ? body.file_id : null,
    ];
  };
  app.post("/api/listings", requireUser, (req, res) => {
    if (
      q("SELECT COUNT(*) AS n FROM listings WHERE seller_id=?", req.user.id)
        .n >= 200
    )
      fail(409, "Listing limit reached.");
    const fields = listingInput(req.body, req.user);
    const id = randomUUID();
    run(
      "INSERT INTO listings(id,seller_id,title,description,kind,category,price,currency,stock,shipping,ships_to,image_id,file_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      req.user.id,
      ...fields,
      Date.now(),
      Date.now(),
    );
    res.status(201).json({ id });
  });
  app.patch("/api/listings/:id", requireUser, (req, res) => {
    const l = q(
      "SELECT * FROM listings WHERE id=? AND seller_id=?",
      req.params.id,
      req.user.id,
    );
    if (!l) fail(404, "Listing not found.");
    if (req.body.action === "pause") {
      run(
        "UPDATE listings SET status='paused',updated_at=? WHERE id=?",
        Date.now(),
        l.id,
      );
      res.json({ ok: true });
      return;
    }
    // Editing inventory with active reservations would produce ambiguous stock totals.
    if (
      q(
        "SELECT id FROM orders WHERE listing_id=? AND status IN ('awaiting_invoice','awaiting_payment','confirming','payment_review')",
        l.id,
      )
    )
      fail(409, "Resolve pending orders before editing this listing.");
    const fields = listingInput(
      {
        ...serializeListing(l),
        ...req.body,
        file_id: req.body.file_id || l.file_id,
      },
      req.user,
    );
    run(
      "UPDATE listings SET title=?,description=?,kind=?,category=?,price=?,currency=?,stock=?,shipping=?,ships_to=?,image_id=?,file_id=?,status='pending',updated_at=? WHERE id=?",
      ...fields,
      Date.now(),
      l.id,
    );
    res.json({ ok: true });
  });
  app.post("/api/listings/:id/report", requireUser, (req, res) => {
    if (
      !q(
        "SELECT id FROM listings WHERE id=? AND status='active'",
        req.params.id,
      )
    )
      fail(404, "Listing not found.");
    const reason = text(req.body.reason, "Report", 10, 2000);
    if (
      q(
        "SELECT id FROM reports WHERE listing_id=? AND reporter_id=? AND status='open'",
        req.params.id,
        req.user.id,
      )
    )
      fail(409, "You already have an open report for this listing.");
    run(
      "INSERT INTO reports(id,listing_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)",
      randomUUID(),
      req.params.id,
      req.user.id,
      reason,
      Date.now(),
    );
    res.status(201).json({ ok: true });
  });
  const orderFor = (id, user) => {
    const o = q(
      "SELECT o.*,u.username AS seller,b.username AS buyer FROM orders o JOIN users u ON u.id=o.seller_id JOIN users b ON b.id=o.buyer_id WHERE o.id=?",
      id,
    );
    if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id))
      fail(404, "Order not found.");
    return o;
  };
  const serializeOrder = (o) => ({
    ...o,
    address: privateData.open(o.address, o.id + ":address"),
    tracking: privateData.open(o.tracking, o.id + ":tracking"),
    total: displayAmount(o.total, o.currency),
    unit_price: displayAmount(o.unit_price, o.currency),
    shipping: displayAmount(o.shipping, o.currency),
    file_id: undefined,
  });
  app.post("/api/orders", requireUser, async (req, res) => {
    const requestKey = text(req.body.request_key, "Request key", 16, 80);
    const previous = q(
      "SELECT * FROM orders WHERE buyer_id=? AND request_key=?",
      req.user.id,
      requestKey,
    );
    if (previous) {
      res.json({ id: previous.id });
      return;
    }
    const id = transaction(db, () => {
      const l = q(
        "SELECT * FROM listings WHERE id=? AND status='active'",
        req.body.listing_id,
      );
      if (!l) fail(404, "Listing is unavailable.");
      if (l.seller_id === req.user.id)
        fail(400, "You cannot order your own listing.");
      const qty = integer(
        req.body.quantity,
        "Quantity",
        1,
        l.kind === "digital" ? 1 : 100,
      );
      if (l.stock < qty) fail(409, "Not enough inventory is available.");
      if (
        q(
          "SELECT COUNT(*) AS n FROM orders WHERE buyer_id=? AND status IN ('awaiting_invoice','awaiting_payment','confirming','payment_review')",
          req.user.id,
        ).n >= 10
      )
        fail(409, "Resolve your pending orders before placing another.");
      const address =
        l.kind === "physical"
          ? text(req.body.address, "Delivery address", 10, 2000)
          : "";
      if (!payments.available(l.seller_id, l.currency))
        fail(
          409,
          "The seller has not connected BTCPay for this asset. Orders are unavailable until payment setup is complete.",
        );
      const total = (
        BigInt(l.price) * BigInt(qty) +
        BigInt(l.shipping)
      ).toString();
      const id = randomUUID();
      run(
        "INSERT INTO orders(id,buyer_id,seller_id,listing_id,title,kind,file_id,quantity,unit_price,shipping,total,currency,address,payment_address,created_at,updated_at,request_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id,
        req.user.id,
        l.seller_id,
        l.id,
        l.title,
        l.kind,
        l.file_id,
        qty,
        l.price,
        l.shipping,
        total,
        l.currency,
        privateData.seal(address, id + ":address"),
        "",
        Date.now(),
        Date.now(),
        requestKey,
      );
      run("UPDATE orders SET status='awaiting_invoice' WHERE id=?", id);
      run("UPDATE listings SET stock=stock-? WHERE id=?", qty, l.id);
      return id;
    });
    await syncPayment(id).catch(() => {});
    res.status(201).json({ id });
  });
  app.get("/api/orders", requireUser, (req, res) =>
    res.json(
      all(
        "SELECT o.*,u.username AS seller,b.username AS buyer FROM orders o JOIN users u ON u.id=o.seller_id JOIN users b ON b.id=o.buyer_id WHERE buyer_id=? OR seller_id=? ORDER BY created_at DESC LIMIT 200",
        req.user.id,
        req.user.id,
      ).map(serializeOrder),
    ),
  );
  app.post("/api/orders/:id/refresh", requireUser, async (req, res) => {
    const o = orderFor(req.params.id, req.user);
    try {
      const payment = await syncPayment(o.id);
      res.json({ payment });
    } catch {
      fail(
        503,
        "BTCPay could not be reached. Payment status has not been changed.",
      );
    }
  });
  app.get("/api/orders/:id", requireUser, (req, res) => {
    const o = orderFor(req.params.id, req.user);
    res.json({
      order: serializeOrder(o),
      payment:
        o.payment_id && payments.checkout(o)
          ? { checkoutUrl: payments.checkout(o) }
          : null,
      messages: all(
        "SELECT m.*,u.username FROM messages m JOIN users u ON u.id=m.sender_id WHERE order_id=? ORDER BY created_at ASC LIMIT 500",
        o.id,
      ).map((m) => ({
        ...m,
        body: privateData.open(m.body, o.id + ":message"),
      })),
      review:
        q("SELECT rating,body FROM reviews WHERE order_id=?", o.id) || null,
    });
  });
  app.post("/api/orders/:id/action", requireUser, async (req, res) => {
    const before = orderFor(req.params.id, req.user);

    transaction(db, () => {
      const o = orderFor(before.id, req.user);
      const buyer = o.buyer_id === req.user.id;
      const seller = o.seller_id === req.user.id;
      const action = req.body.action;
      let status;
      if (
        action === "ship" &&
        seller &&
        o.status === "paid" &&
        o.kind === "physical"
      ) {
        run(
          "UPDATE orders SET tracking=? WHERE id=?",
          privateData.seal(
            text(
              req.body.tracking,
              "Carrier and tracking or delivery note",
              3,
              300,
            ),
            o.id + ":tracking",
          ),
          o.id,
        );
        status = "shipped";
      } else if (action === "complete" && buyer && o.status === "shipped")
        status = "fulfilled";
      else if (
        action === "record_refund" &&
        seller &&
        ["paid", "shipped", "fulfilled"].includes(o.status)
      ) {
        const reference = text(
          req.body.reference,
          "Refund transaction reference",
          16,
          200,
        );
        status = "refunded";
        run(
          "INSERT INTO messages VALUES(?,?,?,?,?)",
          randomUUID(),
          o.id,
          req.user.id,
          privateData.seal(
            "Seller recorded a refund. Transaction reference: " + reference,
            o.id + ":message",
          ),
          Date.now(),
        );
      } else fail(409, "That action is not available for this order.");
      run(
        "UPDATE orders SET status=?,updated_at=? WHERE id=?",
        status,
        Date.now(),
        o.id,
      );
      audit(req.user.id, action, o.id);
    });
    res.json({ ok: true });
  });
  app.post("/api/orders/:id/messages", requireUser, (req, res) => {
    const o = orderFor(req.params.id, req.user);
    const body = text(req.body.body, "Message", 1, 4000);
    if (q("SELECT COUNT(*) AS n FROM messages WHERE order_id=?", o.id).n >= 500)
      fail(409, "Conversation limit reached.");
    run(
      "INSERT INTO messages VALUES(?,?,?,?,?)",
      randomUUID(),
      o.id,
      req.user.id,
      privateData.seal(body, o.id + ":message"),
      Date.now(),
    );
    res.status(201).json({ ok: true });
  });
  app.get("/api/orders/:id/download", requireUser, (req, res) => {
    const o = orderFor(req.params.id, req.user);
    if (
      o.buyer_id !== req.user.id ||
      o.kind !== "digital" ||
      o.status !== "fulfilled"
    )
      fail(
        403,
        "Download becomes available after the seller confirms payment.",
      );
    const file = q(
      "SELECT * FROM uploads WHERE id=? AND kind='digital'",
      o.file_id,
    );
    if (!file) fail(404, "File is unavailable. Contact the seller.");
    res
      .type("application/octet-stream")
      .download(path.resolve(filesDir, file.id), file.filename);
  });
  app.post("/api/orders/:id/review", requireUser, (req, res) => {
    const o = orderFor(req.params.id, req.user);
    if (o.buyer_id !== req.user.id || o.status !== "fulfilled")
      fail(403, "Only buyers with fulfilled orders can leave feedback.");
    if (q("SELECT order_id FROM reviews WHERE order_id=?", o.id))
      fail(409, "You already reviewed this order.");
    run(
      "INSERT INTO reviews VALUES(?,?,?,?,?,?)",
      o.id,
      req.user.id,
      o.seller_id,
      integer(req.body.rating, "Rating", 1, 5),
      text(req.body.body, "Review", 5, 2000),
      Date.now(),
    );
    res.status(201).json({ ok: true });
  });
  app.get("/api/admin", requireUser, requireAdmin, (req, res) =>
    res.json({
      listings: all(
        `SELECT ${listingColumns} FROM listings l JOIN users u ON u.id=l.seller_id ORDER BY l.created_at DESC LIMIT 300`,
      ).map(serializeListing),
      reports: all(
        "SELECT r.*,l.title FROM reports r JOIN listings l ON l.id=r.listing_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 200",
      ),
    }),
  );
  app.post("/api/admin/listings/:id", requireUser, requireAdmin, (req, res) => {
    if (!["active", "rejected", "paused"].includes(req.body.status))
      fail(400, "Invalid moderation action.");
    if (!q("SELECT id FROM listings WHERE id=?", req.params.id))
      fail(404, "Listing not found.");
    run(
      "UPDATE listings SET status=?,updated_at=? WHERE id=?",
      req.body.status,
      Date.now(),
      req.params.id,
    );
    audit(req.user.id, "listing_" + req.body.status, req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/admin/reports/:id", requireUser, requireAdmin, (req, res) => {
    run("UPDATE reports SET status='closed' WHERE id=?", req.params.id);
    audit(req.user.id, "report_closed", req.params.id);
    res.json({ ok: true });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use(express.static(distDir, { index: false }));
  app.get("/{*path}", (req, res) =>
    res.sendFile(path.join(distDir, "index.html")),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.status || (error instanceof multer.MulterError ? 400 : 500);
    if (status === 500)
      console.error("Request failed:", error.code || error.name);
    res.status(status).json({
      error:
        status === 500
          ? "The request could not be completed. Please try again."
          : error.message,
    });
  });
  return { app, db, pollPayments, syncPayment, close: () => db.close() };
}
