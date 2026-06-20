# Epoch Enclave API Reference

This document provides a comprehensive reference of all Next.js API routes (Route Handlers) implemented in [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api). 

The Next.js backend serves as the unsecure host gateway proxying calls to the secure TEE boundary. Under the hood, key endpoints delegate execution directly to the two compiled Rust→WASM enclave contracts: the **Switch Coordinator** (`epoch_contract.wasm`) and the **Egress Dispatcher** (`epoch_executor.wasm`) using the WASM Runner module [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/lib/wasmRunner.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/lib/wasmRunner.ts).

---

## 🧭 Architecture Diagram

```
                 [ Client / UI / CLI ]
                           │
                           ▼
               [ Next.js Host API Route ] (/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/*)
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
      [ Mock DB / Store ]       [ WASM Enclave Coordinator ] (epoch_contract.wasm)
      (/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/lib/db.ts)    │
                                         ├──────────────┐ (Atomic Cascade via host_contracts_call)
                                         ▼              ▼
                                [ Egress Dispatcher ]  [ Host VC Signing Service ]
                              (epoch_executor.wasm)    (real @terminal3/ecdsa_vc)
                                         │
                                         ▼
                               [ Egress Boundary ]
                            (http-with-placeholders)
```

---

## 🛠️ Global Headers & Error Format

All POST requests require `Content-Type: application/json`.

Errors are returned in the following JSON format:
```json
{
  "error": "Detailed description of the failure"
}
```

---

## 1. Switch Lifecycle Endpoints

### 🔐 Arm Switch
Arms a new dead-man's switch, registering the schedule configuration, encrypted keys, OTP configuration, and beneficiaries.

*   **Endpoint:** `POST /api/arm`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/arm/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/arm/route.ts)
*   **Request Body:**
    *   `switchId` *(string, Required)*: Unique identifier for the switch.
    *   `gracePeriod` *(number, Required)*: The silence duration threshold (in seconds) before the switch expires.
    *   `beneficiaries` *(array of objects, Required)*: List of recipients. Each object contains target info and reference profiles.
    *   `stashRefs` *(array of strings, Required)*: Stash file links representing sealed assets.
    *   `encryptedKeys` *(string, Required)*: Sealed cryptographic keys or recovery secrets.
    *   `otpSecret` *(string, Required)*: Base32 encoded key used for generating the verification codes (TOTP).
*   **Response:**
    *   `success` *(boolean)*: True if armed successfully.
    *   `status` *(string)*: The current state of the switch (`active`).
    *   `nextCheckIn` *(number)*: Timestamp for the next scheduled heartbeat.
*   **Request Example:**
    ```json
    {
      "switchId": "personal-inheritance-01",
      "gracePeriod": 86400,
      "beneficiaries": [
        {
          "did": "did:t3n:heir-alice-123",
          "subject": "Inheritance Egress Notice",
          "template": "Hello Alice, decrypter key: {{profile.secret_key}} is now released."
        }
      ],
      "stashRefs": ["stash://personal-vault.enc"],
      "encryptedKeys": "U2VjcmV0S2V5RGF0YQ==",
      "otpSecret": "NBSWY3DPEB3W64TBNQ======"
    }
    ```
*   **Response Example:**
    ```json
    {
      "success": true,
      "status": "active",
      "nextCheckIn": 1781987654321
    }
    ```

---

### 🫀 Send Heartbeat
Resets the countdown timer, keeping the switch active. Requires a valid simulated TOTP code matching the `otpSecret` of the switch.

*   **Endpoint:** `POST /api/heartbeat`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/heartbeat/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/heartbeat/route.ts)
*   **Request Body:**
    *   `switchId` *(string, Required)*: Unique identifier for the switch.
    *   `otpCode` *(string, Required)*: The 6-digit TOTP code.
    *   `clockOffset` *(number, Optional)*: Drift adjustment parameter in milliseconds (used for time-warp simulation in the UI).
*   **Response:**
    *   `success` *(boolean)*: True if the heartbeat was verified and accepted.
    *   `lastHeartbeat` *(number)*: Timestamp of this accepted heartbeat.
    *   `nextCheckIn` *(number)*: Updated timestamp of the next required check-in.
*   **Request Example:**
    ```json
    {
      "switchId": "personal-inheritance-01",
      "otpCode": "123456",
      "clockOffset": 0
    }
    ```
