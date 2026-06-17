import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { switchId, mockFailureStep } = body;
    if (!switchId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const result = await runWasmContract('fire_epoch', {
      switchId,
      mockFailureStep: mockFailureStep !== undefined ? Number(mockFailureStep) : undefined
    });

    if (result.error && !result.reverted) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API fire-epoch failed:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
