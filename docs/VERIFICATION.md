# Verification record

Market is a source reference with no hosted demo or continuing service. These checks use fictional users and products. They are engineering validation, not independent user research or production certification.

## October 8, 2026: bounded v1 check

The v1 candidate installs with the frozen lockfile on Node 24.19.0 and pnpm 11.25.0, passes all 16 tests and builds the production frontend. Available dependency patches were applied, including Sharp 0.35.5 and source-map-js 1.2.2; the dependency audit reported zero advisories at this check. Tests now use temporary system directories, including when the source is extracted outside the development workspace. Market is licensed under MIT.

The production application and Tor images built and ran with a read-only app root, an internal app network and no published app port. An isolated test override exposed the Tor SOCKS port to a local verification browser; the shipped Compose file publishes neither HTTP nor SOCKS ports. Three separate browser sessions registered buyer, seller and administrator accounts through the actual onion entry point. The operator imported a store-scoped seller connection through standard input inside the read-only container.

The disposable provider used BTCPay Server 2.4.4, Monero plugin 1.3.5, Bitcoin Core 31.1 in regtest, NBXplorer 2.6.10, PostgreSQL 18.4 and Monero 0.18.4.3 in offline fakechain. Each asset completed both digital and physical orders with actual transfers. Invoice amounts were 0.001 BTC, 0.0011 BTC, 0.1 XMR and 0.11 XMR. The XMR provider amounts including fees were 0.1018 and 0.1118 XMR. Six Bitcoin blocks and twelve Monero blocks confirmed the respective transfers. The Bitcoin digital order first remained locked after actual underpayment; per-transaction fees changed the remaining due. Additional test coins completed it with an overpayment. Only provider settlement enabled fulfillment; the application did not force payment status.

The buyer downloaded each exact uploaded digital file through both HTTP and the browser. Unpaid downloads remained denied, sellers could not download a buyer's purchase, and an unrelated administrator could not read private orders. Physical shipment, buyer receipt and review passed; physical delivery was fictional. Repeated order requests reused the same order and repeated refreshes did not create additional invoices. Independent SQLite inspection found four fulfilled purchase flows plus one pending outage-test order, with initial stock equal to remaining stock plus reserved quantities for every listing.

Stopping the actual BTCPay service made the pending order refresh return 503, without changing its state, reserved stock or download restriction. Restarting the service refreshed the original invoice successfully. The application and its Tor instance were then stopped together; all three volumes were archived with Linux tar and restored into fresh volumes under a separate Compose project on the same Docker Desktop host. The original instance remained stopped. Restored ownership matched the image users, SQLite integrity passed, the onion hostname and buyer sessions persisted, private messages and shipping/tracking fields decrypted, and the exact digital download and access restrictions survived restoration.

The isolated chains used no public-network funds; Bitcoin connected only within the owned private Docker network and Monero reported fakechain with no peers. Mainnet settlement, cross-host disaster recovery, actual physical delivery, a multiple-seller payment deployment, independent human usability research and an independent security audit are outside this v1 check. CI verifies source delivery and builds images; chain transfers remain a separate controlled integration exercise. The dated checks below are preserved as historical evidence rather than silently replaced.

## October 2, 2026: local application follow-up

A fresh checkout installed with the frozen lockfile on Node 24.19.0 and pnpm 11.19.0. The original 13 tests passed. Three added regressions brought the suite to 16 passing tests; the production frontend build also passed. The new tests use real Express handlers, temporary SQLite databases and generated uploads. They cover unpublished image access and cache policy, separate buyer and seller histories beyond the old 200-order limit, and moderation beyond the old 300-listing and 200-report limits, including last-page adjustment after reports close.

An isolated Edge browser exercised the rebuilt application on loopback, with off-origin requests blocked. Registration, administrator promotion, a digital product upload, image upload, pending listing inspection, approval and public listing viewing passed. Before the fix, both the owner and moderator received a missing image for a pending listing; afterward the actual image loaded for each, while unrelated visitors remained denied in the API checks.

For history and queue checks, a private fixture contained one older purchase, 217 newer sales, more than 300 listings and 201 open reports. The purchase remained visible, all 217 sales were reachable across ten pages without duplicates, and switching tabs reset the page. A deliberately delayed sales response did not replace the purchases view. Listing and report pagination, approval of an older pending submission, and closing the last page of reports also passed. These records were seeded for interface checks; their order statuses do not represent invoices, transfers or provider settlement.

