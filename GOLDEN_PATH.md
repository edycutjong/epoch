# Golden Path — 2-Minute Reviewer Quickstart (Epoch)

> For judges: see the whole **TEE dead-man's-switch** flow end-to-end with **zero credentials, no API keys, no external services**. Everything runs locally against the bundled Rust→WASM enclave contracts.

## Choose your path

| Goal | Command | Time | Credentials |
|------|---------|------|-------------|
| **See it all pass** (lint, types, 26 Rust + 193 TS tests, e2e) | `make ci` | ~1 min | None |
| **Click through the UI** | `npm install && npm run dev` → http://localhost:3000 | ~2 min | None |
| **Measure latency** | `npm run dev &` then `python3 scripts/bench.py` | ~1 min | None |
| **Read the full walkthrough** | [DEMO.md](DEMO.md) | — | — |

## The 2-minute demo (UI)

1. **Arm the switch** — set a liveness schedule and click **ARM SWITCH**. Status flips to `Armed`; the vault seals.
2. **Send a heartbeat** — click **SEND HEARTBEAT (OTP)**, hit **AUTOFILL** (the simulated SMS OTP is shown), **VERIFY**. The countdown resets. This OTP is a **real HMAC-SHA256 TOTP** verified *inside* the WASM contract.
3. **Go silent** — drag the **Time-Warp** slider past the grace period. Status flips `active → expired`.
4. **Fire the cascade** — click **TRIGGER ATOMIC CASCADE**. Watch: the Switch Coordinator contract calls the Egress Dispatcher contract via **`contracts-call`**, PII-blind notices go out via **`http-with-placeholders`**, a **genuine Terminal 3 Verifiable Credential** receipt is issued with the real **`@terminal3/ecdsa_vc`** SDK, and the release is durably enqueued to the **`outbox`** — all atomically. Click **Verify VC** to verify it with the real **`@terminal3/verify_vc`** SDK (a tampered VC fails).
5. **Try the rollback** — toggle **Mock Cascade Failure** and fire again: the whole transaction reverts, the switch stays `expired`, and the vault keys stay sealed.

## What's real vs simulated
- **Real:** two compiled Rust→WASM enclave contracts, the synchronous cross-contract `contracts-call` cascade with atomic rollback, HMAC-SHA256 TOTP verification, PII-blind placeholder egress, a reproducible enclave measurement (`shasum -a 256 src/lib/*.wasm` matches `/api/integrations/verify`), and a **genuine Terminal 3 Verifiable Credential** receipt issued/verified with the **real published `@terminal3/ecdsa_vc` + `@terminal3/verify_vc` SDK** (offline, no credentials).
- **Simulated (local sandbox):** the Terminal 3 host APIs, OTP delivery (printed to console), and beneficiary egress. See the "Hackathon Simulation Context" banner in the app.

## Bug-bounty track
See **[SDK_AUDIT.md](docs/SDK_AUDIT.md)** — confirmed, code-cited security findings verified from the real published `@terminal3` VC packages — and **[BUGS.md](BUGS.md)** for integration/doc gaps.
