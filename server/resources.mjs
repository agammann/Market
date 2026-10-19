import { rateLimit, MemoryStore } from "express-rate-limit";

const defaults = {
  requestMax: 1200,
  requestWindowMs: 60000,
  inflightMax: 64,
  fileMax: 16,
  fileIdleMs: 120000,
  fileTotalMs: 30 * 60000,
};

function capacity(max, { idleMs = 0, totalMs = 0 } = {}) {
  let active = 0;
  const socketUsers = new WeakMap();
  return (req, res, next) => {
    if (active >= max)
      return res.set("Retry-After", "1").status(429).json({
        error: "The service is busy. Please try again shortly.",
      });
    active++;
    let released = false;
    const expire = () => res.destroy();
    const timer = totalMs ? setTimeout(expire, totalMs) : null;
    timer?.unref();
    let socket;
    const attach = (assigned) => {
      socket = assigned;
      const state = socketUsers.get(socket) || {
        count: 0,
        previousTimeout: socket.timeout || 0,
      };
      state.count++;
      socketUsers.set(socket, state);
      res.setTimeout(idleMs, expire);
    };
    if (idleMs) {
      if (res.socket) attach(res.socket);
      else res.once("socket", attach);
    }
    const release = () => {
      if (released) return;
      released = true;
      active--;
      clearTimeout(timer);
      res.off("finish", release);
      res.off("close", release);
      if (idleMs) {
        res.off("socket", attach);
        res.off("timeout", expire);
        const state = socket && socketUsers.get(socket);
        if (state) {
          state.count--;
          if (!socket.destroyed)
            socket.setTimeout(state.count ? idleMs : state.previousTimeout);
          if (!state.count) socketUsers.delete(socket);
        }
      }
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

export function resourceGuards(options = {}) {
  const config = { ...defaults, ...options };
  for (const [name, value] of Object.entries(config))
    if (
      !(name in defaults) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > 2147483647
    )
      throw Error("Resource limits must be positive bounded integers.");
  const store = new MemoryStore();
  return {
    requests: rateLimit({
      windowMs: config.requestWindowMs,
      limit: config.requestMax,
      // The Tor service is the shared network peer. This is a server budget,
      // independent of client addresses and untrusted forwarding headers.
      keyGenerator: () => "service",
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again later." },
      store,
    }),
    inflight: capacity(config.inflightMax),
    files: capacity(config.fileMax, {
      idleMs: config.fileIdleMs,
      totalMs: config.fileTotalMs,
    }),
    close: () => store.shutdown(),
  };
}

export function localHealthRequest(req) {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    req.path === "/api/health" &&
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
  );
}
