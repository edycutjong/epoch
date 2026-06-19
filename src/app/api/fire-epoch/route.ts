import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';
import { issueReleaseVc } from '@/lib/realVc';

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

    // On a successful cascade, the host signing service issues a GENUINE,
    // cryptographically-signed Terminal 3 Verifiable Credential as the release
    // receipt (real @terminal3/ecdsa_vc — verifiable with @terminal3/verify_vc).
    // Falls back to the contract's in-enclave mock receipt if issuance fails.
    if (result.success) {
      try {
        const envelope = await issueReleaseVc(switchId, {
          switchId,
          event: 'legacy.released',
          firedAt: Date.now(),
          deliveredBeneficiaries: Array.isArray(result.stepsExecuted) ? result.stepsExecuted.length : 0,
          releaseLogStashRef: result.releaseLogStashRef || '',
        });
        result.vcReceipt = JSON.stringify(envelope);
        result.vcReceiptReal = true;
        result.vcSdk = envelope.sdk;
      } catch (e) {
        console.error('Real VC issuance failed; keeping contract mock receipt:', e);
        result.vcReceiptReal = false;
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('API fire-epoch failed:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
