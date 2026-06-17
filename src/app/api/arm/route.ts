import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Ensure all required fields are present
    const { switchId, gracePeriod, beneficiaries, stashRefs, encryptedKeys, otpSecret } = body;
    if (!switchId || !gracePeriod || !beneficiaries || !stashRefs || !encryptedKeys || !otpSecret) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

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
