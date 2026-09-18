# Privacy and operation

The deployment has only a Tor v3 onion entry point. Docker publishes no ports. The app has only an internal network; BTCPay requests use Tor SOCKS. Onion identity keys stay in the Tor volume, while the app receives only the public hostname.

Tor does not make account behavior, public reviews, deliveries or a compromised device anonymous. [Bitcoin transactions are public](https://bitcoin.org/en/protect-your-privacy). Monero does not remove information disclosed to sellers, wallets, payment software or the host operator.

## Data handling

| Data                                | Treatment                                                                   |
| :---------------------------------- | :-------------------------------------------------------------------------- |
| Email and legal name                | Not requested at registration                                               |
| Password                            | Salted scrypt hash                                                          |
| Session                             | Random token, hash stored in SQLite, HttpOnly and SameSite Strict cookie    |
| IP and fingerprint                  | No application access logs, fingerprint collection or analytics             |
| Listing photos                      | Reencoded locally with metadata stripped                                    |
| Digital products                    | Private files; downloads require buyer ownership and fulfillment            |
| Shipping and tracking               | Encrypted in SQLite, participant access only                                |
| Private messages                    | Encrypted in SQLite, participant access only                                |
| Reviews and seller profiles         | Public to visitors                                                          |
| Order amount, time and participants | Ordinary stored metadata                                                    |
| BTCPay metadata                     | Order UUID, amount, currency and checkout settings                          |
| BTCPay credentials                  | Private data volume, never frontend responses                               |
| Audit                               | Account identifier, action, target and timestamp, no private field contents |

HTTP onion transport is protected by the onion connection. Cookies are not marked Secure on this HTTP deployment. CSRF tokens, origin checks and exact Host validation protect write endpoints. A future TLS deployment requires deliberate origin and cookie configuration.

## Encryption and backups

Private fields use AES 256 GCM with random nonces and authenticated order/field context. Back up `data/private-fields.key` securely with the database. Losing it makes those fields unreadable. A missing key with encrypted records fails startup rather than silently generating a replacement.

This protects a database copy without the key. Full host compromise, full volume copies and operator access are outside this protection. Use full disk encryption and protected backups, including for uploaded files, ordinary database metadata and API credentials. This is not end to end messaging.

Legacy plaintext fields migrate at startup. Migration does not erase SQLite free pages, historical WAL files or old backups. Do not claim historical plaintext has been securely erased.

Preserve market data, Tor state and the shared public hostname volumes during host migration. Tor identity keys preserve the onion address. Stop the app for a consistent database backup or use SQLite's supported online backup mechanism. Keep encrypted backups outside the repository and test restoration. Do not publish volumes, configuration or server logs to GitHub.

## Retention and browser limits

Orders, messages, uploads and audit records have no automatic deletion yet. Account deletion and password recovery are not implemented. Establish an explicit retention process before collecting real customer data. Physical deliveries necessarily disclose a destination to a seller and carrier.

The React interface needs JavaScript and does not work with it disabled. Brave Tor windows can visit onion services, but [Brave recommends Tor Browser when safety depends on anonymity](https://support.brave.com/hc/en-us/articles/360018121491-What-is-a-Private-Window-with-Tor-Connectivity). No browser anonymity guarantee is made.

Keep Docker, Tor, Node, dependencies and the host patched. Run one app process per database. Functional tests do not replace independent security review or load testing. Host and Docker access can read or change marketplace data.

## Private GitHub source

The repository is private, with no public Pages deployment or package. Git commits use the account's noreply email. Ignore files exclude runtime data, credentials, keys and local addresses. The actual live onion address is absent from committed files. GitHub still knows which account owns the repository; private visibility is access control, not anonymity from GitHub or authorized collaborators.