*   **Response Example:**
    ```json
    {
      "success": true,
      "lastHeartbeat": 1781900000000,
      "nextCheckIn": 1781986400000
    }
    ```

---

### 📊 Get Switch Status
Retrieves metadata, countdown thresholds, current states, and returns debug OTP code helpers. If the switch has been successfully fired, the sealed decryption keys are returned.

*   **Endpoint:** `POST /api/status`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/status/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/status/route.ts)
*   **Request Body:**
    *   `switchId` *(string, Required)*: The unique identifier.
    *   `clockOffset` *(number, Optional)*: The simulated time drift offset in milliseconds.
*   **Response:**
    *   `status` *(string)*: Lifecycle status (`active` | `expired` | `fired`).
    *   `lastHeartbeat` *(number)*: Timestamp of the last accepted check-in.
    *   `gracePeriod` *(number)*: Countdown threshold (in seconds).
    *   `timeRemaining` *(number)*: Seconds left before expiry.
    *   `debugOtp` *(string)*: Helper 6-digit TOTP code generated on-the-fly for debugging purposes.
    *   `decryptedKeys` *(string | undefined)*: Present **only** when the switch transitions to `fired`. Contains the payload registered in `encryptedKeys` during setup.
*   **Request Example:**
    ```json
    {
      "switchId": "personal-inheritance-01",
      "clockOffset": 3600000
    }
    ```
*   **Response Example (Active):**
    ```json
    {
      "status": "active",
      "lastHeartbeat": 1781900000000,
      "gracePeriod": 86400,
      "timeRemaining": 82800,
      "debugOtp": "837492"
    }
    ```
*   **Response Example (Fired):**
    ```json
    {
      "status": "fired",
      "lastHeartbeat": 1781900000000,
      "gracePeriod": 86400,
      "timeRemaining": 0,
      "debugOtp": "291048",
      "decryptedKeys": "U2VjcmV0S2V5RGF0YQ=="
    }
    ```

---

### 🕰️ Check Trigger Status
Evaluates whether the timer has run down past the threshold. This endpoint can be triggered repeatedly by a monitoring daemon or cron service to transition the switch state.

*   **Endpoint:** `POST /api/check-trigger`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/check-trigger/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/check-trigger/route.ts)
*   **Request Body:**
    *   `switchId` *(string, Required)*: Unique identifier.
    *   `clockOffset` *(number, Optional)*: Simulated time drift in milliseconds.
*   **Response:**
    *   `status` *(string)*: Switch state (`active` | `expired` | `fired`).
    *   `expired` *(boolean)*: True if the countdown has expired.
*   **Request Example:**
    ```json
    {
      "switchId": "personal-inheritance-01",
      "clockOffset": 90000000
    }
    ```
*   **Response Example:**
    ```json
    {
      "status": "expired",
      "expired": true
    }
    ```

---

### 💥 Trigger Atomic Cascade (Fire Switch)
Executes the blind legacy release chain. Invokes the Egress Dispatcher enclave via synchronous `contracts-call`, replaces placeholder metadata using `http-with-placeholders`, and registers a Verifiable Credential on success. If any step fails, it triggers a complete rollback.

*   **Endpoint:** `POST /api/fire-epoch`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/fire-epoch/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/fire-epoch/route.ts)
*   **Request Body:**
    *   `switchId` *(string, Required)*: Unique identifier.
    *   `mockFailureStep` *(number, Optional)*: Simulation index to mock failures and test transactional rollbacks.
        *   `1`: Mocks failure during Coordinator pre-checks.
        *   `2`: Mocks failure inside the Egress Dispatcher call.
        *   `3`: Mocks failure during VC receipt signature.
*   **Response:**
    *   `success` *(boolean)*: True if the cascade executed successfully.
    *   `status` *(string)*: Updated switch status (`fired` or reverted to previous status).
    *   `reverted` *(boolean)*: True if a rollback occurred.
    *   `error` *(string | null)*: Disclosed error details (if a step failed).
    *   `stepsExecuted` *(array of strings)*: Trace logs of completed cascade stages.
    *   `releaseLogStashRef` *(string)*: File path/CID where the release audit was persisted inside the enclave stash.
    *   `vcReceipt` *(string)*: W3C JSON-LD envelope representing the cryptographically-signed release receipt.
    *   `vcReceiptReal` *(boolean)*: True if issued by the real `@terminal3/ecdsa_vc` service.
