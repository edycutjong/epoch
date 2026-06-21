.PHONY: help ci e2e lighthouse security-scan test-contract build-contracts bench version-patch version-minor version-major

help:
	@echo "Epoch Makefile Harness"
	@echo "======================"
	@echo "make ci             - Run Rust contract tests, ESLint, Typecheck, and Coverage tests"
	@echo "make test-contract  - Run Rust enclave contract unit tests (Coordinator + Dispatcher)"
	@echo "make build-contracts - Compile both WASM contracts and copy into src/lib"
	@echo "make bench          - Run the latency benchmark against a running dev server"
	@echo "make e2e            - Run Playwright E2E tests"
	@echo "make lighthouse     - Run Lighthouse CI performance and accessibility audit"
	@echo "make security-scan  - Run npm audit and license compliance check"
	@echo "make version-patch  - Bump version by patch (x.y.Z+1)"
	@echo "make version-minor  - Bump version by minor (x.Y+1.0)"
	@echo "make version-major  - Bump version by major (X+1.0.0)"

ci:
	@echo "=== RUNNING RUST CONTRACT TESTS (Coordinator + Dispatcher) ==="
	cargo test --manifest-path contract/Cargo.toml
	cargo test --manifest-path contract-executor/Cargo.toml
	@echo "=== RUNNING INTEGRATION & COVERAGE TESTS ==="
	npm run ci

test-contract:
	@echo "🦀 Running Rust enclave contract unit tests (Coordinator + Dispatcher)..."
	cargo test --manifest-path contract/Cargo.toml
	cargo test --manifest-path contract-executor/Cargo.toml

build-contracts:
	@echo "🦀 Compiling both WASM enclave contracts..."
	cargo build --manifest-path contract/Cargo.toml --target wasm32-unknown-unknown --release
	cargo build --manifest-path contract-executor/Cargo.toml --target wasm32-unknown-unknown --release
	cp contract/target/wasm32-unknown-unknown/release/epoch_contract.wasm src/lib/
	cp contract-executor/target/wasm32-unknown-unknown/release/epoch_executor.wasm src/lib/
	@echo "✅ Copied epoch_contract.wasm + epoch_executor.wasm into src/lib/"

bench:
	@echo "⚡ Running latency benchmark (requires 'npm run dev' running)..."
	python3 scripts/bench.py

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

version-patch:
	PATH="/opt/homebrew/bin:$$PATH" node scripts/bump-version.js patch
	git add .
	git commit -m "chore(release): bump version to $$(PATH="/opt/homebrew/bin:$$PATH" node -p "require('./package.json').version")"

version-minor:
	PATH="/opt/homebrew/bin:$$PATH" node scripts/bump-version.js minor
	git add .
	git commit -m "chore(release): bump version to $$(PATH="/opt/homebrew/bin:$$PATH" node -p "require('./package.json').version")"

version-major:
	PATH="/opt/homebrew/bin:$$PATH" node scripts/bump-version.js major
	git add .
	git commit -m "chore(release): bump version to $$(PATH="/opt/homebrew/bin:$$PATH" node -p "require('./package.json').version")"


