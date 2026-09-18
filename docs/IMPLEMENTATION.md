# Implementation and development procedure

This map connects behavior to source. It describes the reference implementation, not an independently audited production service. Start with [setup](SETUP.md), then use [operations](OPERATIONS.md) for day to day workflows.

## Source map

| Area | Files | Responsibility |
| :--- | :--- | :--- |
| Frontend | `src/main.jsx`, `shop.jsx`, `seller.jsx`, `orders.jsx` | Routes, catalog, accounts, listings, moderation and order interfaces |
| API | `server/app.mjs` | Request validation, authentication, ownership checks, moderation, stock and fulfillment |
| Startup | `server/index.mjs` | Host and origin configuration, payment polling and process shutdown |
| Persistence | `server/db.mjs` | SQLite schema, WAL mode and transactions |
| Payment adapter | `server/payments.mjs`, `money.mjs` | Seller connections, Tor transport, invoice validation and integer amounts |
| Private fields | `server/privacy.mjs` | AES 256 GCM sealing, context binding, key handling and legacy migration |
| Request security | `server/security.mjs` | Authentication helpers, validation and request limits |
| Operator commands | `scripts/admin.mjs`, `health.mjs` | Explicit account promotion, private payment import and internal health check |
| Deployment | `Dockerfile`, `compose.yaml`, `deploy/` | Reproducible application build and optional Tor service |
| Evidence | `tests/`, `docs/VERIFICATION.md`, `design/` | Automated checks, verification boundaries and visual development artifacts |

## Request and data flow

The React UI calls same origin API routes. Sessions identify a pseudonymous account; server checks enforce role and ownership for each action. Public media routes only expose images attached to active listings. Product files stay outside public static assets and pass through authenticated order download checks.

Listing creation and edits go to moderation. Order creation snapshots the product and amount while reserving stock in a database transaction. Monetary calculations use integer atomic units rather than floating point arithmetic. The payment adapter sends an order UUID, currency, amount and checkout options to the configured seller instance through a proxy with remote DNS resolution. It excludes product names, delivery data and private conversations.

The app persists that invoice creation was attempted before sending its POST. A lost response triggers lookup by order reference; the app does not blindly create a duplicate invoice. Subsequent reads validate store, invoice, order reference, asset and exact amount. Provider settlement unlocks the relevant fulfillment path. [Payment documentation](PAYMENTS.md) explains the external trust boundary and incomplete integration verification.

## Privacy design decisions

The supplied deployment uses Tor as its only inbound route, no public host port, a private app network and no third party frontend assets. It requests no email address and removes photo metadata by reencoding images. It avoids application access logs, but operational output still exists and can contain a service hostname.

Passwords use salted scrypt hashes, sessions use random tokens stored as hashes, and write requests require origin and CSRF checks. Shipping, tracking and message fields are encrypted with per value nonces and authenticated field context. Keys remain accessible to the running server. This is protection against a database copy without the key, not end to end encryption or anonymity against a compromised host. See the complete [privacy boundaries](PRIVACY.md).

## Procedure used to build and verify this reference

1. Scope the product around individual seller orders, physical goods, digital downloads and BTC/XMR. Record interface research and visual decisions in [design notes](../design/SPEC.md).
2. Implement persistent backend workflows and ownership checks, then connect UI actions to those endpoints. Avoid default live accounts and fabricated inventory.
3. Test complete workflows against real Express handlers and temporary SQLite databases. Use explicit provider fixtures for network outcomes, and label them as fixtures.
4. Check encrypted field handling, malformed payment data, interrupted invoice creation, partial payment and expiry paths. Keep provider uncertainty visible instead of granting fulfillment by assumption.
5. Build the frontend and Docker images. Use a temporary development instance to inspect Tor connectivity and responsive rendering. Preserve screenshots as previews without publishing an operator address.
6. Remove the temporary instance, data volumes and onion identity when converting the project to a source reference. Review source, reachable Git history and artifacts for deployment addresses and sensitive runtime files before publication.

The [verification record](VERIFICATION.md) identifies what was actually checked. Live BTC/XMR settlement, restoration drills and independent security review are separate work and are not claimed complete.

## Reproduce the software checks

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The GitHub Actions workflow runs these same checks on pushes to `main` and pull requests. It never launches a hosted instance. Read test names and assertions in `tests/` to distinguish application behavior from simulated payment provider responses. No test success implies a connected live wallet.

For a change, preserve existing tests that exercise meaningful behavior, add coverage for changed failure or permission boundaries, run the checks, review the diff and update the relevant guide. Keep runtime data, addresses, API keys, backups and logs outside Git. Ignore rules are a guard against accidental addition, not a substitute for inspecting staged files and history.
