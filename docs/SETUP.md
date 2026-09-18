# Setup walkthrough

Market is a reference application. There is no hosted demo, included operator address, default account, payment service or wallet. The two paths below serve different purposes: local development lets you inspect the software; the optional Docker path starts your own Tor service. Nothing in CI deploys it.

## 1. Obtain and check the source

Install Git and Node.js 24.14 or newer. Use the pinned pnpm version used by the Dockerfile and CI:

```powershell
git clone https://github.com/agammann/Market.git
cd Market
node --version
npm install --global pnpm@11.19.0
pnpm --version
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Expected results: all tests pass and Vite writes `dist/`. Tests use temporary fictional data and payment fixtures, not wallets or a running Tor service. Native dependencies such as Sharp must finish installation successfully. A failed install or test is a reason to investigate before continuing. See [verification evidence](VERIFICATION.md).

## 2. Explore locally without Tor hosting

In one terminal in the cloned directory:

```powershell
pnpm start
```

In a second terminal in the same directory:

```powershell
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/media` to the API on loopback port 3100. Use this exact origin; if Vite chooses another port because 5173 is occupied, stop the conflicting process or deliberately configure the development origins. Do not bind this development server to a public interface.

Register a fictional username and password. To give that account the Admin interface, run from a third terminal in the same directory:

```powershell
node scripts/admin.mjs promote YOUR_USERNAME
```

Reload the page. You can inspect account, seller and moderation flows. Orders require an operator configured BTCPay connection; the UI does not contain a pretend payment or manual settlement switch. Automated tests exercise payment outcomes without sending money.

Press Ctrl+C in both running terminals when finished. Local account data and uploads remain in the ignored `data/` directory. These are separate from Docker volumes. `pnpm test` does not clear your local development database.

## 3. Optional: start your own onion service

This step deliberately starts hosting. It requires Docker Engine with Compose, or Docker Desktop running Linux containers, plus a browser capable of accessing Tor onion services. Node and pnpm on the host are not required for this Docker path because the image builds the application.

From the repository root, check the engine before starting:

```powershell
docker version
docker compose version
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose exec -T tor cat /onion/hostname
```

The final command prints your newly generated address. Open it as an HTTP onion URL in your Tor browser. Keep the address out of public bug reports if it should remain private. On Windows, `Start Marketplace.cmd`, `Show Onion Address.cmd` and `Stop Marketplace.cmd` wrap the common lifecycle commands; inspect their contents before use.

The `app` container should eventually report healthy. The first build and Tor bootstrap can take time. A healthy app proves the local HTTP health endpoint works; it does not independently prove a browser can reach the onion service. Verify both. For diagnosis, inspect privately:

```powershell
docker compose logs --tail 80 app tor
```

The application startup log includes its generated address. Redact that address and any private operational details before sharing logs.

The supplied Compose file publishes no ports to the host. Its app network is internal; the Tor container provides onion ingress and a SOCKS proxy for payment requests. Do not add port mappings, a public reverse proxy, a tunnel or a clearnet domain if you want to preserve this entry point restriction. The Tor host itself still needs outbound connectivity.

Production waits for the public hostname file and accepts that exact Host and origin. Tor's private identity is in a separate volume. The application runs as the container's `node` user with a read only root filesystem and a writable private data volume. The Compose project name is `onion-market`; retain it when managing an existing installation because it determines volume names.

## 4. Bootstrap accounts and a catalog

1. Register an administrator account through the new instance, then run `docker compose exec -T app node scripts/admin.mjs promote YOUR_USERNAME`. Reload to see **Admin**. There is no default administrator or password recovery.
2. Register separate fictional seller and buyer accounts while validating setup. Any registered member can use **Sell**; promotion is only needed for administration.
3. Connect each seller's own BTCPay installation using the [payment guide](PAYMENTS.md). **Account** shows configured assets. This display confirms configuration loaded, not that the external wallet is reachable or synchronized.
4. In **Sell**, create a listing with title, description, category, stock and a BTC or XMR price. Digital listings require an uploaded product file. Physical listings require shipping regions and a flat shipping amount in the same currency. Product uploads have a 50 MiB request limit.
5. In **Admin**, review the listing and select **Approve**, **Reject** or **Pause**. New listings and edits need approval. An empty catalog on a new installation is expected.
6. Validate the buyer flow described in [operations](OPERATIONS.md) and the controlled integration checklist in [payments](PAYMENTS.md) before offering real products. There is no included live payment verification result.

## 5. Configuration reference

These variables are read by the server process. Compose supplies production values in the Dockerfile; exporting a host shell variable alone does not automatically change the container environment. The server does not load `.env` files itself.

| Variable | Local default | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | Unset | `production` requires an onion hostname file. |
| `HOST` | `127.0.0.1` | Listener interface; Docker uses `0.0.0.0` inside its private network. |
| `PORT` | `3100` | API and built frontend listener. Keep Docker's fixed health check and Tor target in sync if modifying it. |
| `DATA_DIR` | `data` relative to working directory | Database, private field key, files and payment configuration; Docker uses `/app/data`. |
| `ONION_HOST_FILE` | Unset | File containing the generated 56 character v3 onion hostname; Docker uses `/onion/hostname`. Overrides development origins. |
| `APP_ORIGINS` | Loopback 3100 and `http://127.0.0.1:5173` | Comma separated development origins, used only without an onion hostname file. |
| `COOKIE_SECURE` | False | Set only for a deliberate HTTPS configuration; supplied HTTP onion deployment leaves it false. |
| `BTCPAY_CONFIG` | `DATA_DIR/btcpay.json` | Private connection array; normally written by the admin import command. |
| `TOR_SOCKS_URL` | `socks5h://127.0.0.1:9050` | Proxy for BTCPay requests; Docker uses `socks5h://tor:9050`. Local development does not launch a proxy. |

## 6. Stop or remove an instance

To stop hosting while retaining the database, files and address:

```powershell
docker compose down
```

To stop hosting and permanently discard the project's data and onion identity:

```powershell
docker compose down --volumes --remove-orphans
```

The second command has no undo without your own backup. A future startup generates a new address. It removes this Compose project's containers, networks and volumes, not arbitrary Docker resources or the source repository. Images can remain cached without hosting a service. Never use a global Docker prune as a project teardown procedure.

For backups, restoration, upgrades and troubleshooting, continue to [operations](OPERATIONS.md). For what Tor and field encryption do and do not protect, read [privacy](PRIVACY.md).
