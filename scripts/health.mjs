import http from "node:http";
import { readFileSync } from "node:fs";
const host = readFileSync(
  process.env.ONION_HOST_FILE || "/onion/hostname",
  "utf8",
).trim();
http
  .get(
    "http://127.0.0.1:3100/api/health",
    { headers: { Host: host } },
    (res) => {
      res.resume();
      process.exitCode = res.statusCode === 200 ? 0 : 1;
    },
  )
  .on("error", () => {
    process.exitCode = 1;
  });
