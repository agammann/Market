# Bitcoin and Monero payments

The marketplace creates exact asset denominated BTCPay invoices. There is no exchange rate service, ETH, USDT, or manual seller payment confirmation. Prices use integer atomic units: 8 decimal places for BTC and 12 for XMR.

## Seller isolation

Use a separate BTCPay Server instance per seller. The [Monero plugin documentation](https://github.com/btcpay-monero/btcpayserver-monero-plugin) states that its Monero wallet is shared across all stores on an instance. Multiple stores therefore do not isolate unrelated sellers' Monero wallets. The application rejects reused onion hosts across sellers; different hostnames alone cannot prove the wallets are isolated.

No BTCPay instance or account is bundled. This repository does not provision BTCPay, blockchain nodes, wallets, or a paid server. Operators configure their own seller connections only when they choose to run an instance.

## Connect an instance

1. Configure BTC and the Monero plugin on the seller's separate instance. Complete wallet and node synchronization and test its checkout independently.
2. Enable its Tor v3 onion endpoint. Avoid third party checkout assets and public redirects. The marketplace accepts a root onion URL with no custom port.
3. Create an API key scoped to that store with invoice creation and viewing permissions. Do not grant spending, server administration, or invoice status modification.
4. Save a private JSON file outside the repository. Replace the placeholders privately, never in chat or a GitHub issue.

```json
{
  "url": "http://YOUR_56_CHARACTER_ONION_HOST.onion",
  "storeId": "YOUR_STORE_ID",
  "apiKey": "YOUR_PRIVATE_API_KEY",
  "assets": ["BTC", "XMR"]
}
```

Register the seller first. Import the private file through standard input and restart. In PowerShell:

```powershell
Get-Content -Raw C:\PRIVATE_PATH\seller.json | docker compose exec -T app node scripts/admin.mjs connect SELLER_USERNAME -
docker compose restart app
```

In Bash, use `docker compose exec -T app node scripts/admin.mjs connect SELLER_USERNAME - < /private/path/seller.json`, then restart the app. The trailing `-` tells the command to read JSON from standard input. Do not use `docker compose cp`: Docker rejects that copy into this container's read only root filesystem even when the destination is `/tmp`.

Imported credentials persist in the data volume's `btcpay.json`; there is no temporary import copy in the container. Protect the host staging file and remove it when appropriate. Account reports connected assets, never keys. API keys can rotate for the same store. Changing the instance with existing orders is blocked to preserve invoice identity.

## Invoice behavior

Only order UUID, amount, currency and checkout settings go to BTCPay. Requests exclude product names, usernames, shipping addresses and messages, and use Tor with proxy DNS resolution. Checkout links stay on the configured onion host.

The adapter checks invoice identity, store, order reference, currency and exact amount. New invoices await payment; processing invoices await confirmation. Settled invoices allow fulfillment. Manual status marking remains under review. Sellers control their BTCPay instances, so this is provider verification, not independent trustless proof against a dishonest seller.

The seller's provider determines the blockchain network and may add payment method fees. Follow the exact payable amount, destination, network and deadline on its invoice; the order total alone may not cover those fees. Market does not independently discover or certify the provider's network. For example, the isolated XMR check used a 0.11 XMR order with a provider payable amount of 0.1118 XMR.

Polling examines up to ten pending orders per cycle, once per minute, with bounded timeouts. High volume and outages delay updates. Participants can request a refresh. Partial or late payments remain under review. Inventory is released only after provider expiry, end of monitoring, and explicit evidence of zero payments across methods.

A durable flag is set immediately before invoice creation. After a lost POST response the app searches by order reference rather than creating another invoice. If no invoice is found, the order stays pending for operator investigation. There is no blind retry of ambiguous creation or unsafe manual release button.

Sellers arrange refunds outside the marketplace and can record a reference afterward. This does not initiate or verify a transfer. The marketplace has no escrow or buyer balances.

## Before real sales

The adapter follows the [Greenfield API specification](https://docs.btcpayserver.org/API/Greenfield/v1/). In addition to fixtures, a disposable BTCPay Server 2.4.4 with Monero plugin 1.3.5 completed actual Bitcoin regtest and Monero fakechain transfers, with digital download and physical fulfillment verified through Market. No mainnet funds or personal payment instance were used. The [verification record](VERIFICATION.md) separates those results from fixture coverage. Each new seller installation still needs its own controlled checks before accepting customer payments.

## Controlled integration procedure

Market does not install BTCPay. Follow the provider's [deployment documentation](https://docs.btcpayserver.org/Deployment/) and the [Monero plugin setup](https://github.com/btcpay-monero/btcpayserver-monero-plugin) on a separately managed seller instance. Record the installed versions privately. The plugin's daemon and wallet RPC settings belong to BTCPay, not Market's Compose environment. Verify compatibility with the installed version rather than assuming that enabling an asset in Market creates a wallet.

After import, restart the app and inspect **Account**. Its connected indicator means that a valid configuration was loaded; it does not perform a live provider health test. Market needs no incoming webhook endpoint or webhook secret because this adapter polls invoices. BTCPay's Monero plugin still needs its own working daemon, wallet RPC and notification configuration. Polling Market cannot repair a provider that never detects a payment.

For each asset independently, use separate buyer and seller accounts and disposable product data:

1. Create and approve a small digital listing. Create an order and confirm the seller store, order UUID, currency and exact amount in BTCPay. Check that its checkout remains on the intended onion host.
2. Before settlement, confirm that the buyer cannot download the product and an unrelated account cannot access the order. This check requires no transfer.
3. Prefer a disposable provider and isolated test chains for engineering checks. Configure the network in the provider and its nodes, not in Market. Never pay from a mainnet wallet into a test invoice. Market directs buyers to confirm the invoice network; it has no network selection switch. If the operator chooses a mainnet exercise, agree on the amount and fees first. Tests in `tests/` simulate provider responses and never send coins.
4. Observe processing and settlement, then verify that only the owning buyer gains the download. Repeat the settled flow for a physical listing and check **Mark shipped** followed by **Confirm delivery received**.
5. Test unpaid expiry through the full provider monitoring period. Test unavailable provider reads and interrupted invoice creation in an isolated environment. Confirm no duplicate invoice or premature stock release. Use fixtures for destructive fault scenarios unless the operator has a dedicated integration environment.
6. Review partial and late payments without forcing fulfillment. If testing a refund, verify the external transfer separately before recording it in Market.

Record provider versions, expected and observed states, and unresolved failures privately. Keep keys, real addresses, invoice URLs and customer data out of public test reports. Until these steps pass, describe the seller integration as unverified. See [incident procedures](OPERATIONS.md#payment-incident-procedure) for ambiguous outcomes.

## Credential rotation

Issue a replacement store scoped API key in BTCPay, put it in a private import JSON with the same URL and store ID, repeat the standard input `connect` command, and restart the app. Verify an existing invoice can still be read before revoking the old key, unless the old key is suspected compromised and needs immediate revocation. Protect or remove the host staging file according to your local data handling policy. Restarting does not remove the original host file or backups.
