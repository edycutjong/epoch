# Agentic Specification: Epoch

This document defines the agent architecture, system prompts, aesthetic guidelines, and tools for **Epoch**, the TEE-secured dead-man's switch.

---

## 1. System Architecture

Epoch leverages two primary agent entities running inside the Intel TDX TEE boundary:

### A. Switch Coordinator Agent (The Custodian)
- **Goal:** Monitors user heartbeats and monotonic clock cycles, evaluates trigger timeouts, and orchestrates the atomic cascade release.
- **System Prompt:**
  ```
  You are the Switch Coordinator. You operate blindly within the TEE. Your primary directives are:
  1. Never disclose keys or credentials stored in `stash` to the host system or any external target prior to countdown timeout.
  2. Authenticate user heartbeats strictly using the sealed `otp` credentials and monotonic clock checks.
  3. Execute the release cascade as a single transactional atomic unit, rolling back all state changes and keeping vault keys locked if any single downstream egress channel fails.
  ```

### B. Egress Dispatch Agent (The Blind Courier)
- **Goal:** Receives notification templates from the Switch Coordinator and sends blind SMS/email notices to beneficiaries using `http-with-placeholders`.
- **System Prompt:**
  ```
  You are the Egress Dispatcher. You receive templated contact payloads. You substitute PII markers (e.g. {{profile.verified_contacts.email.value}}) from the user's secure did:t3n profile at the egress boundary. You must never expose or log raw contact details to the host console.
  ```

---

## 2. Design System & Aesthetics

- **Aesthetic Theme:** `Cyberpunk-terminal` (Military SOC command center meets hacker terminal)
- **Color Palette:**
  - **Base Background (60%):** `#0a0b0d` (Matte black/dark carbon gray)
  - **Surfaces (30%):** `#12141a` (Elevated card panels)
  - **Primary Accent (10%):** `#ffaa00` (Neon Warning Amber)
  - **Secondary Accent:** `#00f0ff` (Neon Cyan)
- **Typography:**
  - **Display:** `Orbitron` (Monospace tactical font)
  - **UI/Body:** `Inter` (Sleek sans-serif)
  - **Mono:** `JetBrains Mono` (Terminal logs and variables)

---

## 3. High Score / Leaderboard
*N/A - This is a security succession tool rather than a game.*

---

## 4. Lottie Animations
- **Enclave Ring Status:** Pulsing circular SVG ring representing the Intel TDX hardware boundary.
- **Heartbeat Monitor:** A waving line showing active check-in frequency.

---

## 5. Particle Effects
- **Celebration Confetti:** Canvas-confetti triggers upon successful OTP check-in.
- **Decrypted Glow Sparkles:** Particle effects radiating around vault files when they are successfully decrypted upon switch firing.
