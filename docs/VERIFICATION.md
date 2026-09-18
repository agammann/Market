# Verification record

Checks span September 16 and 17, 2026, Pacific time.

The latest source adds private field encryption, invoice attempt recovery, the privacy page and Market branding. After workspace permissions changed, Docker access was denied. Those final changes are therefore not yet installed in the running onion containers. Run `Start Marketplace.cmd` locally to rebuild them. Saved browser images show the earlier deployed catalog, before the casing and privacy footer changes.

## Automated checks

`pnpm test`: 12 passing tests. Integration uses real Express endpoints, SQLite, authentication, uploads, moderation, orders, stock reservation, exact amounts, messaging, refund recording, reviews and restart persistence. Strangers and unrelated administrators cannot access orders; unpaid orders cannot download products. ETH and USDT are rejected.

Payment transport fixtures cover payloads, identity and amount matching, lost response recovery, read failure retries, settlement, manual marking, partial payments, expiry and changed configuration. They are not proof of a working external BTCPay installation.

Private field tests cover authenticated encryption, random ciphertext, incorrect contexts, tampering, key persistence, legacy migration, missing key failure, encrypted database contents and authorized response decryption.

`pnpm build` passed. `pnpm audit --prod` reported no known vulnerabilities at check time. This is an advisory check, not a security audit.

After the permission change, the normal test runner and Vite could not spawn subprocesses (`EPERM`). Running Node's supported `--test-isolation=none` mode verified all 12 latest tests successfully within the restricted workspace. The earlier build passed before the final frontend branding/privacy changes. The prepared GitHub workflow will check the final frontend once the source is uploaded; no remote CI run is claimed.

## GitHub handoff

The repository was created and renamed to `agammann/Market`; its private visibility was verified in GitHub. Source is committed locally. Upload was blocked: Git returned `SEC_E_NO_CREDENTIALS` under the restricted session, and GitHub mutation tools required approval unavailable under the session's policy. The remote repository currently has only its initial README. Open `Publish Source.cmd` in a normal terminal with GitHub Git credentials available to push the committed source. It does not add or commit untracked runtime files.

## Live checks

Docker Linux images built and app and Tor containers started. App health passed. Tor bootstrapped fully. No host ports were published. The app's only network is internal. A health request through Tor to the actual onion address succeeded.

An isolated Chromium browser in a temporary QA container loaded the live onion service through Tor. Desktop 1536 by 1024 and mobile 390 by 844 were inspected. Filtering/reset, invalid sign in feedback and protected seller route redirection passed. No page errors or horizontal overflow were detected. Observed page requests stayed on the marketplace onion origin. No real customer or payment data was used.

Temporary QA containers and the temporary loopback SOCKS test proxy were removed. Brave was not verified through automation because launching it was blocked by automatic approval policy. The address can be opened manually in Brave's Tor window.

## Remaining verification boundaries

No live BTCPay account was connected or cryptocurrency sent. There is no cloud deployment, independent security audit, volume load test, no JavaScript mode, automatic retention deletion, escrow or automatic refund transfer. Seller payment instances and wallet policies require separate checks before real orders.
