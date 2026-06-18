// ─────────────────────────────────────────────────────────────────────────────
// Epoch — Egress Dispatcher Contract ("The Blind Courier")
//
// This is the SECOND enclave contract in the Epoch system. It is invoked
// synchronously by the Switch Coordinator (`epoch_contract`) through the host
// `contracts-call` interface as a single atomic sub-transaction.
//
// Its only job is the privacy-blind egress: for each beneficiary it dispatches a
// templated notification through `http-with-placeholders`, so PII markers like
// {{profile.verified_contacts.email.value}} are substituted at the host egress
// boundary and never seen by either contract. If any single delivery fails, it
// returns success=false so the Coordinator can abort and roll back atomically.
// ─────────────────────────────────────────────────────────────────────────────

use serde::Deserialize;
use std::slice;

// Import T3 ADK Host APIs (egress + audit logging only — the Courier is blind)
#[cfg(not(test))]
extern "C" {
    fn host_http_with_placeholders_post(
        url_ptr: *const u8, url_len: usize,
        body_ptr: *const u8, body_len: usize,
        res_buf_ptr: *mut u8, res_buf_len: usize
    ) -> i32;
    fn host_logging_log(msg_ptr: *const u8, msg_len: usize);
}

use std::alloc::{alloc as rust_alloc, dealloc as rust_dealloc, Layout};

// Memory Allocation API for the Wasm/JS boundary
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

unsafe fn get_input_string(ptr: *const u8, len: usize) -> String {
    let slice = slice::from_raw_parts(ptr, len);
    String::from_utf8_lossy(slice).into_owned()
}

fn log(msg: &str) {
    unsafe { host_logging_log(msg.as_ptr(), msg.len()) }
}

