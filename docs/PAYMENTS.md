# Bitcoin and Monero payments

The marketplace creates exact asset denominated BTCPay invoices. There is no exchange rate service, ETH, USDT, or manual seller payment confirmation. Prices use integer atomic units: 8 decimal places for BTC and 12 for XMR.

## Seller isolation

Use a separate BTCPay Server instance per seller. The [Monero plugin documentation](https://github.com/btcpay-monero/btcpayserver-monero-plugin) states that its Monero wallet is shared across all stores on an instance. Multiple stores therefore do not isolate unrelated sellers' Monero wallets. The application rejects reused onion hosts across sellers; different hostnames alone cannot prove the wallets are isolated.

The operator's existing personal BTCPay instance is not connected. This repository does not provision BTCPay, blockchain nodes, wallets, or a paid server.

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

Register the seller first. Copy the file into private temporary storage, import it and restart:

```powershell
docker compose cp C:\PRIVATE_PATH\seller.json app:/tmp/seller.json
docker compose exec -T app node scripts/admin.mjs connect SELLER_USERNAME /tmp/seller.json
docker compose restart app
```

Restart clears `/tmp` tmpfs. Imported credentials persist in the data volume's `btcpay.json`. Protect the host staging file and remove it when appropriate. Account reports connected assets, never keys. API keys can rotate for the same store. Changing the instance with existing orders is blocked to preserve invoice identity.

## Invoice behavior

Only order UUID, amount, currency and checkout settings go to BTCPay. Requests exclude product names, usernames, shipping addresses and messages, and use Tor with proxy DNS resolution. Checkout links stay on the configured onion host.

The adapter checks invoice identity, store, order reference, currency and exact amount. New invoices await payment; processing invoices await confirmation. Settled invoices allow fulfillment. Manual status marking remains under review. Sellers control their BTCPay instances, so this is provider verification, not independent trustless proof against a dishonest seller.

Polling examines up to ten pending orders per cycle, once per minute, with bounded timeouts. High volume and outages delay updates. Participants can request a refresh. Partial or late payments remain under review. Inventory is released only after provider expiry, end of monitoring, and explicit evidence of zero payments across methods.

A durable flag is set immediately before invoice creation. After a lost POST response the app searches by order reference rather than creating another invoice. If no invoice is found, the order stays pending for operator investigation. There is no blind retry of ambiguous creation or unsafe manual release button.

Sellers arrange refunds outside the marketplace and can record a reference afterward. This does not initiate or verify a transfer. The marketplace has no escrow or buyer balances.

## Before real sales

The adapter was checked against the [current Greenfield API specification](https://docs.btcpayserver.org/API/Greenfield/v1/) and tested with fixtures. A connected seller still needs a controlled BTC and XMR integration check covering exact amount, expiry, confirmation, download unlock, physical fulfillment, interrupted requests and refund handling. No real funds were sent during this build.