*   **Request Example:**
    ```json
    {
      "switchId": "personal-inheritance-01"
    }
    ```
*   **Response Example (Success):**
    ```json
    {
      "success": true,
      "status": "fired",
      "reverted": false,
      "stepsExecuted": [
        "Read encrypted keys from KV store",
        "Decrypt vault keys in Coordinator",
        "Initiated cross-contract egress calls",
        "Substituted Alice PII variables",
        "Verified outbox delivery confirmation"
      ],
      "releaseLogStashRef": "stash://audit-log-personal-inheritance-01.json",
      "vcReceipt": "{\"@context\":[\"https://www.w3.org/2018/credentials/v1\"],\"id\":\"vc:epoch:release:personal-inheritance-01\",\"type\":[\"VerifiableCredential\",\"LegacyReleaseCredential\"],...}",
      "vcReceiptReal": true,
      "vcSdk": "v1.2.0"
    }
    ```
*   **Response Example (Rollback / Failure):**
    ```json
    {
      "success": false,
      "status": "expired",
      "reverted": true,
      "error": "Egress dispatcher failed to substitute placeholder: no profile record found for Alice",
      "stepsExecuted": [
        "Read encrypted keys from KV store",
        "Decrypt vault keys in Coordinator",
        "Initiated cross-contract egress calls"
      ],
      "vcReceiptReal": false
    }
    ```

---

### ❌ Cancel Switch / Reset Sandbox
Wipes switch parameters or clears out sandbox persistence entirely.

*   **Endpoint:** `POST /api/cancel`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/cancel/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/cancel/route.ts)
*   **Request Body:**
    *   `switchId` *(string, Optional)*: The identifier of the switch to delete.
    *   `reset` *(boolean, Optional)*: If `true`, completely clears the local mock database.
*   **Response:**
    *   `success` *(boolean)*: True if executed successfully.
    *   `reset` *(boolean)*: True if a complete wipe was performed.
*   **Request Example (Full Reset):**
    ```json
    {
      "reset": true
    }
    ```
*   **Response Example:**
    ```json
    {
      "success": true,
      "reset": true
    }
    ```

---

## 2. Integrity & Egress Observability

### 📃 Verify Receipt VC
Validates the cryptographically signed Verifiable Credential receipt produced after a successful switch cascade. Verifies signatures locally using the `@terminal3/verify_vc` package.

*   **Endpoint:** `POST /api/verify-vc`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/verify-vc/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/verify-vc/route.ts)
*   **Request Body:**
    *   `credential` *(object, Required)*: The complete VC JSON object payload.
*   **Response:**
    *   `isValid` *(boolean)*: True if signatures verify against the public key.
    *   `message` *(string, Optional)*: Descriptive message if verification fails.
*   **Request Example:**
    ```json
    {
      "credential": {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        "id": "vc:epoch:release:personal-inheritance-01",
        "type": ["VerifiableCredential", "LegacyReleaseCredential"],
        "issuer": "did:t3n:signing-coordinator",
        "issuanceDate": "2026-06-20T14:30:00Z",
        "credentialSubject": {
          "id": "personal-inheritance-01",
          "event": "legacy.released",
          "firedAt": 1781987654321
        },
        "proof": {
          "type": "EcdsaSecp256k1Signature2019",
          "created": "2026-06-20T14:30:00Z",
          "proofPurpose": "assertionMethod",
          "verificationMethod": "did:t3n:signing-coordinator#key1",
          "jws": "eyJhbGciOiJFUzI1NksifQ...hx_0"
        }
      }
    }
    ```
*   **Response Example:**
    ```json
    {
      "isValid": true
    }
    ```

---

### 📬 Get Dispatched Notifications
Lists the history of notifications sent out to beneficiaries via the blind egress dispatcher.

*   **Endpoint:** `GET /api/notifications`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/notifications/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/notifications/route.ts)
*   **Response:**
    *   `notifications` *(array of objects)*: List of delivery logs, showing the redacted placeholder results.
