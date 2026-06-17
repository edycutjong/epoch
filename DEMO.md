# Epoch — Demo Protocol

This guide walks through the step-by-step demo protocol for judges to reproduce and verify **Epoch** functionality.

---

## 1. Setup & Environment
- **Prerequisites:** Node.js ≥ 20.9.0, Rust, and the Terminal 3 Local Sandbox CLI installed.
- **Run Seeding:**
  ```bash
  python3 scripts/seed.py
  ```
  *This registers the mock legacy targets and seeds the profile context for `did:t3n:david123`.*

---

## 2. Step-by-Step Walkthrough

### Step 1: Bind Switch and Seal Vault
1. Open the UI at `http://localhost:3000`.
2. Access the **Legacy Dashboard** and upload the mock file `data/fixtures/medical_directive.pdf` to the vault.
3. Set the liveness schedule to 14 days and click **Arm Switch**.
4. Observe the switch showing `Armed` and the countdown starting. Check the vault panel: the document is marked as `Sealed` and cannot be opened or read.

### Step 2: Heartbeat Checks
1. Click **Send Heartbeat**.
2. A modal prompts for an SMS OTP. View the generated mock code in the terminal logs (`991204`).
3. Enter the code. The countdown resets back to 14 days.

### Step 3: Simulating Expiration (Time-Warp)
1. On the debug panel, locate the **Time-Warp Slider**.
2. Drag the slider to "+15 Days" to simulate the user going silent.
3. Observe the countdown timer hitting zero and the status indicator shifting from `Active` to `Expired`.

### Step 4: The Legacy Trigger (Atomic Release)
1. Click **Trigger Legacy**.
2. Watch the timeline animate the release sequence:
   - Step 1: `Decrypting Vault` (Green) ✅
   - Step 2: `http-with-placeholders (Spouse Notify)` (Green) ✅
3. The UI prints the Verifiable Credential receipt. Click **Verify VC** to validate. A green badge confirms signature validation.
4. Toggle a mock failure on Step 2. Run **Trigger Legacy**. Watch the execution halt, displaying `ROLLBACK TRIGGERED`. The files remain sealed and the notification is reverted.
