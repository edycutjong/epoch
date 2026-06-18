# Security Policy

## Supported Versions

Epoch is currently in active development. We actively monitor and maintain the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Reporting a Vulnerability

We take the security of Epoch seriously, especially given its role as a TEE-secured dead-man's switch managing sensitive vault keys, heartbeats, and atomic cascade releases inside secure Intel TDX enclaves.

If you discover a security vulnerability within Epoch, please do not disclose it publicly. Instead, follow these steps to report it responsibly:

1. Go to the [Security Advisories](../../security/advisories) tab on GitHub.
2. Click **Report a vulnerability**.
3. Provide a detailed description of the vulnerability, including steps to reproduce it, potential impact on the enclave boundary, OTP check-in checks, or the atomic release transactions.

We will acknowledge receipt of your vulnerability report within 48 hours and strive to resolve the issue responsibly.

## Scope

The following areas are in scope for security reports:
- The Rust/WASM TEE contract (`contract/`)
- The Switch Coordinator Agent (`The Custodian`) and Egress Dispatch Agent (`The Blind Courier`) logic
- The Next.js dashboard and API routes (`src/app/` and `src/lib/`)
- Clock API monotonic checks and KV store integration

Thank you for helping keep Epoch secure!
