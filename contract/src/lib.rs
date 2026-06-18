use serde::{Deserialize, Serialize};
use std::slice;
use hmac::{Hmac, Mac};
use sha2::Sha256;

// Import T3 ADK Host APIs
#[cfg(not(test))]
extern "C" {
    fn host_kv_store_get(key_ptr: *const u8, key_len: usize, val_buf_ptr: *mut u8, val_buf_len: usize) -> i32;
    fn host_kv_store_set(key_ptr: *const u8, key_len: usize, val_ptr: *const u8, val_len: usize) -> i32;
    fn host_clock_now() -> u64;
    // NOTE: the Switch Coordinator no longer performs egress directly — the
    // privacy-blind http-with-placeholders dispatch is delegated to the Egress
    // Dispatcher contract via `host_contracts_call` (see fire_epoch).
    fn host_signing_issue_vc(
        subject_ptr: *const u8, subject_len: usize,
        claims_ptr: *const u8, claims_len: usize,
        vc_buf_ptr: *mut u8, vc_buf_len: usize
    ) -> i32;
    fn host_logging_log(msg_ptr: *const u8, msg_len: usize);
    fn host_stash_put(
        data_ptr: *const u8, data_len: usize,
        ref_buf_ptr: *mut u8, ref_buf_len: usize
    ) -> i32;
    fn host_stash_get(
        ref_ptr: *const u8, ref_len: usize,
        data_buf_ptr: *mut u8, data_buf_len: usize
    ) -> i32;
    // Synchronous TEE cross-contract call: invoke another enclave contract
    // (the Egress Dispatcher) and receive its JSON result in a single tx.
    fn host_contracts_call(
        contract_ptr: *const u8, contract_len: usize,
        fn_ptr: *const u8, fn_len: usize,
        payload_ptr: *const u8, payload_len: usize,
        res_buf_ptr: *mut u8, res_buf_len: usize
    ) -> i32;
    // Durable, at-least-once outbox enqueue keyed by an idempotency key (idk).
    fn host_outbox_enqueue(
        idk_ptr: *const u8, idk_len: usize,
        payload_ptr: *const u8, payload_len: usize
    ) -> i32;
}


use std::alloc::{alloc as rust_alloc, dealloc as rust_dealloc, Layout};

// Memory Allocation API for Wasm/JS Boundary
#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let align = std::mem::align_of::<u8>();
    let layout = Layout::from_size_align(size, align).unwrap();
    unsafe { rust_alloc(layout) }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    let align = std::mem::align_of::<u8>();
    let layout = Layout::from_size_align(size, align).unwrap();
    unsafe { rust_dealloc(ptr, layout) }
}

// Helper: Pack Rust String into u64 pointer/length
#[cfg(not(test))]
fn return_string(s: String) -> u64 {
    let len = s.len();
    let ptr = alloc(len);
    unsafe {
        std::ptr::copy_nonoverlapping(s.as_ptr(), ptr, len);
    }
    ((ptr as u64) << 32) | (len as u64)
}

#[cfg(test)]
thread_local! {
    pub static LAST_RETURNED_STRING: std::cell::RefCell<String> = std::cell::RefCell::new(String::new());
}

#[cfg(test)]
fn return_string(s: String) -> u64 {
    let len = s.len() as u64;
    LAST_RETURNED_STRING.with(|cell| {
        *cell.borrow_mut() = s;
    });
    len
}




// Helper: Read input from Wasm memory pointer/length
unsafe fn get_input_string(ptr: *const u8, len: usize) -> String {
    let slice = slice::from_raw_parts(ptr, len);
    String::from_utf8_lossy(slice).into_owned()
}

// Host API wrappers
fn kv_get(key: &str) -> Option<String> {
    let mut buf = vec![0u8; 8192];
    let res = unsafe {
        host_kv_store_get(
            key.as_ptr(), key.len(),
            buf.as_mut_ptr(), buf.len()
        )
    };
    if res >= 0 {
        buf.truncate(res as usize);
        String::from_utf8(buf).ok()
    } else {
        None
    }
}

fn kv_set(key: &str, val: &str) -> bool {
    let res = unsafe {
        host_kv_store_set(
            key.as_ptr(), key.len(),
            val.as_ptr(), val.len()
        )
    };
    res == 0
}

fn get_now() -> u64 {
    unsafe { host_clock_now() }
}

fn log(msg: &str) {
    unsafe { host_logging_log(msg.as_ptr(), msg.len()) }
}

fn stash_put(data: &[u8]) -> Option<String> {
    let mut ref_buf = vec![0u8; 1024];
    let res = unsafe {
        host_stash_put(
            data.as_ptr(), data.len(),
            ref_buf.as_mut_ptr(), ref_buf.len()
        )
    };
    if res >= 0 {
        ref_buf.truncate(res as usize);
        String::from_utf8(ref_buf).ok()
    } else {
        None
    }
}

fn stash_get(reference: &str) -> Option<Vec<u8>> {
    let mut buf = vec![0u8; 65536];
    let res = unsafe {
        host_stash_get(
            reference.as_ptr(), reference.len(),
            buf.as_mut_ptr(), buf.len()
        )
    };
    if res >= 0 {
        buf.truncate(res as usize);
        Some(buf)
    } else {
        None
    }
}

