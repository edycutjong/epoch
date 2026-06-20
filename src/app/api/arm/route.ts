import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Ensure all required fields are present. The OTP secret is intentionally
    // NOT accepted from the client: it is the switch's liveness credential and
    // must never round-trip through (or be bundled into) the browser. We derive
    // it server-side from the enclave-authority key — the same value db.ts uses
    // to seed the switch, so heartbeat/OTP verification stays consistent.
    const { switchId, gracePeriod, beneficiaries, stashRefs, encryptedKeys } = body;
    if (!switchId || !gracePeriod || !beneficiaries || !stashRefs || !encryptedKeys) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const otpSecret = process.env.T3N_API_KEY || 'DAVID_SECRET_KEY';

    const result = await runWasmContract('arm_switch', {
      switchId,
      gracePeriod: Number(gracePeriod),
      beneficiaries,
      stashRefs,
      encryptedKeys,
      otpSecret
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API arm failed:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
