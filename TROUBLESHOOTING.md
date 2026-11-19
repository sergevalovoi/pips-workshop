# Troubleshooting
- **"Node.js is not installed / too old"** — install LTS from https://nodejs.org/ and run START again.
- **Claude Code missing / not signed in** — CHECK.cmd says which. Install per https://code.claude.com/docs/en/overview, run `claude` and sign in with your own account.
- **Port 8194 is used by something else** — START refuses and changes nothing. Set another port (PowerShell: `$env:BAY_PORT=8195`) and START again. Another copy of Bay Office on the same port counts as foreign too.
- **Browser did not open** — open `data\launch-url.txt` (private link; don't share or screenshot it).
- **Rate-limit / budget message** — wait and retry manually; a failed request is never replayed. Alpha allowance: 20 requests.
- **Schedules did nothing** — the PC must be on and the app running; schedules are finite (max 3 repeats).
- **STOP says "not this instance"** — it only stops the copy whose data folder matches the running instance.
- Logs: `data\server.err.log` (no credentials expected; check before sharing).
