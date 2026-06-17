import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { switchId, reset } = body;
    if (reset === true) {
      const { clearDb } = require('@/lib/db');
      clearDb();
      return NextResponse.json({ success: true, reset: true });
    }

    if (!switchId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const result = await runWasmContract('cancel', {
      switchId
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API cancel failed:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