Listing, order and administration screens were checked at 1440, 390 and 320 pixel widths. The document had no horizontal overflow; wide tables retained their contained horizontal scrolling. The final browser checks recorded no page runtime errors or off-origin requests. This follow-up did not start Tor, configure a seller payment connection or repeat blockchain settlement. Those historical results are recorded separately below.

## October 2, 2026: native Bitcoin and Tor follow-up

The application at commit `8d5840d` was then exercised with a fresh native Windows payment stack. This run used Bitcoin Core 31.1 in regtest, BTCPay Server 2.4.4 and NBXplorer 2.6.10 built from their tagged source with the .NET 10.0.401 SDK, PostgreSQL 18.4 and Tor 0.4.9.13. It used no Docker containers or public-network funds. Core's observed peers were all loopback connections. Application and provider processes listened on loopback, with separate fresh onion identities for browser access and seller payment requests. This does not reproduce the production Compose network isolation.

A new provider account, store, test wallet and store-scoped invoice creation/viewing key were configured. Actual Edge browser checks through Tor covered account registration, a digital file and image upload, unpublished image visibility for its owner and moderator, guest denial, listing approval and buyer checkout. The BTCPay invoice page also loaded through the provider onion.

Two real regtest wallet transfers paid a 0.001 BTC digital order and a 0.0021 BTC physical order, including its 0.0001 BTC shipping charge. Six blocks were mined after each transfer. BTCPay reported both invoices as `Settled`, with one payment each; Market fulfilled the digital order and marked the physical order paid. The seller recorded shipment in the browser, and the mobile buyer confirmed receipt and posted a review. Physical delivery was fictional.

The unpaid download returned 403, an unrelated administrator could not read the order, and the seller could not download the buyer's purchase. After settlement, the buyer received the exact uploaded file with `Cache-Control: no-store`, including through the browser. Three concurrent requests with one request key created one additional order. Database inspection confirmed that the five-item listing had exactly two ordered items and three remaining in stock.

Stopping the actual BTCPay process made an unpaid order's refresh return 503 while preserving its status, stock reservation and download restriction. After restart, the original invoice refreshed successfully. The marketplace and its Tor process were then stopped, their application data and onion state archived, and the archive extracted into a fresh directory on the same Windows host. The original instance remained stopped. The restored database passed `PRAGMA integrity_check`, the onion hostname matched, and the restored service accepted existing buyer sessions. Private messages, delivery details and tracking decrypted correctly, reviews remained visible, and the protected download matched the original file through the restored onion.

Restored order pages had no horizontal overflow at 320, 390 and 1440 pixel widths. The final fulfillment and restoration browser checks recorded no page runtime errors. The fulfillment check recorded four Chromium warnings about the ignored Cross-Origin-Opener-Policy header on the HTTP onion origin and no other console errors. No application code change was needed for this run.

The Monero 0.18.4.3 archive matched the official published SHA256, but Windows refused to launch its wallet RPC executable with a virus or potentially unwanted software error. Security exclusions were not changed. Fresh XMR settlement was therefore **not completed in this Windows run**. The separate Linux follow-up below subsequently completed it; the September results remain historical. This native run also did not repeat Linux volume ownership restoration or recovery on another host.

The disposable processes were stopped and their listeners checked absent. Synthetic chain wallets, provider and marketplace databases, credentials, sessions, onion identities and backup archive were removed. No continuing marketplace service was left running.

## October 2, 2026: disposable Linux Monero follow-up

