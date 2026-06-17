# scripts/seed.py
import json
import requests
import sys

GATEWAY_URL = "http://localhost:3000/api/seed"

def seed():
    print("Seeding database via gateway...")
    try:
        with open("data/fixtures/legacy.json", "r") as f:
            legacy = json.load(f)
        
        with open("data/fixtures/profiles.json", "r") as f:
            profiles = json.load(f)
    except FileNotFoundError as e:
        print(f"Error: Fixture file not found: {e}")
        sys.exit(1)

    # Register legacy targets
    for target in legacy:
        try:
            r = requests.post(f"{GATEWAY_URL}/legacy", json=target)
            print(f"Seeded legacy target {target['id']}: {r.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"Failed to seed legacy target: {e}")

    # Bind profile
    for did, profile in profiles.items():
        try:
            r = requests.post(f"{GATEWAY_URL}/profile", json={"did": did, "profile": profile})
            print(f"Seeded profile {did}: {r.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"Failed to seed profile: {e}")

if __name__ == "__main__":
    seed()
