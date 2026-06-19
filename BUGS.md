# Terminal 3 ADK — Onboarding Bug & Documentation Audit

> Submitted for the **Terminal 3 ADK Dev Challenge 2026 — Track 2 (Bug Bounty)**.
>
> These are concrete onboarding blockers and documentation gaps found while building
> **Epoch** (and the wider Vouch Suite: Epoch, Lethe, Silo, Synod, Visor) against the
> T3 ADK host APIs and SDK. Each entry lists where it bit us and the workaround we
> shipped, so it doubles as a fix checklist.

> 🔬 **See [SDK_AUDIT.md](docs/SDK_AUDIT.md)** for **confirmed, code-cited security findings** verified directly from the *real published* `@terminal3` VC packages via `npm pack` (hardcoded BBS `nonce` → proof replay, revocation bypass, no holder/challenge binding). The list below is integration/documentation gaps; the audit is reproducible SDK bugs.

| # | Area | Type | Severity |
|---|---|---|---|
| 1 | `metamask_sign` | Undocumented param | Low |
| 2 | `kv-store` | Interface discrepancy | High |
| 3 | `clock` | Method name mismatch | High |
| 4 | `signing` | Missing WIT helper | Medium |
| 5 | `loadWasmComponent` | Opaque path resolution | Medium |
| 6 | tenant DID | Hex double-encoding trap | High |
| 7 | public KV route | Missing spec (CORS/cache/pagination) | Low |
| 8 | transactions | Rollback semantics undocumented | Medium |
| 9 | `outbox` | Idempotency lifecycle undocumented | Medium |

---

## Bug #1 — Undocumented second parameter in `metamask_sign`
**Type:** Documentation · **Severity:** Low

The SDK setup snippet specifies `EthSign: metamask_sign(address, undefined, T3N_API_KEY)` but never documents what the second positional argument (passed as `undefined`) configures. This blocks custom wallet bindings — developers can't tell whether it is a chain id, a nonce, a message-encoding flag, or an options bag.

**Ask:** Document the parameter's type and accepted values, or replace the positional API with a named options object.

---

## Bug #2 — `kv-store` interface discrepancy (map-name vs. flat keys)
**Type:** Interface · **Severity:** High

The official WIT (`package.wit`) declares `get: func(map-name: string, key: list<u8>)`, but the raw C imports and local sandbox runtimes assume a single flat namespace where `host_kv_store_get` takes only `(key_ptr, key_len)`. You cannot build WASM-Component-compliant code without renaming/wrapping guest imports.

**Where it bit us:** Our contract uses the flat `host_kv_store_get(key_ptr, key_len, val_buf_ptr, val_buf_len)` shape (see `contract/src/lib.rs`). Porting to the WIT component shape requires a shim.

**Ask:** Make the WIT and the C ABI agree, or ship an adapter and document which environments use which.

---

## Bug #3 — Clock API method-name mismatch
**Type:** Interface · **Severity:** High

Walkthroughs reference `fn host_clock_now() -> u64`, but the dependency WIT packages require `now-ms: func() -> result<u64, clock-error>`. Targeting standard `wasm32-wasip2` components therefore fails to compile against the documented import.

**Where it bit us:** We pin `host_clock_now() -> u64` and target `wasm32-unknown-unknown` to stay consistent with the host runner.

**Ask:** Align the documented import name/signature with the WIT, and state which target triple each example assumes.

---

## Bug #4 — Missing `host_signing_issue_vc` in the `signing` WIT interface
**Type:** Interface · **Severity:** Medium

Non-WIT templates call `host_signing_issue_vc` to issue Verifiable Credentials, but the official WIT `signing` interface only exposes `sign: func(message: list<u8>) -> result<list<u8>, sign-error>` — there is no VC-level helper. Developers must hand-roll the entire W3C VC envelope and JWT encoding on top of raw `sign`.

**Where it bit us:** Epoch issues a `LegacyReleaseCredential` receipt; we had to construct the VC envelope ourselves around a raw signature.

**Ask:** Either add a VC helper to the WIT, or document the canonical VC-over-`sign` recipe.

---

## Gap #5 — Opaque `loadWasmComponent()` path resolution
**Type:** Documentation · **Severity:** Medium

The setup guides call `await loadWasmComponent()` with zero arguments and never say where `.wasm` files are resolved from or how to override the path for local components.

**Where it bit us:** Our runner resolves the binary explicitly via `path.resolve(process.cwd(), 'src/lib/epoch_contract.wasm')` (and `epoch_executor.wasm`) to avoid the ambiguity entirely.

**Ask:** Document the resolution base path and an override argument/env var.

---

## Gap #6 — Tenant DID hex double-encoding trap
**Type:** Correctness · **Severity:** High

The cheatsheet resolves map names via `format!("z:{}:secrets", hex::encode(&tid))` where `tid = tenant_did()`. If `tenant_did()` returns a **string** (e.g. `did:t3n:f600...`), `hex::encode` encodes the ASCII bytes of the string, double-encoding the identifier and silently breaking KV routing (reads miss, writes land in the wrong map).

**Ask:** Clarify whether `tenant_did()` returns raw bytes or a string, and show the correct map-name derivation for each.

---

## Gap #7 — Public KV route specification
**Type:** Documentation · **Severity:** Low

Guides mention public maps are world-readable via `/api/dev/public-kv/<tid>/<tail>` but document no CORS policy, cache-control behavior, or pagination query schema for large maps.

**Ask:** Publish the route's CORS headers, cache semantics, and pagination/query parameters.

---

## Gap #8 — Transaction rollback semantics undocumented
**Type:** Documentation · **Severity:** Medium

There is no explanation of how returning `Err` from a contract function maps to host state rollback — what gets reverted (KV writes? stash puts? outbox enqueues?), and whether cross-contract (`contracts-call`) sub-transactions revert atomically with the parent.

**Where it bit us:** Epoch's atomic cascade depends on this: on a failed `contracts-call` to the Egress Dispatcher we must guarantee the switch is **not** marked fired and the durable outbox is **not** enqueued. We enforced atomicity in guest code (abort before any commit) rather than relying on host rollback, because the boundary is unspecified.

**Ask:** Document the exact rollback boundary for `Err` returns and for nested `contracts-call`.

---

## Gap #9 — `outbox` idempotency lifecycle undocumented
**Type:** Documentation · **Severity:** Medium

The `outbox` interface enqueues with an `idk` (idempotency key), but the deduplication **window lifespan** and **queue overflow** behavior are undocumented. Developers can't tell whether an `idk` dedupes forever, for a TTL, or only within a batch — which changes how you generate keys.

**Where it bit us:** Epoch keys release events as `epoch-release-<switchId>-<firedAt>` for at-least-once delivery; the correct key strategy depends entirely on the (unspecified) dedup window.

**Ask:** Document the idempotency window/TTL and the overflow/backpressure behavior.
