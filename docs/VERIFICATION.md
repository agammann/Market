# Verification record

Checked September 19, 2026, Pacific time. Market is a source reference with no hosted demo or continuing service. This record describes an engineering validation using fictional users and products, actual isolated test coins and temporary infrastructure. It is not independent user research or a production certification.

## Environment and procedure

A fresh clone of the public repository installed with the frozen lockfile, passed its original tests and built successfully. The production Compose configuration then ran with a real Tor onion entry point and no app or SOCKS ports published to the host. Fixes found during the exercise were rebuilt and the affected workflows checked again.

The separate disposable payment stack used these versions:

| Component | Version or image |
| :--- | :--- |
| BTCPay Server | `btcpayserver/btcpayserver:2.4.4` |
| Monero plugin | Official `BTCPayServer.Plugins.Monero` 1.3.5 |
| Bitcoin | `btcpayserver/bitcoin:31.1-1`, regtest |
| NBXplorer | `nicolasdorier/nbxplorer:2.6.10` |
| Monero daemon and wallet RPC | `btcpayserver/monero:0.18.4.3`, isolated fakechain |
| PostgreSQL | `postgres:18.4` |
| Browser | Chromium 153, Playwright 1.62.1, SOCKS connection through Tor |

The official plugin package was installed through BTCPay's built in plugin upload interface. Its SHA256 was `d83074f45a05e595ef41b981ebab367f4e70d3406ed7fb724102a315bdb4a736`. The test store key allowed only invoice creation and viewing for that store. Market reached the provider's onion endpoint through Tor. The provider administration interface was temporarily bound to loopback only.

Buyer test wallets were funded by mining isolated blocks. A Bitcoin invoice was paid using an actual regtest wallet transfer and six further blocks were mined. A Monero invoice was paid using an actual wallet RPC transfer; twelve further blocks, wallet refresh and the plugin's block notification completed settlement. Provider responses in these two flows came from running BTCPay software, not payment fixtures. No mainnet funds or personal BTCPay instance were used.

Use [setup](SETUP.md) and the [controlled payment procedure](PAYMENTS.md#controlled-integration-procedure) for your installation. The temporary chain harness and its wallet data are not bundled with Market; `pnpm test` does not reproduce blockchain transfers.

## Observed workflows

| Check | Result and scope |
| :--- | :--- |
| Accounts and moderation | Browser registration, seller digital upload and listing submission, administrator approval and buyer order creation passed through Tor. |
| Bitcoin digital purchase | Real provider settlement changed the order to fulfilled. The buyer downloaded the exact uploaded text file, including through the browser. |
| Access control | Unpaid download returned 403; the seller could not download the buyer's purchase; an unrelated administrator account received 404 for private order access. Downloads used `Cache-Control: no-store`. |
| Monero physical purchase | A 0.11 XMR order had a provider payable amount of 0.1118 XMR including its fee. Actual fakechain payment settled. The seller marked shipment in the browser; the mobile buyer confirmed receipt and posted a review. Physical delivery itself was fictional. |
| Concurrent retries | Three simultaneous requests with the same request key returned one order and reserved stock once. |
| Provider outage and recovery | Stopping BTCPay made refresh return 503, preserved order state and reserved stock, and kept the unpaid download blocked. After restarting BTCPay, the original invoice refreshed successfully. |
| Responsive interface | Desktop 1440 by 1000 and mobile 390 by 844 passed fulfillment and download checks with no horizontal overflow on the mobile order page. |
| Browser diagnostics | Zero page runtime errors and zero unexpected console errors in the final fulfillment check. Chromium emitted four warnings that it ignored the Cross-Origin-Opener-Policy header on the HTTP onion origin; no protection was removed to suppress them. |
| Small API concurrency check | 100 catalog reads, concurrency 10, all HTTP 200; 235 ms total, 32 ms p95, 38 ms maximum on this host. This used the internal Docker network and does not measure Tor capacity or production scale. |

## Backup restoration

The app and its Tor process were stopped together. All three volumes were archived with Linux `tar`; archive listings and SHA256 hashes were recorded privately. Archives were extracted, preserving ownership, into fresh volumes under a separate Compose project on the same Docker host. The original Tor process remained stopped throughout.

The restored database passed `PRAGMA integrity_check`. The onion hostname matched, the application health check passed, and its restored onion entry point returned HTTP 200 through Tor. Existing sessions and fulfilled orders remained usable; the restored key decrypted private messages, shipping details and tracking. The protected digital file matched its original contents. Recovery on another physical host or after total host loss was not exercised.

## Fixes demonstrated by the run

1. The documented `docker compose cp` seller import failed against the production container's read only root filesystem. The operator CLI now accepts JSON from standard input with `-`; the revised PowerShell import was verified inside that container. Malformed JSON errors omit input contents so credentials cannot appear in parser diagnostics. A regression test covers successful import, rejected asset changes, unchanged existing configuration after failure and secret suppression.
2. Listing and order screens incorrectly assumed the provider used mainnet. They now direct the buyer to confirm the network on the seller's invoice. This guidance was verified in the rebuilt browser interface; Market does not independently certify a provider's chain configuration.

## Automated checks

All 13 tests passed after the fixes, and the production frontend and Docker images built successfully. Integration tests use real Express endpoints, SQLite, authentication, uploads, moderation, exact totals, stock, messages, refund recording, reviews and persistence. Private field tests exercise authenticated encryption, context binding, tampering, key persistence, legacy migration and authorized decryption. ETH and USDT are rejected.

Provider fixtures separately cover identity and amount mismatches, interrupted invoice creation, read retries, manual status marking, partial payments, expiry and configuration changes. These failure scenarios were not all repeated against actual chains. GitHub Actions runs installation, tests and the frontend build; it does not run the disposable payment stack or deploy a service.

## Cleanup and remaining limits

The temporary marketplace, restored marketplace and payment stack were removed, including their containers, dedicated networks, volumes, onion identities, wallet data, local credential files and backup archives. No operator onion address, key, session cookie or customer data is included in the repository. Development screenshots contain only fictional test content or the earlier empty catalog.

Mainnet settlement, independent human usability testing, a multiple seller live payment deployment, long running reliability, production scale, cross host disaster recovery and an independent security audit remain unverified. Real partial or late payments, full expiry monitoring and refund transfers were not exercised on the test chains. The application still requires JavaScript and lacks automatic retention deletion, escrow and automatic refund transfers. Functional success does not guarantee anonymity or make every seller installation ready for customer funds.
