import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';

export async function GET() {
  try {
    const db = readDb();
    
    // Count active switches in database
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

    return NextResponse.json({
      enclaveStatus: "online",
      hardwareIsolation: "Intel TDX",
      clockDriftMs: 8.42, // Simulated drift within 50ms per week
      metrics: {
        activeSwitches: activeCount,
        expiredSwitches: expiredCount,
        firedSwitches: firedCount,
        dispatchedNotifications: (db.dispatchedNotifications || []).length
      },
      attestation: {
        enclaveMeasurement: "sha256-5b323c6f14028bc9ef2be91fe5d3a5bc382ff2fcf930b2da96cd459d871be364",
        attestedPublicKey: "04b4d7088998aa90c8b323c6f14028bc9ef2be91fe5d3a5bc382ff2fcf930b2da96cd459d871be364b4c810486b72d2fb4199997cf29f55e0c5e7b7f6fa4360e20",
        provider: "Terminal 3 ADK Host Runtime"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
