# Epoch TEE Enclave WASM Contract ⏳ — Switch Coordinator

This directory contains the **Switch Coordinator** ("The Custodian"), the primary Rust→WASM contract that executes inside the **Intel TDX Hardware Enclave** (TEE). It represents the isolated custodian boundary of the Dead-Man's Switch.

> **Two-contract system.** The Coordinator never performs egress itself. On `fire_epoch` it synchronously invokes the **Egress Dispatcher** (the "Blind Courier", in [`../contract-executor`](../contract-executor)) via `host_contracts_call`, and only commits the release (VC + outbox + `fired` status) if that cross-contract call reports full success. See [`../contract-executor/src/lib.rs`](../contract-executor/src/lib.rs).

---

## 🏗️ Architecture & Security Invariants

The contract is designed to be self-contained and operates blindly inside TEE-secured memory. It enforces several critical safety constraints:

1. **Host-Isolated Custody**: Decryption keys and vault file references (`stashRefs`) remain sealed inside the enclave's isolated memory registers. No host admin, agent daemon, or cloud provider can access them before switch expiration.
2. **TOTP Heartbeat Verification**: The contract implements an in-memory HMAC-SHA256 TOTP decoder to check 6-digit OTP codes. Check-in verification happens entirely within the TEE boundary.
3. **Monotonic Clock Guard**: Expiration timeouts are evaluated directly against the host's monotonic hardware clock (`clock` API), protecting countdowns from NTP manipulation.
4. **Atomic Rollback Guarantee**: During the digital legacy cascade, the contract dispatches alerts sequentially. If any single alert dispatch fails, the contract immediately aborts the transaction, reverting database states and keeping keys cryptographically sealed.
5. **Verifiable Receipt Signing**: Upon successful execution, the contract calls the host signing service to issue a Verifiable Credential receipt verifying the atomic release.

---

## 🔌 Host API Imports

The contract imports host functions provided by the **Terminal 3 Agent Developer Kit (ADK)** environment:

```rust
extern "C" {
    fn host_kv_store_get(key_ptr: *const u8, key_len: usize, val_buf_ptr: *mut u8, val_buf_len: usize) -> i32;
    fn host_kv_store_set(key_ptr: *const u8, key_len: usize, val_ptr: *const u8, val_len: usize) -> i32;
    fn host_clock_now() -> u64;
    fn host_signing_issue_vc(subject_ptr: *const u8, subject_len: usize, claims_ptr: *const u8, claims_len: usize, vc_buf_ptr: *mut u8, vc_buf_len: usize) -> i32;
    fn host_logging_log(msg_ptr: *const u8, msg_len: usize);
    fn host_stash_put(data_ptr: *const u8, data_len: usize, ref_buf_ptr: *mut u8, ref_buf_len: usize) -> i32;
    fn host_stash_get(ref_ptr: *const u8, ref_len: usize, data_buf_ptr: *mut u8, data_buf_len: usize) -> i32;
    // Synchronous TEE cross-contract call into the Egress Dispatcher.
    fn host_contracts_call(contract_ptr: *const u8, contract_len: usize, fn_ptr: *const u8, fn_len: usize, payload_ptr: *const u8, payload_len: usize, res_buf_ptr: *mut u8, res_buf_len: usize) -> i32;
    // Durable, at-least-once outbox enqueue keyed by an idempotency key (idk).
    fn host_outbox_enqueue(idk_ptr: *const u8, idk_len: usize, payload_ptr: *const u8, payload_len: usize) -> i32;
}
```

> `http-with-placeholders` is **not** imported here — egress is owned by the Egress Dispatcher contract, which the Coordinator reaches through `host_contracts_call`.

---

## ⚙️ Exported WASM API Functions

The contract exposes a set of C-compatible boundaries to exchange JSON strings with the Next.js backend runner. 

Memory helpers:
- `alloc(size: usize) -> *mut u8`: Allocate memory at the WASM boundary.
- `dealloc(ptr: *mut u8, size: usize)`: Deallocate boundary memory.

### 1. `arm_switch`
Initializes a new dead-man's switch state and seals the vault references.
- **Input JSON:**
  ```json
  {
    "switchId": "string",
    "gracePeriod": 1209600000,
    "beneficiaries": ["string"],
    "stashRefs": ["string"],
    "encryptedKeys": "string",
    "otpSecret": "string"
  }
  ```
- **Returns JSON:**
  ```json
  {
    "success": true,
    "switchId": "string",
    "status": "active",
    "lastHeartbeat": 1729600000000,
    "nextHeartbeatRequiredBy": 1730809600000
  }
  ```

### 2. `heartbeat`
Resets the countdown clock if a valid 6-digit OTP heartbeat is supplied.
- **Input JSON:**
  ```json
  {
    "switchId": "string",
    "otpCode": "123456",
    "clockOffset": 0
  }
  ```
- **Returns JSON:**
  ```json
  {
    "success": true,
    "switchId": "string",
    "status": "active",
    "lastHeartbeat": 1729600010000,
    "nextHeartbeatRequiredBy": 1730809610000
  }
  ```

### 3. `check_trigger`
Compares the monotonic clock against the last heartbeat to check if the switch has expired.
- **Input JSON:**
  ```json
  {
    "switchId": "string",
    "clockOffset": 0
  }
  ```
- **Returns JSON:**
  ```json
  {
    "switchId": "string",
    "status": "expired",
    "elapsed": 1209601000,
    "gracePeriod": 1209600000,
    "timeLeft": 0,
    "expired": true
  }
  ```

### 4. `fire_epoch`
Triggers the atomic cascade to dispatch notifications blindly and decrypt keys.
- **Input JSON:**
  ```json
  {
    "switchId": "string",
    "mockFailureStep": 0
  }
  ```
- **Returns JSON (Success):**
  ```json
  {
    "success": true,
    "switchId": "string",
    "status": "fired",
    "stepsExecuted": [
      { "target": "spouse@domain.org", "status": "delivered" }
    ],
    "vcReceipt": "{...}",
    "decryptedKeys": "string"
  }
  ```
- **Returns JSON (Rollback):**
  ```json
  {
    "success": false,
    "error": "ROLLBACK TRIGGERED: Downstream target failed.",
    "failedStep": 1,
    "reverted": true,
    "switchStatus": "expired"
  }
  ```

### 5. `cancel`
Cancels an active switch, rendering it inactive permanently.
- **Input JSON:**
  ```json
  {
    "switchId": "string"
  }
  ```

### 6. `get_status`
Fetches current status details and remaining countdown duration.
- **Input JSON:**
  ```json
  {
    "switchId": "string",
    "clockOffset": 0
  }
  ```

---

## 🛠️ Building the WASM Target

To compile the contract to the WebAssembly target required by the host runner:

1. Ensure the Rust WASM target is installed:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```
2. Compile the release bundle:
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```
3. Copy the compiled contract WASM binary to the Next.js runtime library directory:
   ```bash
   cp target/wasm32-unknown-unknown/release/epoch_contract.wasm ../src/lib/
   ```
