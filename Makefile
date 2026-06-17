.PHONY: help e2e lighthouse security-scan test-contract

help:
	@echo "Epoch Makefile Harness"
	@echo "======================"
	@echo "make test-contract - Run Rust enclave contract unit tests"
	@echo "make e2e           - Run Playwright E2E tests"
	@echo "make lighthouse    - Run Lighthouse CI performance and accessibility audit"
	@echo "make security-scan - Run npm audit and license compliance check"

test-contract:
	@echo "🦀 Running Rust enclave contract unit tests..."
	cargo test --manifest-path contracts/epoch-contract/Cargo.toml

e2e:
	@echo "🎭 Running Playwright E2E tests (demo mode)..."
	npx playwright test

lighthouse:
	@echo "🔦 Running Lighthouse CI audit..."
	npx lhci autorun

security-scan:
	@echo "=== NPM AUDIT ==="
	npm audit --audit-level=high || true
	@echo ""
	@echo "=== LICENSE CHECK ==="
	npx license-checker --production --failOn "GPL-3.0;AGPL-3.0" --summary || true

