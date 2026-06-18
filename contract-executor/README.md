# Epoch TEE Enclave WASM Contract ⏳ — Egress Dispatcher

This directory contains the **Egress Dispatcher** ("The Blind Courier"), the **second** Rust→WASM contract in the Epoch system. It executes inside the **Intel TDX Hardware Enclave** (TEE) and is responsible for one thing only: the **privacy-blind egress** to beneficiaries.

> **It is never called by the frontend directly.** The [Switch Coordinator](../contract) invokes it synchronously through the host `contracts-call` interface during `fire_epoch`. The Courier runs as an **atomic sub-transaction**: if it reports any failed delivery, the Coordinator aborts the whole release — the switch stays `expired`, no VC is issued, nothing is enqueued to the outbox, and the vault keys remain sealed.

---

## 🧭 Why a Second Contract?

The two contracts map to the two agents defined in [`../AGENTS.md`](../AGENTS.md) and enforce **least privilege** at the hardware boundary:

| | Switch Coordinator (`../contract`) | **Egress Dispatcher (this crate)** |
|---|---|---|
| Role | "The Custodian" — switch state, liveness, vault | "The Blind Courier" — notifications only |
| Binary | `epoch_contract.wasm` | `epoch_executor.wasm` |
| Exports | `arm_switch`, `heartbeat`, `check_trigger`, `fire_epoch`, `cancel`, `get_status` | `execute_dispatch` |
| Host APIs | `kv-store`, `clock`, `signing`, `stash`, `logging`, `contracts-call`, `outbox` | `http-with-placeholders`, `logging` |
| Invoked by | the Next.js host runner | the Coordinator, via `host_contracts_call` |
| Sees vault keys / OTP secret? | **Yes** | **No** — only beneficiary markers |

Splitting egress into its own enclave means the Courier **physically cannot read** the decryption keys or OTP secret: they are never passed across the `contracts-call` boundary. The Coordinator hands it only the list of beneficiary placeholder markers and a legacy hash.

---

## 🔌 Host API Imports

```rust
extern "C" {
    // Privacy-blind egress: {{profile.*}} markers are substituted at the host
    // boundary, so this contract never sees plaintext beneficiary contacts.
    fn host_http_with_placeholders_post(url_ptr: *const u8, url_len: usize, body_ptr: *const u8, body_len: usize, res_buf_ptr: *mut u8, res_buf_len: usize) -> i32;
    // In-enclave audit trace.
    fn host_logging_log(msg_ptr: *const u8, msg_len: usize);
}
```

This contract deliberately imports **no** `kv-store`, `clock`, `signing`, `stash`, `contracts-call`, or `outbox` — it has no business touching switch state or secrets.

---

## ⚙️ Exported WASM API

Memory helpers (same JSON-over-pointers ABI as the Coordinator):
- `alloc(size: usize) -> *mut u8`
- `dealloc(ptr: *mut u8, size: usize)`

### `execute_dispatch`
Dispatches one blind notification per beneficiary through `http-with-placeholders`, in order. Returns `success: true` only if **every** beneficiary was delivered.

- **Input JSON** (built by the Coordinator):
  ```json
  {
    "beneficiaries": ["{{profile.verified_contacts.email.value}}", "heir2@example.org"],
    "legacyHash": "0x3b18cf983bd7088998aa90c8b323c6f14028bc",
    "mockFailureStep": null
  }
  ```
- **Returns JSON (all delivered):**
  ```json
  {
    "success": true,
    "egressCount": 2,
    "delivered": [
      { "target": "{{profile.verified_contacts.email.value}}", "status": "delivered" },
      { "target": "heir2@example.org", "status": "delivered" }
    ]
  }
  ```
- **Returns JSON (a delivery failed → Coordinator rolls back):**
  ```json
  {
    "success": false,
    "error": "Downstream beneficiary target rejected delivery.",
    "failedStep": 2,
    "delivered": [ { "target": "...", "status": "delivered" } ]
  }
  ```
- **Returns JSON (bad payload):**
  ```json
  { "success": false, "error": "Invalid dispatch payload: <serde error>" }
  ```

#### `mockFailureStep` (rollback demo)
The Coordinator forwards the demo's "Toggle Mock Cascade Failure" selection here. If `mockFailureStep == N`, the Courier delivers beneficiaries `1..N-1` then reports failure on step `N` (simulating an HTTP 502), which drives the Coordinator's atomic rollback. The host runner can also fail the real egress (`host_http_with_placeholders_post` returns `< 0`), producing the same outcome.

---

## 🔗 How the Coordinator Calls It

Inside `fire_epoch` (see [`../contract/src/lib.rs`](../contract/src/lib.rs)):

```rust
let dispatch_payload = serde_json::json!({
    "beneficiaries": switch_state.beneficiaries,
    "legacyHash": "0x3b18cf...",
    "mockFailureStep": req.mock_failure_step
}).to_string();

// Synchronous cross-contract call inside the same TEE transaction.
let courier_raw = contracts_call("epoch-executor", "execute_dispatch", &dispatch_payload);

// Atomic: only commit (fire + VC + outbox) if the Courier reports full success.
if courier["success"] != true { /* ROLLBACK — switch stays "expired", keys sealed */ }
```

The host side (`src/lib/wasmRunner.ts`) implements `host_contracts_call` by synchronously instantiating `epoch_executor.wasm` against the same shared host state and returning its JSON result to the Coordinator.

---

## 🛠️ Building the WASM Target

From the repo root, the easiest path builds **both** contracts and copies them into `src/lib/`:

```bash
make build-contracts
```

Or build just this contract manually:

```bash
rustup target add wasm32-unknown-unknown   # once
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/epoch_executor.wasm ../src/lib/
```

---

## 🧪 Testing

Native unit tests use `#[cfg(test)]` host mocks (no real TEE needed):

```bash
cargo test                 # this contract only
make test-contract         # both contracts, from the repo root
```

Covered: all-delivered success, mid-list `mockFailureStep` failure, host egress (`http`) failure, empty beneficiary list, and invalid-payload handling.
