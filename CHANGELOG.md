# Changes

## 1.0.4

Unpublished source candidate. The November 19 dependency audit reported zero advisories.

- Prepare versioned source delivery for the Node 26 support and pinned Docker base already on main, retaining the supported Node 24 path.
- Document the single-server local workflow after building, alongside the optional Vite hot-reload workflow.
- Clarify the eligibility message for digital downloads.
- Record the current local and container checks separately from historical payment integrations.

## 1.0.3

- Ship the request dependency fixes already verified on main: body-parser 2.4.0, multer 2.5.0, ip-address 10.7.5, and qs 6.17.1. These replace versions in the 1.0.2 source archive with known denial of service advisories.
- Update Vite to 8.3.7 to address GHSA-p4f5-76q4-ffq7 in the development tooling.
- Apply the password change limit to the authenticated account, including attempts across sessions, without accepting a body parameter as the account identifier.
- Update the Docker runtime to supported Node 24.22.3, React Router to 7.18.5, and React and React DOM together to 19.3.1. Group future React dependency updates.
- Verify marketplace routes in a disposable browser before publication, alongside the existing source, archive consumer, and Docker checks.

The 1.0.2 release assets remain unchanged. Install this source release in a fresh directory and follow the existing upgrade and backup instructions.

## 1.0.2

- Save administrator payment connections through an exclusive temporary file before replacing the configuration, so a path swap cannot redirect the write.
- Run source and Docker verification on the exact release tag before starting publication from the checked main commit.

## 1.0.1

- Bound aggregate requests before body parsing and session database work.
- Share concurrent transfer capacity and idle/total deadlines across media, protected downloads, static files and the application shell.
- Preserve separate authenticated limits behind Tor, buyer-only downloads, unpublished-image privacy and local health diagnostics.
- Throttle expired-session cleanup and index session expiry.

The 1.0.0 release assets remain unchanged.