// Issue a single blind egress through http-with-placeholders.
// Returns Ok(response) on delivery, Err(()) if the host egress reports failure.
fn dispatch_blind(recipient_marker: &str, legacy_hash: &str) -> Result<String, ()> {
    // The body carries an unresolved PII placeholder; the host substitutes the
    // real contact at the egress boundary. The Courier never sees plaintext PII.
    let url = "https://beneficiary.sandbox.test/notify";
    let body = serde_json::json!({
        "recipient": recipient_marker,
        "legacy_hash": legacy_hash,
        "message": "A sealed Epoch legacy has been released to you."
    }).to_string();

    let mut res_buf = vec![0u8; 1024];
    let http_res = unsafe {
        host_http_with_placeholders_post(
            url.as_ptr(), url.len(),
            body.as_ptr(), body.len(),
            res_buf.as_mut_ptr(), res_buf.len()
        )
    };

    if http_res < 0 {
        return Err(());
    }
    res_buf.truncate(http_res as usize);
    Ok(String::from_utf8(res_buf).unwrap_or_default())
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct DispatchRequest {
    beneficiaries: Vec<String>,
    legacy_hash: Option<String>,
    mock_failure_step: Option<u32>, // debug rollback test, forwarded by the Coordinator
}

// ─── CONTRACT EXPORT ──────────────────────────────────────────────────────────

/// Atomic blind-egress sub-transaction invoked via `contracts-call`.
/// Returns success=true only if every beneficiary was delivered.
#[no_mangle]
pub unsafe extern "C" fn execute_dispatch(ptr: *const u8, len: usize) -> u64 {
    let input = get_input_string(ptr, len);
    log(&format!("Courier execute_dispatch: input={}", input));

    let req: DispatchRequest = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => return return_string(format!(r#"{{"success":false,"error":"Invalid dispatch payload: {}"}}"#, e)),
    };

    let legacy_hash = req.legacy_hash.unwrap_or_else(|| "0x0".to_string());
    let mut delivered = Vec::new();

    for (idx, beneficiary) in req.beneficiaries.iter().enumerate() {
        let step_num = (idx + 1) as u32;

        // Mock failure injection for the rollback demonstration.
        if let Some(fail_step) = req.mock_failure_step {
            if fail_step == step_num {
                log(&format!("Courier simulated egress failure on step {}", step_num));
                let res = serde_json::json!({
                    "success": false,
                    "error": "Downstream beneficiary target rejected delivery.",
                    "failedStep": step_num,
                    "delivered": delivered
                });
                return return_string(res.to_string());
            }
        }

        match dispatch_blind(beneficiary, &legacy_hash) {
            Ok(_response) => {
                log(&format!("Courier delivered blind notice to beneficiary step {}", step_num));
                delivered.push(serde_json::json!({
                    "target": beneficiary,
                    "status": "delivered"
                }));
            }
            Err(_) => {
                log(&format!("Courier host egress failed on step {}", step_num));
                let res = serde_json::json!({
                    "success": false,
                    "error": "Host egress channel failed.",
                    "failedStep": step_num,
                    "delivered": delivered
                });
                return return_string(res.to_string());
            }
        }
    }

    let res = serde_json::json!({
        "success": true,
        "egressCount": delivered.len(),
        "delivered": delivered
    });
    return_string(res.to_string())
}

// ─── UNIT TESTS & HOST MOCKS FOR NATIVE CARGO TEST ─────────────────────────────

#[cfg(test)]
mod mock_state {
    use std::cell::RefCell;
    pub struct State {
        pub http_fail: bool,
        pub egress_calls: u32,
    }
    thread_local! {
        pub static STATE: RefCell<State> = RefCell::new(State { http_fail: false, egress_calls: 0 });
    }
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_http_with_placeholders_post(
    _url_ptr: *const u8, _url_len: usize,
    _body_ptr: *const u8, _body_len: usize,
    res_buf_ptr: *mut u8, res_buf_len: usize
) -> i32 {
    let http_fail = mock_state::STATE.with(|s| {
        s.borrow_mut().egress_calls += 1;
        s.borrow().http_fail
    });
    if http_fail {
        return -1;
    }
    let response = r#"{"status":"delivered"}"#.as_bytes();
    if response.len() <= res_buf_len {
        std::ptr::copy_nonoverlapping(response.as_ptr(), res_buf_ptr, response.len());
        response.len() as i32
    } else {
        -1
    }
}

#[cfg(test)]
#[no_mangle]
pub unsafe extern "C" fn host_logging_log(msg_ptr: *const u8, msg_len: usize) {
    let slice = std::slice::from_raw_parts(msg_ptr, msg_len);
    let msg = std::str::from_utf8(slice).unwrap();
    println!("[Courier Log] {}", msg);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset() {
        mock_state::STATE.with(|s| {
            let mut s = s.borrow_mut();
            s.http_fail = false;
            s.egress_calls = 0;
        });
        LAST_RETURNED_STRING.with(|c| *c.borrow_mut() = String::new());
    }

    unsafe fn run_dispatch(req: &serde_json::Value) -> serde_json::Value {
        let input = req.to_string();
        let _ = execute_dispatch(input.as_ptr(), input.len());
        let out = LAST_RETURNED_STRING.with(|c| c.borrow().clone());
        serde_json::from_str(&out).unwrap()
    }

    #[test]
    fn test_dispatch_all_delivered() {
        reset();
        unsafe {
            let req = serde_json::json!({
                "beneficiaries": ["{{profile.verified_contacts.email.value}}", "heir2@test.org"],
                "legacyHash": "0xabc"
            });
            let res = run_dispatch(&req);
            assert_eq!(res["success"], true);
            assert_eq!(res["egressCount"], 2);
            assert_eq!(res["delivered"][0]["status"], "delivered");
        }
        let calls = mock_state::STATE.with(|s| s.borrow().egress_calls);
        assert_eq!(calls, 2);
    }

    #[test]
    fn test_dispatch_mock_failure_step() {
        reset();
        unsafe {
            let req = serde_json::json!({
                "beneficiaries": ["a@test.org", "b@test.org"],
                "mockFailureStep": 2
            });
            let res = run_dispatch(&req);
            assert_eq!(res["success"], false);
            assert_eq!(res["failedStep"], 2);
            // First beneficiary was delivered before the injected failure.
            assert_eq!(res["delivered"].as_array().unwrap().len(), 1);
        }
    }

    #[test]
    fn test_dispatch_host_egress_failure() {
        reset();
        mock_state::STATE.with(|s| s.borrow_mut().http_fail = true);
        unsafe {
            let req = serde_json::json!({ "beneficiaries": ["a@test.org"] });
            let res = run_dispatch(&req);
            assert_eq!(res["success"], false);
            assert_eq!(res["failedStep"], 1);
        }
    }

    #[test]
    fn test_dispatch_invalid_payload() {
        reset();
        unsafe {
            let bad = "not json";
            let _ = execute_dispatch(bad.as_ptr(), bad.len());
            let out = LAST_RETURNED_STRING.with(|c| c.borrow().clone());
            let res: serde_json::Value = serde_json::from_str(&out).unwrap();
            assert_eq!(res["success"], false);
            assert!(res["error"].as_str().unwrap().contains("Invalid dispatch payload"));
        }
    }

    #[test]
    fn test_dispatch_empty_beneficiaries() {
        reset();
        unsafe {
            let req = serde_json::json!({ "beneficiaries": [] });
            let res = run_dispatch(&req);
            assert_eq!(res["success"], true);
            assert_eq!(res["egressCount"], 0);
        }
    }

    #[test]
    fn test_alloc_dealloc() {
        let p = alloc(64);
        assert!(!p.is_null());
        dealloc(p, 64);
    }
}