// Invoke a sibling enclave contract synchronously within the same TEE tx.
fn contracts_call(contract: &str, function: &str, payload: &str) -> Option<String> {
    let mut buf = vec![0u8; 8192];
    let res = unsafe {
        host_contracts_call(
            contract.as_ptr(), contract.len(),
            function.as_ptr(), function.len(),
            payload.as_ptr(), payload.len(),
            buf.as_mut_ptr(), buf.len()
        )
    };
    if res >= 0 {
        buf.truncate(res as usize);
        String::from_utf8(buf).ok()
    } else {
        None
    }
}

// Durably enqueue an event for at-least-once downstream delivery.
fn outbox_enqueue(idk: &str, payload: &str) -> bool {
    let res = unsafe {
        host_outbox_enqueue(idk.as_ptr(), idk.len(), payload.as_ptr(), payload.len())
    };
    res == 0
}

// Struct Definitions
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct SwitchState {
    id: String,
    grace_period: u64, // in milliseconds
    last_heartbeat: u64, // monotonic timestamp
    status: String, // "active", "expired", "fired", "cancelled"
    beneficiaries: Vec<String>,
    otp_secret: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultState {
    stash_refs: Vec<String>,
    encrypted_keys: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ArmRequest {
    switch_id: String,
    grace_period: u64,
    beneficiaries: Vec<String>,
    stash_refs: Vec<String>,
    encrypted_keys: String,
    otp_secret: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct HeartbeatRequest {
    switch_id: String,
    otp_code: String,
    clock_offset: Option<u64>, // debug/test time-warp offset
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct TriggerCheckRequest {
    switch_id: String,
    clock_offset: Option<u64>, // debug/test time-warp offset
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct FireRequest {
    switch_id: String,
    mock_failure_step: Option<u32>, // debug rollback test
}

// Base32 Decoder for standard TOTP secrets
fn decode_base32(s: &str) -> Option<Vec<u8>> {
    let s = s.trim().to_uppercase().replace(" ", "");
    let mut bytes = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits_left = 0;
    for c in s.chars() {
        if c == '=' { break; }
        let val = match c {
            'A'..='Z' => c as u8 - b'A',
            '2'..='7' => c as u8 - b'2' + 26,
            _ => return None,
        };
        buffer = (buffer << 5) | val as u32;
        bits_left += 5;
        if bits_left >= 8 {
            bytes.push((buffer >> (bits_left - 8)) as u8);
            bits_left -= 8;
        }
    }
    Some(bytes)
}

// HMAC-SHA256 TOTP calculation
fn calculate_totp_sha256(secret: &str, counter: u64) -> String {
    let key = match decode_base32(secret) {
        Some(k) => k,
        None => secret.as_bytes().to_vec(),
    };
    
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
    mac.update(&counter.to_be_bytes());
    let result = mac.finalize().into_bytes();
    
    let offset = (result[result.len() - 1] & 0xf) as usize;
    let binary = ((result[offset] & 0x7f) as u32) << 24
               | ((result[offset + 1] & 0xff) as u32) << 16
               | ((result[offset + 2] & 0xff) as u32) << 8
               | ((result[offset + 3] & 0xff) as u32);
               
    let otp = binary % 1000000;
    format!("{:06}", otp)
}

fn verify_totp(secret: &str, code_to_check: &str, time_ms: u64) -> bool {
    let step = time_ms / 30000; // 30 second steps
    // Check window of current, previous, and next counter steps
    for i in -1..=1 {
        let counter = (step as i64 + i) as u64;
        let calculated = calculate_totp_sha256(secret, counter);
        if calculated == code_to_check {
            return true;
        }
    }
    false
}

// CONTRACT EXPORTS

#[no_mangle]
pub unsafe extern "C" fn arm_switch(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    log(&format!("Rust arm_switch: input={}", input));
    
    let req: ArmRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"error":"Invalid payload: {}"}}"#, e)),
    };
    
    let now = get_now();
    let switch_key = format!("epoch:switch:{}", req.switch_id);
    let vault_key = format!("epoch:vault:{}", req.switch_id);
    
    let switch_state = SwitchState {
        id: req.switch_id.clone(),
        grace_period: req.grace_period,
        last_heartbeat: now,
        status: "active".to_string(),
        beneficiaries: req.beneficiaries,
        otp_secret: req.otp_secret,
    };
    
    let vault_state = VaultState {
        stash_refs: req.stash_refs,
        encrypted_keys: req.encrypted_keys,
    };
    
    let switch_json = serde_json::to_string(&switch_state).unwrap();
    let vault_json = serde_json::to_string(&vault_state).unwrap();
    
    kv_set(&switch_key, &switch_json);
    kv_set(&vault_key, &vault_json);
    
    let response = serde_json::json!({
        "success": true,
        "switchId": req.switch_id,
        "status": "active",
        "lastHeartbeat": now,
        "nextHeartbeatRequiredBy": now + req.grace_period
    });
    
    return_string(response.to_string())
}

#[no_mangle]
pub unsafe extern "C" fn heartbeat(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    log(&format!("Rust heartbeat: input={}", input));
    
    let req: HeartbeatRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"error":"Invalid payload: {}"}}"#, e)),
    };
    
    let switch_key = format!("epoch:switch:{}", req.switch_id);
    let switch_data = match kv_get(&switch_key) {
        Some(data) => data,
        None => return return_string(r#"{"error":"Switch not found"}"#.to_string()),
    };
    
    let mut state: SwitchState = serde_json::from_str(&switch_data).unwrap();
    if state.status == "fired" || state.status == "cancelled" {
        return return_string(format!(r#"{{"error":"Cannot send heartbeat to a {} switch"}}"#, state.status));
    }
    
    let now = get_now() + req.clock_offset.unwrap_or(0);
    
    // Verify OTP code
    let is_valid = verify_totp(&state.otp_secret, &req.otp_code, now);
    if !is_valid {
        return return_string(r#"{"error":"Invalid OTP code"}"#.to_string());
    }
    
    // Reset heartbeat timer
    state.last_heartbeat = now;
    state.status = "active".to_string();
    
    let updated_json = serde_json::to_string(&state).unwrap();
    kv_set(&switch_key, &updated_json);
    
    let response = serde_json::json!({
        "success": true,
        "switchId": state.id,
        "status": "active",
        "lastHeartbeat": now,
        "nextHeartbeatRequiredBy": now + state.grace_period
    });
    
    return_string(response.to_string())
}

#[no_mangle]
pub unsafe extern "C" fn check_trigger(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    log(&format!("Rust check_trigger: input={}", input));
    
    let req: TriggerCheckRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"error":"Invalid payload: {}"}}"#, e)),
    };
    
    let switch_key = format!("epoch:switch:{}", req.switch_id);
    let switch_data = match kv_get(&switch_key) {
        Some(data) => data,
        None => return return_string(r#"{"error":"Switch not found"}"#.to_string()),
    };
    
    let mut state: SwitchState = serde_json::from_str(&switch_data).unwrap();
    let now = get_now() + req.clock_offset.unwrap_or(0);
    
    let elapsed = now.saturating_sub(state.last_heartbeat);
    let expired = elapsed > state.grace_period;
    
    if expired && state.status == "active" {
        state.status = "expired".to_string();
        let updated_json = serde_json::to_string(&state).unwrap();
        kv_set(&switch_key, &updated_json);
    }
    
    let time_left = state.grace_period.saturating_sub(elapsed);
    
    let response = serde_json::json!({
        "switchId": state.id,
        "status": state.status,
        "elapsed": elapsed,
        "gracePeriod": state.grace_period,
        "timeLeft": time_left,
        "expired": expired || state.status == "expired" || state.status == "fired"
    });
    
    return_string(response.to_string())
}

#[no_mangle]
pub unsafe extern "C" fn fire_epoch(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    log(&format!("Rust fire_epoch: input={}", input));
    
    let req: FireRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"error":"Invalid payload: {}"}}"#, e)),
    };
    
    let switch_key = format!("epoch:switch:{}", req.switch_id);
    let vault_key = format!("epoch:vault:{}", req.switch_id);
    
    let switch_data = match kv_get(&switch_key) {
        Some(data) => data,
        None => return return_string(r#"{"error":"Switch not found"}"#.to_string()),
    };
    
    let vault_data = match kv_get(&vault_key) {
        Some(data) => data,
        None => return return_string(r#"{"error":"Vault not found"}"#.to_string()),
    };
    
    let mut switch_state: SwitchState = serde_json::from_str(&switch_data).unwrap();
    let vault_state: VaultState = serde_json::from_str(&vault_data).unwrap();
    
    // Switch must be expired to trigger
    if switch_state.status != "expired" {
        return return_string(format!(r#"{{"error":"Switch status is {} — cannot fire until expired"}}"#, switch_state.status));
    }
    
    log("Beginning digital legacy cascade execution...");
    
    // Verify and retrieve files from stash
    let mut retrieved_files = Vec::new();
    for ref_str in &vault_state.stash_refs {
        if let Some(data) = stash_get(ref_str) {
            log(&format!("Successfully retrieved file {} from stash (size: {} bytes)", ref_str, data.len()));
            retrieved_files.push(serde_json::json!({
                "ref": ref_str,
                "size": data.len(),
                "status": "retrieved"
            }));
        } else {
            log(&format!("Warning: failed to retrieve file {} from stash", ref_str));
            retrieved_files.push(serde_json::json!({
                "ref": ref_str,
                "status": "not_found"
            }));
        }
    }
    
    // ── Atomic blind-egress sub-transaction via contracts-call ──
    // The Switch Coordinator delegates the actual PII-blind egress to the Egress
    // Dispatcher ("Blind Courier") contract through a synchronous TEE cross-contract
    // call. The whole cascade is atomic: if the Courier reports ANY failed delivery,
    // we abort here WITHOUT marking the switch fired, issuing a VC, or enqueuing to
    // the durable outbox — so the vault keys stay sealed.
    let dispatch_payload = serde_json::json!({
        "beneficiaries": switch_state.beneficiaries,
        "legacyHash": "0x3b18cf983bd7088998aa90c8b323c6f14028bc",
        "mockFailureStep": req.mock_failure_step
    }).to_string();

    let courier_raw = match contracts_call("epoch-executor", "execute_dispatch", &dispatch_payload) {
        Some(r) => r,
        None => {
            log("contracts-call to Egress Dispatcher failed at host boundary");
            let rollback_res = serde_json::json!({
                "success": false,
                "error": "ROLLBACK TRIGGERED: cross-contract egress dispatch unreachable.",
                "reverted": true,
                "switchStatus": "expired"
            });
            return return_string(rollback_res.to_string());
        }
    };

    let courier: serde_json::Value = serde_json::from_str(&courier_raw)
        .unwrap_or_else(|_| serde_json::json!({ "success": false, "error": "malformed courier response" }));

    if courier["success"] != serde_json::Value::Bool(true) {
        // Atomic abort: the Courier failed → revert. Switch stays "expired".
        let failed_step = courier.get("failedStep").cloned().unwrap_or(serde_json::Value::Null);
        let inner_err = courier.get("error").and_then(|e| e.as_str()).unwrap_or("downstream target failed");
        log(&format!("Egress Dispatcher reported failure — rolling back: {}", inner_err));
        let rollback_res = serde_json::json!({
            "success": false,
            "error": format!("ROLLBACK TRIGGERED: {}", inner_err),
            "failedStep": failed_step,
            "reverted": true,
            "switchStatus": "expired"
        });
        return return_string(rollback_res.to_string());
    }

    // Delivered set returned by the Egress Dispatcher contract.
    let step_results = courier.get("delivered").cloned().unwrap_or_else(|| serde_json::json!([]));

    // If the cross-contract dispatch succeeded, generate signed VC receipt
    let subject = format!("did:t3n:{}", switch_state.id);
    let claims = serde_json::json!({
        "switchId": switch_state.id,
        "firedAt": get_now(),
        "deliveredBeneficiaries": switch_state.beneficiaries,
        "releasedStashKeys": vault_state.encrypted_keys
    }).to_string();
    
    let mut vc_buf = vec![0u8; 4096];
    let vc_res = host_signing_issue_vc(
        subject.as_ptr(), subject.len(),
        claims.as_ptr(), claims.len(),
        vc_buf.as_mut_ptr(), vc_buf.len()
    );
    
    let vc_receipt = if vc_res >= 0 {
        vc_buf.truncate(vc_res as usize);
        String::from_utf8(vc_buf).unwrap_or("".to_string())
    } else {
        "".to_string()
    };
    
    // Create an audit log manifest and store it to stash
    let audit_manifest = serde_json::json!({
        "switchId": switch_state.id,
        "firedAt": get_now(),
        "beneficiaries": switch_state.beneficiaries,
        "vaultStashRefs": vault_state.stash_refs,
        "encryptedKeys": vault_state.encrypted_keys
    }).to_string();

    let release_log_ref = match stash_put(audit_manifest.as_bytes()) {
        Some(s_ref) => {
            log(&format!("Successfully uploaded release audit manifest to stash: {}", s_ref));
            s_ref
        }
        None => {
            log("Warning: failed to upload release audit manifest to stash");
            "".to_string()
        }
    };
    
    // Durably enqueue the release event so downstream auditors are notified
    // exactly-once even across host restarts (idempotency key = switch + firedAt).
    let outbox_idk = format!("epoch-release-{}-{}", switch_state.id, get_now());
    let outbox_payload = serde_json::json!({
        "event": "legacy.released",
        "switchId": switch_state.id,
        "beneficiaryCount": switch_state.beneficiaries.len(),
        "releaseLogStashRef": release_log_ref
    }).to_string();
    let outbox_enqueued = outbox_enqueue(&outbox_idk, &outbox_payload);
    log(&format!("Outbox enqueue (idk={}) durable={}", outbox_idk, outbox_enqueued));

    // Save state as fired
    switch_state.status = "fired".to_string();
    let updated_json = serde_json::to_string(&switch_state).unwrap();
    kv_set(&switch_key, &updated_json);

    let response = serde_json::json!({
        "success": true,
        "switchId": switch_state.id,
        "status": "fired",
        "stepsExecuted": step_results,
        "vcReceipt": vc_receipt,
        "decryptedKeys": vault_state.encrypted_keys,
        "retrievedFiles": retrieved_files,
        "releaseLogStashRef": release_log_ref,
        "outboxEnqueued": outbox_enqueued
    });

    return_string(response.to_string())
}

#[no_mangle]
pub unsafe extern "C" fn cancel(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    
    let req: TriggerCheckRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"error":"Invalid payload: {}"}}"#, e)),
    };
    
    let switch_key = format!("epoch:switch:{}", req.switch_id);
    let switch_data = match kv_get(&switch_key) {
        Some(data) => data,
        None => return return_string(r#"{"error":"Switch not found"}"#.to_string()),
    };
    
    let mut state: SwitchState = serde_json::from_str(&switch_data).unwrap();
    if state.status == "fired" {
        return return_string(r#"{"error":"Cannot cancel a fired switch"}"#.to_string());
    }
    
    state.status = "cancelled".to_string();
    let updated_json = serde_json::to_string(&state).unwrap();
    kv_set(&switch_key, &updated_json);
    
    let response = serde_json::json!({
        "success": true,
        "switchId": state.id,
        "status": "cancelled"
    });
    
    return_string(response.to_string())
}

#[no_mangle]
pub unsafe extern "C" fn get_status(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    
    let req: TriggerCheckRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"error":"Invalid payload: {}"}}"#, e)),
    };
    
    let switch_key = format!("epoch:switch:{}", req.switch_id);
    let switch_data = match kv_get(&switch_key) {
        Some(data) => data,
        None => return return_string(r#"{"error":"Switch not found"}"#.to_string()),
    };
    
    let state: SwitchState = serde_json::from_str(&switch_data).unwrap();
    let now = get_now() + req.clock_offset.unwrap_or(0);
    let elapsed = now.saturating_sub(state.last_heartbeat);
    let time_left = state.grace_period.saturating_sub(elapsed);
    
    let response = serde_json::json!({
        "switchId": state.id,
        "status": state.status,
        "elapsed": elapsed,
        "gracePeriod": state.grace_period,
        "timeLeft": time_left,
        "lastHeartbeat": state.last_heartbeat
    });
    
    return_string(response.to_string())
}

