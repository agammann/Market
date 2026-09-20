# Operating procedures

These procedures describe an instance a reader chooses to run. This repository has no running service. Run Compose commands from the directory containing its `compose.yaml`.

## Buyer, seller and administrator workflow

Buyers browse approved listings, register a pseudonymous account, choose a quantity and create an order. Physical purchases require delivery details; digital purchases do not. Stock is reserved during order creation. Each order belongs to one listing and seller, with no shared cart or platform balance.

Open **Orders** to see purchases or sales. The order page provides **Open BTCPay invoice**, **Check payment status** and a private conversation. Pay only through the matching invoice in the supported asset. Sending a message, supplying a transaction identifier or a seller claiming receipt does not unlock fulfillment.

For a settled digital order, the buyer receives an authenticated download. For a settled physical order, the seller chooses **Mark shipped** and supplies tracking or a delivery note. The buyer chooses **Confirm delivery received** after arrival. A fulfilled purchase can receive a buyer review.

Administrators approve, reject or pause listings and handle reports in **Admin**. Closing a report does not itself pause a listing. Admin status does not give the HTTP account access to other users' private order details. The host operator can nevertheless access database files, credentials and decryption keys; this is a separate trust boundary.

## Order state reference

| Stored state | Meaning | Next action |
| :--- | :--- | :--- |
| `awaiting_invoice` | Stock reserved; invoice not yet attached | Wait or check status. Investigate ambiguous creation before any further payment. |
| `awaiting_payment` | Invoice awaits payment | Buyer follows the exact invoice amount, network and expiry. |
| `confirming` | Provider reports processing | Wait for provider settlement; do not ship early. |
| `payment_review` | Expiry, invalidity, manual marking or an unresolved provider condition | Buyer and seller investigate privately. Inventory stays reserved. |
| `paid` | Settled physical order | Seller ships and records delivery information. |
| `shipped` | Seller recorded shipment | Buyer confirms receipt after delivery. |
| `fulfilled` | Settled digital order or buyer confirmed physical delivery | Digital buyer may download; buyer may review. |
| `expired` | Provider expiry, monitoring ended and explicit zero payment evidence | Stock released by the application. |
| `refunded` | Seller recorded an externally completed refund | Digital downloads disabled; record is not independent proof of transfer. |

Invoice creation requests a 60 minute payment window and 1,440 minute monitoring window. Use the actual provider response for deadlines. Automatic polling handles up to ten pending orders per minute; outages and queues can delay visibility. A payment window ending alone does not justify releasing stock.

## Payment incident procedure

1. Preserve the order UUID and observed state in private operator notes. Do not post shipping details, configuration, logs or wallet credentials publicly.
2. Check the seller's BTCPay instance, matching store, invoice and order metadata. Check node and wallet synchronization, API permissions and Tor connectivity.
3. Use **Check payment status** after restoring connectivity. The application checks invoice identity and amount before accepting a provider state.
4. If creation timed out after submission, search BTCPay by the order UUID. The application also attempts this recovery. Do not create a second invoice or manually modify stock just because the first response was lost.
5. If there are multiple matching invoices, a changed store, partial payment or an unresolved late payment, keep the order under review. There is no general administrative force settlement or stock release workflow. Some cases require a reviewed code level remediation; this reference does not claim a complete incident resolution console.

For refunds, the seller and buyer arrange and verify the transfer outside Market. Only then should the seller use **Record a completed refund** and enter the reference. Market records that statement; it neither sends money nor verifies the transfer. Refund recording is available for paid, shipped or fulfilled orders. It does not automatically replenish stock.

## Routine checks and updates

Inspect `docker compose ps` and privately review bounded logs. Monitor host disk space and Docker volume growth. There is no automatic retention policy or purge job, and application resource limits do not cap persistent storage. Restrict host and Docker access and maintain encrypted backups.

Before upgrading, record `git rev-parse HEAD` and the installed image IDs with `docker compose images`, review upstream changes and create a consistent backup. Stop the running services before backing up. With services stopped, a routine update is:

```powershell
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
```

Verify the onion entry point, login, approved catalog and existing order readability. Do not run multiple app processes against the same SQLite database. Rebuilding preserves named volumes; `down --volumes` does not. A code rollback may require restoration of the matching preupgrade database and key because startup can migrate data. This repository has no automated migration rollback system.

## Backup and restore

Back up all three named volumes as one stopped snapshot:

| Default volume | Container path | Contents |
| :--- | :--- | :--- |
| `onion-market_market-data` | `/app/data` | `market.sqlite`, SQLite sidecar files, `private-fields.key`, uploaded `files/` and `btcpay.json` when configured |
| `onion-market_tor-state` | `/var/lib/tor` | Tor state and private onion identity in `market/` |
| `onion-market_onion-public` | `/onion` | Public hostname shared with the app |