*   **Response Example:**
    ```json
    {
      "notifications": [
        {
          "switchId": "personal-inheritance-01",
          "sentAt": 1781987655000,
          "channel": "email",
          "status": "delivered",
          "redactedPayload": "Hello Alice, decrypter key: <SECRET_PLACEHOLDER> is now released."
        }
      ]
    }
    ```

---

### 🛡️ Enclave Attestation Status
Generates real binary SHA-256 code measurements for the compiled enclave WASM binaries, reports clock drift, and returns host status.

*   **Endpoint:** `GET /api/integrations/verify`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/integrations/verify/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/integrations/verify/route.ts)
*   **Response:**
    *   `enclaveStatus` *(string)*: Current state (`online`).
    *   `hardwareIsolation` *(string)*: Core CPU shielding technology (`Intel TDX`).
    *   `clockDriftMs` *(number)*: Actual measured host timer resolution/jitter.
    *   `metrics` *(object)*: Live stats on active, expired, and fired switches.
    *   `attestation` *(object)*: Cryptographic quote metadata, containing the enclave code measurement hash.
*   **Response Example:**
    ```json
    {
      "enclaveStatus": "online",
      "hardwareIsolation": "Intel TDX",
      "clockSource": "host wall-clock (sandbox); production uses monotonic TDX clock",
      "clockDriftMs": 0.0004,
      "metrics": {
        "activeSwitches": 1,
        "expiredSwitches": 0,
        "firedSwitches": 0,
        "dispatchedNotifications": 0,
        "outboxQueued": 0
      },
      "attestation": {
        "mode": "sandbox-simulation",
        "enclaveMeasurement": "sha256:7f96e4a2c918aefdc51a89cdb3400aefc902341b52781cb9f2a893cbcd910d54",
        "contracts": {
          "coordinator": "sha256:69b0fa8de118749aefcdb4010da9c90aef023d8c11ef78923cb9d02e8fcb101a",
          "dispatcher": "sha256:5b8e90c8aefdc99017aefbc80eaef02e88a912bfcb9d023b9d0234ac9ef8cb32"
        },
        "note": "enclaveMeasurement is a real SHA-256 of the two compiled WASM contracts — verify with `shasum -a 256 src/lib/*.wasm`. In production this is replaced by a hardware-signed Intel TDX attestation quote.",
        "provider": "Terminal 3 ADK Host Runtime (local sandbox)"
      }
    }
    ```

---

## 3. Developer Seed Routes

### 🌱 Seed Legacy Target Configuration
Injects mock beneficiary information or external target templates into the sandbox database.

*   **Endpoint:** `POST /api/seed/legacy`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/seed/legacy/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/seed/legacy/route.ts)
*   **Request Body:**
    *   `id` *(string, Required)*: Unique ID for the target.
    *   `title` *(string)*: Friendly title.
    *   `type` *(string)*: Integration type (e.g. `email`, `sms`, `webhook`).
*   **Response:**
    *   `success` *(boolean)*: True if successfully seeded.
*   **Request Example:**
    ```json
    {
      "id": "email-delivery-agent",
      "title": "Email Dispatcher",
      "type": "email"
    }
    ```
*   **Response Example:**
    ```json
    {
      "success": true,
      "message": "Legacy target seeded: email-delivery-agent"
    }
    ```

---

### 👤 Seed Decrypted DID Profile
Associates profile records (containing PII metadata to swap at the boundary) with a simulated decentralised identifier.

*   **Endpoint:** `POST /api/seed/profile`
*   **Source:** [/Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/seed/profile/route.ts](file:///Users/edycu/Projects/Hackathon/dorahacks-t3launch-epoch/src/app/api/seed/profile/route.ts)
*   **Request Body:**
    *   `did` *(string, Required)*: Decentralised Identifier (e.g. `did:t3n:heir-alice-123`).
    *   `profile` *(object, Required)*: Custom key-value dictionary representing the user's secure did:t3n profile.
*   **Response:**
    *   `success` *(boolean)*: True if successfully seeded.
*   **Request Example:**
    ```json
    {
      "did": "did:t3n:heir-alice-123",
      "profile": {
        "email": "alice@family.org",
        "phone": "+15550199",
        "secret_key": "x-recovered-auth-token-42"
      }
    }
    ```
*   **Response Example:**
    ```json
    {
      "success": true,
      "message": "Profile seeded for did:t3n:heir-alice-123"
    }
    ```