A separate [GitHub Actions run](https://github.com/agammann/Market/actions/runs/37071985621) passed against application commit [`8d22844`](https://github.com/agammann/Market/commit/8d22844f8c5f41caea40b5f857220db742109ef3). The [verification harness at `1e416d8`](https://github.com/agammann/Market/tree/1e416d83dd4ebfe595645b220a8fac609c77d194/.qa/xmr) remains on a separate branch; it is not part of the normal installation or default CI workflow. No application code change was needed for this run.

The disposable Ubuntu 24.04 runner used Node 24.19.0, Chrome 154.0.8037.57 and Playwright 1.63.0. Its payment stack used BTCPay Server 2.4.4, official Monero plugin 1.3.5, Monero daemon and wallet RPC 0.18.4.3, PostgreSQL 18.4 and Tor 0.4.9.13, with Bitcoin Core 31.1 and NBXplorer 2.6.10 supporting the provider. Publisher image digests and the plugin checksum were pinned in the linked harness. The native Node application and Linux containers bound their required listeners to loopback. This arrangement does not reproduce production Compose network isolation.

All nine checks passed. Three fictional accounts registered in the browser through Tor. Real fakechain wallet transfers paid the provider's exact amounts for both a digital order and a physical order:

| Order | Market total | Provider payable amount | Observed result |
| :--- | :--- | :--- | :--- |
| Digital | 0.1 XMR | 0.1018 XMR | One payment; BTCPay `Settled`; Market fulfilled. |
| Physical, including shipping | 0.11 XMR | 0.1118 XMR | One payment; BTCPay `Settled`; Market paid, then fulfilled after receipt. |

The provider payable amounts included its fee. Twelve confirmation blocks were generated after each transfer. Before settlement, the digital download returned 403 and unrelated administrator order access returned 404. After settlement, the seller's download remained denied while the buyer received the exact uploaded bytes with `Cache-Control: no-store`, through both the API and browser. The seller recorded physical shipment, and a buyer at 390-pixel width confirmed receipt and posted a review without horizontal overflow. Physical delivery was fictional.

The run recorded zero browser runtime errors. Monero remained on an isolated fakechain with zero peers, and cleanup confirmed the owned processes, listeners, containers, volumes and generated runtime data were removed. Only the allowlisted report and tool pins were uploaded; wallets, credentials, onion identities and browser sessions were excluded. Earlier registration and missing-listener failures were not diagnosed conclusively; this successful run does not establish their causes. Mainnet payments, production Compose isolation, provider outage recovery and backup restoration were not exercised in this follow-up. The separate Bitcoin and September evidence retains its original scope.

## September 19, 2026: disposable payment and Tor integration

This earlier run used actual isolated test coins and temporary infrastructure. Its versions, results and cleanup apply to that date.

### Environment and procedure

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

### Observed workflows

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

### Backup restoration

The app and its Tor process were stopped together. All three volumes were archived with Linux `tar`; archive listings and SHA256 hashes were recorded privately. Archives were extracted, preserving ownership, into fresh volumes under a separate Compose project on the same Docker host. The original Tor process remained stopped throughout.

The restored database passed `PRAGMA integrity_check`. The onion hostname matched, the application health check passed, and its restored onion entry point returned HTTP 200 through Tor. Existing sessions and fulfilled orders remained usable; the restored key decrypted private messages, shipping details and tracking. The protected digital file matched its original contents. Recovery on another physical host or after total host loss was not exercised.

### Fixes demonstrated by the run

1. The documented `docker compose cp` seller import failed against the production container's read only root filesystem. The operator CLI now accepts JSON from standard input with `-`; the revised PowerShell import was verified inside that container. Malformed JSON errors omit input contents so credentials cannot appear in parser diagnostics. A regression test covers successful import, rejected asset changes, unchanged existing configuration after failure and secret suppression.
2. Listing and order screens incorrectly assumed the provider used mainnet. They now direct the buyer to confirm the network on the seller's invoice. This guidance was verified in the rebuilt browser interface; Market does not independently certify a provider's chain configuration.

### Automated checks

All 13 tests passed after the fixes, and the production frontend and Docker images built successfully. Integration tests use real Express endpoints, SQLite, authentication, uploads, moderation, exact totals, stock, messages, refund recording, reviews and persistence. Private field tests exercise authenticated encryption, context binding, tampering, key persistence, legacy migration and authorized decryption. ETH and USDT are rejected.

Provider fixtures separately cover identity and amount mismatches, interrupted invoice creation, read retries, manual status marking, partial payments, expiry and configuration changes. These failure scenarios were not all repeated against actual chains. The normal `Checks` workflow runs installation, tests and the frontend build; it does not run the disposable payment stack or deploy a service. The separate October verification workflow above runs its temporary stack only on the verification branch.

### Cleanup and remaining limits

The temporary marketplace, restored marketplace and payment stack were removed, including their containers, dedicated networks, volumes, onion identities, wallet data, local credential files and backup archives. No operator onion address, key, session cookie or customer data is included in the repository. Development screenshots contain only fictional test content or the earlier empty catalog.

Mainnet settlement, independent human usability testing, a multiple seller live payment deployment, long running reliability, production scale, cross host disaster recovery and an independent security audit remain unverified. Real partial or late payments, full expiry monitoring and refund transfers were not exercised on the test chains. The application still requires JavaScript and lacks automatic retention deletion, escrow and automatic refund transfers. Functional success does not guarantee anonymity or make every seller installation ready for customer funds.
