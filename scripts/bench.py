# scripts/bench.py
#
# Honest latency benchmark for the Epoch enclave runtime.
#
# Measures wall-clock latency of the API routes that drive the Rust->WASM
# contract(s), including the cross-contract `fire_epoch` cascade that invokes the
# Egress Dispatcher via host_contracts_call. Uses only the Python standard
# library (no numpy/requests) so it runs anywhere.
#
#   1. Start the app:   npm run dev
#   2. Run:             python3 scripts/bench.py
#
import json
import time
import urllib.request
import urllib.error
import statistics

BASE_URL = "http://localhost:3000/api"
SWITCH_ID = "bench-switch"
RUNS = 100
WARMUP = 10


def post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read().decode() or "{}")


def get(path):
    req = urllib.request.Request(f"{BASE_URL}{path}", method="GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read().decode() or "{}")


def time_call(fn):
    start = time.perf_counter()
    fn()
    return (time.perf_counter() - start) * 1000.0  # ms


def pct(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def bench_endpoint(label, fn):
    for _ in range(WARMUP):
        fn()
    samples = [time_call(fn) for _ in range(RUNS)]
    return {
        "label": label,
        "p50": pct(samples, 50),
        "p90": pct(samples, 90),
        "p95": pct(samples, 95),
        "p99": pct(samples, 99),
        "avg": statistics.fmean(samples),
        "max": max(samples),
    }


def arm_bench_switch(grace_ms):
    return post("/arm", {
        "switchId": SWITCH_ID,
        "gracePeriod": grace_ms,
        "beneficiaries": ["{{profile.verified_contacts.email.value}}"],
        "stashRefs": ["stash://ref-1"],
        "encryptedKeys": "0x-bench-key",
        "otpSecret": "DAVID_SECRET_KEY",
    })


def run_bench():
    print("=" * 78)
    print("                 EPOCH ENCLAVE RUNTIME — LATENCY BENCHMARK")
    print("=" * 78)
    print(f"Target: {BASE_URL}   Iterations: {RUNS} (+{WARMUP} warmup)")

    try:
        arm_bench_switch(1000)
    except (urllib.error.URLError, ConnectionError):
        print("\nError: dev server not reachable. Start it first with 'npm run dev'.\n")
        return

    rows = []
    # Read-path WASM calls.
    rows.append(bench_endpoint("get_status         (WASM)", lambda: post("/status", {"switchId": SWITCH_ID})))
    rows.append(bench_endpoint("check_trigger      (WASM)", lambda: post("/check-trigger", {"switchId": SWITCH_ID, "clockOffset": 0})))
    rows.append(bench_endpoint("integrations/verify (host)", lambda: get("/integrations/verify")))

    # Re-arm each iteration so fire_epoch always has an expired switch to release.
    def arm_expire_fire():
        arm_bench_switch(1000)
        post("/check-trigger", {"switchId": SWITCH_ID, "clockOffset": 5000})
        post("/fire-epoch", {"switchId": SWITCH_ID})
    rows.append(bench_endpoint("arm+expire+fire cascade", arm_expire_fire))

    print("\n  Endpoint                      p50      p90      p95      p99      max")
    print("  " + "-" * 72)
    for r in rows:
        print(f"  {r['label']:<28} {r['p50']:>6.1f}ms {r['p90']:>6.1f}ms "
              f"{r['p95']:>6.1f}ms {r['p99']:>6.1f}ms {r['max']:>6.1f}ms")
    print("  " + "-" * 72)
    print("\n  Note: the 'arm+expire+fire cascade' row includes a synchronous")
    print("  cross-contract host_contracts_call into the Egress Dispatcher plus")
    print("  VC signing, stash audit upload, and durable outbox enqueue.\n")


if __name__ == "__main__":
    run_bench()
