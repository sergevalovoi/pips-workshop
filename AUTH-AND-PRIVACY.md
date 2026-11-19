# Auth and privacy

## Authentication (not legal advice)
- The app never asks for, stores or reads your Claude password, OAuth token or API key. You install the **unmodified official Claude Code** yourself and sign in with **your own account** via its native flow. The app only runs the local `claude` binary.
- The connection check runs `--version` and `auth status`; it is not a model request. The UI reports only "missing / not signed in / rate limited", not your identity.
- No implicit paid-API fallback. Any other authentication you set up outside the app is your own existing choice; this alpha is built and described for a claude.ai sign-in only.
- Not a hosted or shared subscription: each participant's usage is on their own account.
- Source consulted: https://code.claude.com/docs/en/legal-and-compliance, section "Can customers offer Claude Code in their products?", inspected by the project owner on 2026-11-19. As read then: the binary must be unmodified, users authenticate with their own credentials, usage is billed directly to each user, no reseller/intermediary usage, no implied endorsement. This package is designed to those points. It is **not** a certification or guarantee of eligibility; the page can change, so re-read it before relying on it. Attribution is plain text; no Anthropic logos; no affiliation is claimed.

## Privacy
- Data lives in `./data` (or `BAY_DATA_DIR`) on your computer. Task text and notes are sent by Claude Code to Anthropic's service under your own account's terms; this app adds no other network traffic and no telemetry.
- Milestone export is manual: a JSON/CSV download of timestamps and event names with a `real`/`stub` marker. It contains no task text, output, source text, names, e-mail, paths or credentials. Nothing is uploaded automatically; you decide whether to share it.
- The server binds to loopback only; cookie + Origin/Host + CSRF checks apply; the launch link is stored in a local file and is not printed.
