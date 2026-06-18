import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readDb } from '@/lib/db';

// Cache the measurement so we don't re-hash the binaries on every request.
let cachedMeasurement: { combined: string; coordinator: string; dispatcher: string } | null = null;

function sha256File(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
}

// The enclave "measurement" is a REAL hash of the code that runs inside the TEE.
// Here we hash the two compiled WASM contracts — reproducible by anyone via
// `shasum -a 256 src/lib/epoch_contract.wasm src/lib/epoch_executor.wasm`.
// In production this value is replaced by a hardware-signed Intel TDX quote.
function getEnclaveMeasurement() {
  if (cachedMeasurement) return cachedMeasurement;
  const base = path.resolve(process.cwd(), 'src/lib');
  const coordinator = sha256File(path.join(base, 'epoch_contract.wasm'));
  const dispatcher = sha256File(path.join(base, 'epoch_executor.wasm'));
  const combined = coordinator && dispatcher
    ? crypto.createHash('sha256').update(`${coordinator}:${dispatcher}`).digest('hex')
    : 'unavailable';
  cachedMeasurement = {
    combined,
    coordinator: coordinator ?? 'unavailable',
    dispatcher: dispatcher ?? 'unavailable',
  };
  return cachedMeasurement;
}

// Measure the host timer's real effective resolution/jitter (a genuine number)
// rather than inventing a drift figure: the largest gap between two distinct
// performance.now() readings across a tight loop. The production TEE uses a
// monotonic hardware clock; the sandbox uses the host wall-clock, so we report
// what we can actually measure.
function measureHostTimerJitterMs(samples = 2048): number {
  let maxDelta = 0;
  let last = performance.now();
  for (let i = 0; i < samples; i++) {
    const now = performance.now();
    const d = now - last;
    if (d > maxDelta) maxDelta = d;
    last = now;
  }
  return Math.round(maxDelta * 10000) / 10000;
}

export async function GET() {
  try {
    const db = readDb();

    // Count switch states in the KV store.
    let activeCount = 0;
    let expiredCount = 0;
    let firedCount = 0;

    for (const key of Object.keys(db.kv)) {
      if (key.startsWith('epoch:switch:')) {
        try {
          const val = JSON.parse(db.kv[key]);
          if (val.status === 'active') activeCount++;
          if (val.status === 'expired') expiredCount++;
          if (val.status === 'fired') firedCount++;
        } catch (e) {}
      }
    }

    const measurement = getEnclaveMeasurement();

    return NextResponse.json({
      enclaveStatus: "online",
      hardwareIsolation: "Intel TDX",
      clockSource: "host wall-clock (sandbox); production uses monotonic TDX clock",
      clockDriftMs: measureHostTimerJitterMs(), // real measured host-timer jitter
      metrics: {
        activeSwitches: activeCount,
        expiredSwitches: expiredCount,
        firedSwitches: firedCount,
        dispatchedNotifications: (db.dispatchedNotifications || []).length,
        outboxQueued: (db.outbox || []).length
      },
      attestation: {
        mode: "sandbox-simulation",
        // Real, reproducible SHA-256 of the compiled WASM enclave code.
        enclaveMeasurement: `sha256:${measurement.combined}`,
        contracts: {
          coordinator: `sha256:${measurement.coordinator}`,
          dispatcher: `sha256:${measurement.dispatcher}`
        },
        note: "enclaveMeasurement is a real SHA-256 of the two compiled WASM contracts — verify with `shasum -a 256 src/lib/*.wasm`. In production this is replaced by a hardware-signed Intel TDX attestation quote.",
        provider: "Terminal 3 ADK Host Runtime (local sandbox)"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
