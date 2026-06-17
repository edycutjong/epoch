import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { switchId, otpCode, clockOffset } = body;
    if (!switchId || !otpCode) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log('[API Heartbeat] Received payload:', { switchId, otpCode, clockOffset });
    const result = await runWasmContract('heartbeat', {
      switchId,
      otpCode,
      clockOffset: clockOffset ? Number(clockOffset) : undefined
    });

    console.log('[API Heartbeat] WASM result:', result);

    if (result.error) {
      console.log('[API Heartbeat] Validation failed:', result.error);
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API heartbeat failed:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
