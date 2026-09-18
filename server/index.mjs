import { createApp } from "./app.mjs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
const port = Number(process.env.PORT || 3100);
let origins;
if (process.env.ONION_HOST_FILE) {
  let onion;
  for (let i = 0; i < 120; i++) {
    try {
      onion = (await readFile(process.env.ONION_HOST_FILE, "utf8")).trim();
      break;
    } catch {
      await setTimeout(1000);
    }
  }
  if (!/^[a-z2-7]{56}\.onion$/.test(onion || ""))
    throw Error("A valid Tor hostname is required.");
  origins = ["http://" + onion];
} else {
  if (process.env.NODE_ENV === "production")
    throw Error("Production requires ONION_HOST_FILE.");
  origins = (
    process.env.APP_ORIGINS ||
    `http://127.0.0.1:${port},http://localhost:${port},http://127.0.0.1:5173`
  )
    .split(",")
    .map((s) => s.trim());
}
const instance = createApp({
  dataDir: path.resolve(process.env.DATA_DIR || "data"),
  origins,
  secureCookies: process.env.COOKIE_SECURE === "true",
});
const server = instance.app.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(`Marketplace ready at ${origins[0]}`),
);
server.requestTimeout = 120000;
server.headersTimeout = 30000;
const poller = setInterval(() => instance.pollPayments(), 60000);
poller.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(poller);
    server.close(() => {
      instance.close();
      process.exit(0);
    });
  });