The following **Bash example for a Linux Docker host** archives stopped volumes while preserving Unix ownership and permissions. The same tar archive and extraction procedure was exercised with Linux helper containers on Docker Desktop, restoring into fresh volumes in a separate Compose project on the same host. See the [verification record](VERIFICATION.md); recovery on a different host remains untested. On Windows, use a Linux shell with working Docker access or equivalent volume snapshot tooling; do not paste Bash loops into PowerShell. Replace the example path with an existing private location on encrypted storage. These archives contain secrets and are not themselves encrypted by `tar`.

```bash
backup_dir=/absolute/private/backup-directory
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
docker compose stop
docker compose ps -a
for volume in onion-market_market-data onion-market_tor-state onion-market_onion-public; do
  docker volume inspect "$volume" >/dev/null || exit 1
  docker run --rm --network none \
    --mount "type=volume,src=$volume,dst=/source,readonly" \
    --mount "type=bind,src=$backup_dir,dst=/backup" \
    debian:bookworm-slim tar -czf "/backup/$volume.tgz" -C /source . || exit 1
done
```

Confirm both services are stopped before the loop. Use a fresh backup directory for every snapshot to avoid overwriting your only recovery copy. Check that each archive can be listed with `tar -tzf`, record hashes and protect the entire snapshot outside Git. Restart with `docker compose start` only if continued hosting is intended. Database encryption does not protect an archive that includes its key.

To restore, keep the original host stopped so that two Tor processes never use the same identity. Use a separate Docker host with no existing volumes of these names, the recorded source revision and compatible images. Copy the private archives there, verify their hashes, and create and populate empty volumes before starting any service:

```bash
backup_dir=/absolute/private/backup-directory
for volume in onion-market_market-data onion-market_tor-state onion-market_onion-public; do
  test -f "$backup_dir/$volume.tgz" || exit 1
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "Target volume already exists; stop and investigate."
    exit 1
  fi
  docker volume create "$volume" >/dev/null || exit 1
  docker run --rm --network none \
    --mount "type=volume,src=$volume,dst=/restore" \
    --mount "type=bind,src=$backup_dir,dst=/backup,readonly" \
    debian:bookworm-slim tar -xzpf "/backup/$volume.tgz" -C /restore || exit 1
done
```

This rejects existing volumes rather than overwriting live data. If it stops partway, investigate the partial restore before retrying. Verify restored ownership against the app and Tor image users. Inspect the restored SQLite database with `PRAGMA integrity_check` using a compatible SQLite tool while it remains offline. Only start services once you intend to resume hosting. Confirm the hostname matches the private backup record, the app is healthy, existing private fields decrypt and owned digital files download. A full recovery exercise should use disposable data first; merely creating archives is not proof of recoverability. Record the result privately.

SQLite WAL mode can require writable space for shared memory and journal sidecars even during a read check. Run the integrity check against the stopped restored copy with appropriate filesystem access. Compose may warn that manually restored volumes were not created by Compose. Confirm the exact volume names before starting; a differently named empty volume is not your restored data.

Losing `private-fields.key` makes encrypted fields unreadable. Losing the Tor identity changes the service address. Restoring an old application database does not roll back payments already recorded externally in BTCPay; reconcile intervening invoices before reopening sales.

## Troubleshooting

| Symptom | Check and action |
| :--- | :--- |
| Docker cannot connect | Start the Linux engine and check `docker version`. This is not a marketplace login problem. |
| Missing onion hostname or restart loop | Inspect Tor logs and its volume permissions; the app waits up to 120 seconds for a valid hostname. Do not disable the production hostname requirement. |
| Healthy app but onion page unavailable | Check Tor bootstrap, host connectivity and the exact generated hostname in a Tor capable browser. Local health is not an external connectivity test. |
| Unrecognized host or origin | Use the generated address in Docker, or the documented loopback origin locally. Do not add a wildcard allowlist. |
| Seller not connected | Register first, import the private JSON, restart app and check configured assets in Account. |
| Order remains pending | Follow payment incident steps above; inspect BTCPay and proxy health. Do not treat provider downtime as settlement. |
| Private field key missing | Stop and restore the correct key from backup. Generating a new key cannot recover old data. |
| Listing not public | Check moderation status. Edits return it to pending review. |
| Download denied | Check buyer ownership, digital order fulfillment and whether a refund was recorded. |

For full removal, follow [shutdown instructions](SETUP.md#6-stop-or-remove-an-instance). They deliberately distinguish retaining data from deleting volumes and identity.
