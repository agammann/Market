# Verification record

Checked September 17, 2026, Pacific time. This repository is a reference implementation and setup guide, with no hosted demo or running service.

## Automated checks

All 12 tests passed using `pnpm test`. Integration tests exercise real Express endpoints, SQLite, authentication, uploads, moderation, orders, stock reservation, exact amounts, messages, refund recording, reviews and persistence. Unrelated accounts cannot access orders; unpaid orders cannot download products. ETH and USDT are rejected.

Payment transport fixtures cover invoice payloads, identity and amount matching, interrupted creation recovery, read failure retries, settlement, manual marking, partial payments, expiry and changed configuration. They are not proof of a working external BTCPay installation.

Private field tests cover authenticated encryption, randomized ciphertext, incorrect contexts, tampering, key persistence, legacy migration, missing key failure, encrypted database contents and authorized response decryption.

The production frontend and Docker images built successfully. The production dependency advisory check reported no known vulnerabilities at the time of verification. GitHub Actions checks dependency installation, tests and frontend build; it does not deploy the application.

## Development previews

A temporary test instance was used to check Tor connectivity and responsive behavior. Desktop 1536 by 1024 and mobile 390 by 844 passed checks for branding, privacy copy, catalog filtering/reset, invalid sign in feedback and authenticated route redirection. There were no browser page errors or horizontal overflow. Screenshots in `design/` show the empty development catalog without real customer or payment data.

That temporary deployment has been removed, including its application and Tor containers, data volumes, onion identity and networks. Screenshots are illustrative artifacts, not links to a hosted demo. No operator onion address is part of the setup instructions or source.

## Remaining boundaries

Real BTC/XMR settlement and seller BTCPay connections need separate integration checks before real orders. No cryptocurrency transfer was performed. No cloud infrastructure is provisioned. There is no independent security audit, volume load test, no JavaScript interface, automatic retention deletion, escrow or automatic refund transfer. See the setup and payment guides for running an instance of your own.