// ─── UNIT TESTS & MOCKS FOR NATIVE CARGO TEST ──────────────────────────────────

#[cfg(test)]
mod mock_state {
    use std::cell::RefCell;
    use std::collections::HashMap;

    pub struct State {
        pub kv: HashMap<String, String>,
        pub stash: HashMap<String, Vec<u8>>,
        pub now: u64,
        pub http_fail: bool,
        pub vc_fail: bool,
        pub outbox_count: u32,
    }

    thread_local! {
        pub static STATE: RefCell<State> = RefCell::new(State {
            kv: HashMap::new(),
            stash: HashMap::new(),
            now: 1729600000000,
            http_fail: false,
            vc_fail: false,
            outbox_count: 0,
        });
    }
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_kv_store_get(key_ptr: *const u8, key_len: usize, val_buf_ptr: *mut u8, val_buf_len: usize) -> i32 {
    let key_slice = std::slice::from_raw_parts(key_ptr, key_len);
    let key = std::str::from_utf8(key_slice).unwrap();
    mock_state::STATE.with(|state| {
        let state = state.borrow();
        if let Some(val) = state.kv.get(key) {
            let val_bytes = val.as_bytes();
            if val_bytes.len() <= val_buf_len {
                std::ptr::copy_nonoverlapping(val_bytes.as_ptr(), val_buf_ptr, val_bytes.len());
                val_bytes.len() as i32
            } else {
                -1
            }
        } else {
            -1
        }
    })
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_kv_store_set(key_ptr: *const u8, key_len: usize, val_ptr: *const u8, val_len: usize) -> i32 {
    let key_slice = std::slice::from_raw_parts(key_ptr, key_len);
    let key = std::str::from_utf8(key_slice).unwrap().to_string();
    let val_slice = std::slice::from_raw_parts(val_ptr, val_len);
    let val = std::str::from_utf8(val_slice).unwrap().to_string();
    mock_state::STATE.with(|state| {
        state.borrow_mut().kv.insert(key, val);
    });
    0
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_clock_now() -> u64 {
    mock_state::STATE.with(|state| state.borrow().now)
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_signing_issue_vc(
    _subject_ptr: *const u8, _subject_len: usize,
    _claims_ptr: *const u8, _claims_len: usize,
    vc_buf_ptr: *mut u8, vc_buf_len: usize
) -> i32 {
    let vc_fail = mock_state::STATE.with(|state| state.borrow().vc_fail);
    if vc_fail {
        -1
    } else {
        let vc = r#"{"jwt":"mock-vc-token"}"#.as_bytes();
        if vc.len() <= vc_buf_len {
            std::ptr::copy_nonoverlapping(vc.as_ptr(), vc_buf_ptr, vc.len());
            vc.len() as i32
        } else {
            -1
        }
    }
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_logging_log(msg_ptr: *const u8, msg_len: usize) {
    let slice = std::slice::from_raw_parts(msg_ptr, msg_len);
    let msg = std::str::from_utf8(slice).unwrap();
    println!("[Enclave Log] {}", msg);
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_stash_put(
    data_ptr: *const u8, data_len: usize,
    ref_buf_ptr: *mut u8, ref_buf_len: usize
) -> i32 {
    let data_slice = std::slice::from_raw_parts(data_ptr, data_len);
    let data = data_slice.to_vec();
    
    use sha2::Digest;
    let hash = format!("{:x}", sha2::Sha256::digest(&data));
    let reference = format!("stash://ref-{}", &hash[0..8]);
    
    let ref_bytes = reference.as_bytes();
    if ref_bytes.len() <= ref_buf_len {
        std::ptr::copy_nonoverlapping(ref_bytes.as_ptr(), ref_buf_ptr, ref_bytes.len());
        mock_state::STATE.with(|state| {
            state.borrow_mut().stash.insert(reference.clone(), data);
        });
        ref_bytes.len() as i32
    } else {
        -1
    }
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_stash_get(
    ref_ptr: *const u8, ref_len: usize,
    data_buf_ptr: *mut u8, data_buf_len: usize
) -> i32 {
    let ref_slice = std::slice::from_raw_parts(ref_ptr, ref_len);
    let reference = std::str::from_utf8(ref_slice).unwrap();
    mock_state::STATE.with(|state| {
        let state = state.borrow();
        if let Some(data) = state.stash.get(reference) {
            if data.len() <= data_buf_len {
                std::ptr::copy_nonoverlapping(data.as_ptr(), data_buf_ptr, data.len());
                data.len() as i32
            } else {
                -1
            }
        } else {
            -1
        }
    })
}

// Mock the synchronous cross-contract call by emulating the Egress Dispatcher's
// execute_dispatch logic against the shared mock host state.
#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_contracts_call(
    _contract_ptr: *const u8, _contract_len: usize,
    _fn_ptr: *const u8, _fn_len: usize,
    payload_ptr: *const u8, payload_len: usize,
    res_buf_ptr: *mut u8, res_buf_len: usize
) -> i32 {
    let payload_slice = std::slice::from_raw_parts(payload_ptr, payload_len);
    let payload = std::str::from_utf8(payload_slice).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(payload).unwrap_or(serde_json::json!({}));
    let beneficiaries = parsed["beneficiaries"].as_array().cloned().unwrap_or_default();
    let mock_failure_step = parsed["mockFailureStep"].as_u64();
    let http_fail = mock_state::STATE.with(|s| s.borrow().http_fail);

    let mut delivered: Vec<serde_json::Value> = Vec::new();
    let mut out = serde_json::json!({ "success": true, "egressCount": 0, "delivered": [] });
    let mut failed = false;

    for (idx, b) in beneficiaries.iter().enumerate() {
        let step = (idx + 1) as u64;
        if http_fail || mock_failure_step == Some(step) {
            out = serde_json::json!({
                "success": false,
                "error": "Downstream beneficiary target rejected delivery.",
                "failedStep": step,
                "delivered": delivered
            });
            failed = true;
            break;
        }
        delivered.push(serde_json::json!({ "target": b, "status": "delivered" }));
    }

    if !failed {
        out = serde_json::json!({
            "success": true,
            "egressCount": delivered.len(),
            "delivered": delivered
        });
    }

    let s = out.to_string();
    let bytes = s.as_bytes();
    if bytes.len() <= res_buf_len {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), res_buf_ptr, bytes.len());
        bytes.len() as i32
    } else {
        -1
    }
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_outbox_enqueue(
    _idk_ptr: *const u8, _idk_len: usize,
    _payload_ptr: *const u8, _payload_len: usize
) -> i32 {
    mock_state::STATE.with(|s| s.borrow_mut().outbox_count += 1);
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_state() {
        mock_state::STATE.with(|state| {
            let mut s = state.borrow_mut();
            s.kv.clear();
            s.stash.clear();
            s.now = 1729600000000;
            s.http_fail = false;
            s.vc_fail = false;
            s.outbox_count = 0;
        });
        LAST_RETURNED_STRING.with(|cell| {
            *cell.borrow_mut() = String::new();
        });
    }

    unsafe fn run_arm_switch(req: &serde_json::Value) -> serde_json::Value {
        let input_str = req.to_string();
        let _len = arm_switch(input_str.as_ptr(), input_str.len());
        let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
        serde_json::from_str(&out_str).unwrap()
    }

    unsafe fn run_heartbeat(req: &serde_json::Value) -> serde_json::Value {
        let input_str = req.to_string();
        let _len = heartbeat(input_str.as_ptr(), input_str.len());
        let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
        serde_json::from_str(&out_str).unwrap()
    }

    unsafe fn run_check_trigger(req: &serde_json::Value) -> serde_json::Value {
        let input_str = req.to_string();
        let _len = check_trigger(input_str.as_ptr(), input_str.len());
        let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
        serde_json::from_str(&out_str).unwrap()
    }

    unsafe fn run_fire_epoch(req: &serde_json::Value) -> serde_json::Value {
        let input_str = req.to_string();
        let _len = fire_epoch(input_str.as_ptr(), input_str.len());
        let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
        serde_json::from_str(&out_str).unwrap()
    }

    unsafe fn run_cancel(req: &serde_json::Value) -> serde_json::Value {
        let input_str = req.to_string();
        let _len = cancel(input_str.as_ptr(), input_str.len());
        let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
        serde_json::from_str(&out_str).unwrap()
    }

    unsafe fn run_get_status(req: &serde_json::Value) -> serde_json::Value {
        let input_str = req.to_string();
        let _len = get_status(input_str.as_ptr(), input_str.len());
        let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
        serde_json::from_str(&out_str).unwrap()
    }

    #[test]
    fn test_arm_switch_invalid_json() {
        reset_state();
        unsafe {
            let req = "invalid json";
            let _len = arm_switch(req.as_ptr(), req.len());
            let out_str = LAST_RETURNED_STRING.with(|cell| cell.borrow().clone());
            let res: serde_json::Value = serde_json::from_str(&out_str).unwrap();
            assert!(res["error"].as_str().unwrap().contains("Invalid payload"));
        }
    }

    #[test]
    fn test_arm_switch_and_get_status() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======" // TOTP secret "hello"
            });
            let res = run_arm_switch(&arm_req);
            assert_eq!(res["success"], true);
            assert_eq!(res["status"], "active");

            let status_req = serde_json::json!({ "switchId": "test-switch" });
            let status = run_get_status(&status_req);
            assert_eq!(status["switchId"], "test-switch");
            assert_eq!(status["status"], "active");
            assert_eq!(status["timeLeft"], 1000);
        }
    }

    #[test]
    fn test_heartbeat_invalid_otp() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let hb_req = serde_json::json!({
                "switchId": "test-switch",
                "otpCode": "000000"
            });
            let res = run_heartbeat(&hb_req);
            assert_eq!(res["error"], "Invalid OTP code");
        }
    }

    #[test]
    fn test_heartbeat_valid_otp() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 100000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======" // "hello" base32
            });
            run_arm_switch(&arm_req);

            let now = mock_state::STATE.with(|state| state.borrow().now);
            let counter = now / 30000;
            let valid_code = calculate_totp_sha256("NBSWY3DPEB3W64TBNQ======", counter);

            let hb_req = serde_json::json!({
                "switchId": "test-switch",
                "otpCode": valid_code
            });
            let res = run_heartbeat(&hb_req);
            assert_eq!(res["success"], true);
        }
    }

    #[test]
    fn test_check_trigger_expiration() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            let res = run_check_trigger(&trigger_req);
            assert_eq!(res["status"], "expired");
            assert_eq!(res["expired"], true);
        }
    }

    #[test]
    fn test_stash_direct() {
        reset_state();
        let payload = b"direct-stash-test-payload";
        let ref_id = stash_put(payload).unwrap();
        assert!(ref_id.starts_with("stash://ref-"));
        
        let retrieved = stash_get(&ref_id).unwrap();
        assert_eq!(retrieved, payload.to_vec());
        
        let non_existent = stash_get("stash://ref-nonexistent");
        assert!(non_existent.is_none());
    }

    #[test]
    fn test_fire_success() {
        reset_state();
        unsafe {
            mock_state::STATE.with(|state| {
                state.borrow_mut().stash.insert("ref-1".to_string(), b"legacy-vault-payload".to_vec());
            });

            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["success"], true);
            assert_eq!(res["status"], "fired");
            assert_eq!(res["decryptedKeys"], "secret-keys");
            assert_eq!(res["retrievedFiles"][0]["ref"], "ref-1");
            assert_eq!(res["retrievedFiles"][0]["size"], 20);
            assert_eq!(res["retrievedFiles"][0]["status"], "retrieved");
            assert!(res["releaseLogStashRef"].as_str().unwrap().starts_with("stash://ref-"));
            // Egress was performed via the cross-contract dispatcher.
            assert_eq!(res["stepsExecuted"][0]["status"], "delivered");
            // Release event was durably enqueued to the outbox exactly once.
            assert_eq!(res["outboxEnqueued"], true);
            let outbox_count = mock_state::STATE.with(|s| s.borrow().outbox_count);
            assert_eq!(outbox_count, 1);
        }
    }

    #[test]
    fn test_fire_rollback_skips_outbox() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({ "switchId": "test-switch", "clockOffset": 1500 });
            run_check_trigger(&trigger_req);

            // Force the cross-contract dispatch to fail on the first beneficiary.
            let fire_req = serde_json::json!({ "switchId": "test-switch", "mockFailureStep": 1 });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["success"], false);
            assert_eq!(res["reverted"], true);
            assert_eq!(res["failedStep"], 1);

            // Atomicity: no durable outbox enqueue happened on rollback.
            let outbox_count = mock_state::STATE.with(|s| s.borrow().outbox_count);
            assert_eq!(outbox_count, 0);

            // Switch was NOT marked fired — keys stay sealed.
            let switch_json = mock_state::STATE.with(|s| s.borrow().kv.get("epoch:switch:test-switch").cloned().unwrap());
            let state: SwitchState = serde_json::from_str(&switch_json).unwrap();
            assert_eq!(state.status, "expired");
        }
    }

    #[test]
    fn test_fire_rollback_mock() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            let fire_req = serde_json::json!({
                "switchId": "test-switch",
                "mockFailureStep": 1
            });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["success"], false);
            assert_eq!(res["reverted"], true);
            assert_eq!(res["failedStep"], 1);
        }
    }

    #[test]
    fn test_fire_http_fail() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            mock_state::STATE.with(|state| state.borrow_mut().http_fail = true);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["success"], false);
            assert_eq!(res["reverted"], true);
        }
    }

    #[test]
    fn test_cancel_switch() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let cancel_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_cancel(&cancel_req);
            assert_eq!(res["success"], true);
            assert_eq!(res["status"], "cancelled");
        }
    }

    #[test]
    fn test_alloc_and_dealloc() {
        let ptr = alloc(128);
        assert!(!ptr.is_null());
        dealloc(ptr, 128);
    }

    #[test]
    fn test_totp_fallback_invalid_base32() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 100000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "invalid!secret!with!special!chars"
            });
            run_arm_switch(&arm_req);

            let now = mock_state::STATE.with(|state| state.borrow().now);
            let counter = now / 30000;
            let valid_code = calculate_totp_sha256("invalid!secret!with!special!chars", counter);

            let hb_req = serde_json::json!({
                "switchId": "test-switch",
                "otpCode": valid_code
            });
            let res = run_heartbeat(&hb_req);
            assert_eq!(res["success"], true);
        }
    }

    #[test]
    fn test_invalid_payloads_parsing() {
        reset_state();
        unsafe {
            let invalid = "invalid json";
            
            // heartbeat invalid payload
            let _hb_ptr_len = heartbeat(invalid.as_ptr(), invalid.len());
            let res_hb: serde_json::Value = serde_json::from_str(&LAST_RETURNED_STRING.with(|c| c.borrow().clone())).unwrap();
            assert!(res_hb["error"].as_str().unwrap().contains("Invalid payload"));

            // check_trigger invalid payload
            let _check_ptr_len = check_trigger(invalid.as_ptr(), invalid.len());
            let res_check: serde_json::Value = serde_json::from_str(&LAST_RETURNED_STRING.with(|c| c.borrow().clone())).unwrap();
            assert!(res_check["error"].as_str().unwrap().contains("Invalid payload"));

            // fire_epoch invalid payload
            let _fire_ptr_len = fire_epoch(invalid.as_ptr(), invalid.len());
            let res_fire: serde_json::Value = serde_json::from_str(&LAST_RETURNED_STRING.with(|c| c.borrow().clone())).unwrap();
            assert!(res_fire["error"].as_str().unwrap().contains("Invalid payload"));

            // cancel invalid payload
            let _cancel_ptr_len = cancel(invalid.as_ptr(), invalid.len());
            let res_cancel: serde_json::Value = serde_json::from_str(&LAST_RETURNED_STRING.with(|c| c.borrow().clone())).unwrap();
            assert!(res_cancel["error"].as_str().unwrap().contains("Invalid payload"));

            // get_status invalid payload
            let _status_ptr_len = get_status(invalid.as_ptr(), invalid.len());
            let res_status: serde_json::Value = serde_json::from_str(&LAST_RETURNED_STRING.with(|c| c.borrow().clone())).unwrap();
            assert!(res_status["error"].as_str().unwrap().contains("Invalid payload"));
        }
    }

    #[test]
    fn test_switch_not_found_errors() {
        reset_state();
        unsafe {
            let req = serde_json::json!({ "switchId": "nonexistent" });
            let hb_req = serde_json::json!({ "switchId": "nonexistent", "otpCode": "000000" });

            let res_hb = run_heartbeat(&hb_req);
            assert_eq!(res_hb["error"], "Switch not found");

            let res_check = run_check_trigger(&req);
            assert_eq!(res_check["error"], "Switch not found");

            let res_fire = run_fire_epoch(&req);
            assert_eq!(res_fire["error"], "Switch not found");

            let res_cancel = run_cancel(&req);
            assert_eq!(res_cancel["error"], "Switch not found");

            let res_status = run_get_status(&req);
            assert_eq!(res_status["error"], "Switch not found");
        }
    }

    #[test]
    fn test_vault_not_found_error() {
        reset_state();
        unsafe {
            // Seed a switch but manually remove the vault key from KV store to mock missing vault
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            mock_state::STATE.with(|state| {
                state.borrow_mut().kv.remove("epoch:vault:test-switch");
            });

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["error"], "Vault not found");
        }
    }

    #[test]
    fn test_heartbeat_cancelled_or_fired_switch() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            // Cancel switch
            let cancel_req = serde_json::json!({ "switchId": "test-switch" });
            run_cancel(&cancel_req);

            // Heartbeat check on cancelled switch
            let hb_req = serde_json::json!({ "switchId": "test-switch", "otpCode": "000000" });
            let res_hb_cancel = run_heartbeat(&hb_req);
            assert_eq!(res_hb_cancel["error"], "Cannot send heartbeat to a cancelled switch");

            // Reset and fire switch
            reset_state();
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            run_fire_epoch(&fire_req);

            // Heartbeat check on fired switch
            let res_hb_fired = run_heartbeat(&hb_req);
            assert_eq!(res_hb_fired["error"], "Cannot send heartbeat to a fired switch");
        }
    }

    #[test]
    fn test_cannot_fire_if_not_expired() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 100000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["error"], "Switch status is active — cannot fire until expired");
        }
    }

    #[test]
    fn test_cannot_cancel_if_fired() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            run_fire_epoch(&fire_req);

            let cancel_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_cancel(&cancel_req);
            assert_eq!(res["error"], "Cannot cancel a fired switch");
        }
    }

    #[test]
    fn test_fire_vc_signing_failure() {
        reset_state();
        unsafe {
            let arm_req = serde_json::json!({
                "switchId": "test-switch",
                "gracePeriod": 1000,
                "beneficiaries": ["alice@test.org"],
                "stashRefs": ["ref-1"],
                "encryptedKeys": "secret-keys",
                "otpSecret": "NBSWY3DPEB3W64TBNQ======"
            });
            run_arm_switch(&arm_req);

            let trigger_req = serde_json::json!({
                "switchId": "test-switch",
                "clockOffset": 1500
            });
            run_check_trigger(&trigger_req);

            // Inject VC generation failure
            mock_state::STATE.with(|state| state.borrow_mut().vc_fail = true);

            let fire_req = serde_json::json!({ "switchId": "test-switch" });
            let res = run_fire_epoch(&fire_req);
            assert_eq!(res["success"], true);
            assert_eq!(res["status"], "fired");
            assert_eq!(res["vcReceipt"], ""); // Receipt is empty string when VC generation fails
        }
    }
}

