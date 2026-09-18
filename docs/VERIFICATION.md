# Verification record

Verified September 17, 2026, Pacific time.

## Automated checks

`pnpm test`: all 12 tests passed using the normal test runner. Integration uses real Express endpoints, SQLite, authentication, uploads, moderation, orders, stock reservation, exact amounts, messaging, refund recording, reviews and restart persistence. Strangers and unrelated administrators cannot access orders; unpaid orders cannot download products. ETH and USDT are rejected.

Payment transport fixtures cover payloads, identity and amount matching, lost response recovery, read failure retries, settlement, manual marking, partial payments, expiry and changed configuration. They are not proof of a working external BTCPay installation.

Private field tests cover authenticated encryption, random ciphertext, incorrect contexts, tampering, key persistence, legacy migration, missing key failure, encrypted database contents and authorized response decryption.

`pnpm build` passed for the latest Market branding and privacy page. `pnpm audit --prod` reported no known vulnerabilities. This is a dependency advisory check, not a security audit.

## Live deployment

The final source was rebuilt using `docker compose up --build -d`. The app is healthy. Its deployed frontend asset is `index-DczxX7qn.js`. Private field encryption is active; the generated key has mode 600. No BTCPay configuration is present. Existing service identity and persistent volumes were retained.

Docker publishes no host ports. The app's only attached network is internal. Tor provides the onion entry point. A temporary Chromium QA container loaded the actual onion site through Tor and checked the Market browser title, privacy page, catalog, product filter/reset, invalid sign in response and protected seller route redirection. Desktop 1536 by 1024 and mobile 390 by 844 passed without page errors or horizontal overflow. Observed page requests stayed on the marketplace onion host. No customer or payment data was used.

Updated desktop and mobile screenshots are in `design/`. Both were visually compared with the generated reference. Market casing and the privacy footer link are intentional additions. The temporary browser container was automatically removed when checks completed. No temporary SOCKS proxy remains.

The Windows session initially blocked Docker and some subprocesses. The user subsequently enabled access; the normal tests, build, deployment and onion browser checks above succeeded afterward. The former deployment blocker is resolved.

## Private source publication

The repository destination is `agammann/Market`, with private visibility verified through GitHub. Commits use the GitHub noreply address. The source tree excludes runtime data, wallet configuration, keys and the actual onion hostname. The GitHub Actions workflow checks installation, the 12 tests and frontend build on pushes to main. Remote commit and workflow status must be read back after publication; local results do not stand in for remote CI.

## Remaining boundaries

No live BTCPay account is connected and no cryptocurrency was sent. There is no cloud deployment, independent security audit, volume load test, no JavaScript mode, automatic retention deletion, escrow or automatic refund transfer. Seller payment instances require separate checks before real orders. The user's existing personal BTCPay instance was not used.

The onion service was verified in an isolated test browser. Launching the user's Brave browser was previously blocked by automatic approval policy, so no Brave specific verification is claimed. The actual onion address can be opened manually in a Brave Tor window. The computer must remain awake with Docker running for the service to stay available.
