import { NextResponse } from 'next/server';
import { verifyReleaseVc } from '@/lib/realVc';

// Verifies a release receipt VC with the REAL Terminal 3 verifier
// (@terminal3/verify_vc). Accepts either a `{ credential }` envelope or a bare
// SignedCredential. A tampered VC verifies as invalid.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const credential = body?.credential ?? body;
    if (!credential || !credential.proof) {
      return NextResponse.json(
        { isValid: false, message: 'No signed credential provided' },
        { status: 400 },
      );
    }
    const result = await verifyReleaseVc(credential);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ isValid: false, message }, { status: 500 });
  }
}
