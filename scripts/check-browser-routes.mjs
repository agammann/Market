import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../server/app.mjs";

const toolsDir = process.env.MARKET_PLAYWRIGHT_DIR;
if (!toolsDir) throw new Error("MARKET_PLAYWRIGHT_DIR is required");
const require = createRequire(path.join(toolsDir, "package.json"));
const { chromium } = require("playwright");
const dataDir = await mkdtemp(path.join(tmpdir(), "market-route-smoke-"));
const port = 18321;
const base = `http://127.0.0.1:${port}`;
let instance, server, browser;
try {
  instance = createApp({ dataDir, origins: [base] });
  server = await new Promise((resolve, reject) => {
    const candidate = instance.app.listen(port, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Marketplace", exact: true }).waitFor();
  await page.getByRole("heading", { name: "No listings yet", exact: true }).waitFor();
  await page.getByRole("link", { name: "Privacy and payments", exact: true }).click();
  await page.waitForURL("**/privacy");
  await page.getByRole("heading", { name: "Privacy and payments", exact: true }).waitFor();

  // Direct navigation and refresh exercise the server SPA fallback, not only client routing.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Privacy and payments", exact: true }).waitFor();
  await page.goto(base + "/sell/new", { waitUntil: "networkidle" });
  await page.waitForURL("**/login");
  await page.getByRole("heading", { name: "Welcome back", exact: true }).waitFor();
  await page.goto(base + "/not-a-market-route", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Page not found", exact: true }).waitFor();
  await page.getByRole("link", { name: "Browse the marketplace", exact: true }).click();
  await page.waitForURL(base + "/");
  await page.getByRole("heading", { name: "Marketplace", exact: true }).waitFor();
  if (errors.length) throw new Error("Browser errors: " + errors.join("; "));
  console.log("Browser route smoke passed with isolated synthetic data");
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (instance) instance.close();
  await rm(dataDir, { recursive: true, force: true });
}
