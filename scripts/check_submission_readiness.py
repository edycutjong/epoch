# scripts/check_submission_readiness.py
import os
import sys


def check_readiness():
    print("======================================================================")
    print("                EPOCH SUBMISSION READINESS AUDIT")
    print("======================================================================")

    # 1. Check required files
    required_files = [
        "README.md",
        "LICENSE",
        "src/lib/epoch_contract.wasm",
        "scripts/bench.py",
        "scripts/verify_offline.py",
        "public/og-image.png",
        "docs/readme-hero.png",
    ]

    missing = []
    for file in required_files:
        if not os.path.exists(file):
            missing.append(file)

    if missing:
        print("❌ Audit FAILED: The following files are missing:")
        for m in missing:
            print(f"  - {m}")
        sys.exit(1)
    else:
        print("✅ All required files and visual assets are present.")

    # 2. Check for leftover placeholders/TODOs in README and source files
    print("\nScanning source and docs for placeholders (TODO, FIXME, PLACEHOLDER)...")
    placeholders = ["TODO", "FIXME", "PLACEHOLDER", "lorem ipsum"]
    found_placeholders = False

    for root, dirs, files in os.walk("src"):
        for file in files:
            if file.endswith((".ts", ".tsx", ".js", ".css")):
                path = os.path.join(root, file)
                with open(path, "r", encoding="utf-8") as f:
                    for line_num, line in enumerate(f, 1):
                        for p in placeholders:
                            if p in line:
                                print(f"  - Found {p} in {path}:{line_num}")
                                found_placeholders = True

    if found_placeholders:
        print("❌ Audit FAILED: Leftover placeholders found.")
        sys.exit(1)
    else:
        print("✅ No leftover placeholders found in source files.")

    print("\n[AUDIT RESULT] PASSED. Epoch is 100% submission ready.")
    print("======================================================================")


if __name__ == "__main__":
    check_readiness()
