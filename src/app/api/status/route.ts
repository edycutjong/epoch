import { NextResponse } from 'next/server';
import { runWasmContract } from '@/lib/wasmRunner';
import { readDb } from '@/lib/db';
import crypto from 'crypto';

function calculateTotpSha256(secret: string, counter: number): string {
  // Try to decode base32 or fall back to raw string bytes
  let key: Buffer;
  try {
    key = decodeBase32(secret);
  } catch (e) {
    key = Buffer.from(secret);
  }
  
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(buffer);
  const result = hmac.digest();
  
  const offset = result[result.length - 1] & 0xf;
  const binary = ((result[offset] & 0x7f) << 24)
               | ((result[offset + 1] & 0xff) << 16)
               | ((result[offset + 2] & 0xff) << 8)
               | (result[offset + 3] & 0xff);
               
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

function decodeBase32(s: string): Buffer {
  const clean = s.trim().toUpperCase().replace(/ /g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') break;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const val = alphabet.indexOf(c);
    if (val === -1) throw new Error('Invalid base32');
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bytes.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }
  return Buffer.from(bytes);
}

export async function POST(request: Request) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch (e) {
      // Handle empty body gracefully
    }
    const { switchId, clockOffset } = body;
    if (!switchId) {
      // If switchId is not in request, try to default it or return bad request
      return NextResponse.json({ error: 'Missing required switchId' }, { status: 400 });
    }

    const result = await runWasmContract('get_status', {
      switchId,
      clockOffset: clockOffset ? Number(clockOffset) : undefined
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Retrieve the secret to generate debug OTP code
    const db = readDb();
    let otpSecret = 'DAVID_SECRET_KEY';
    try {
      const switchKey = `epoch:switch:${switchId}`;
      const state = JSON.parse(db.kv[switchKey]);
      otpSecret = state.otpSecret;
    } catch (e) {}

    // Calculate debug OTP for the current simulated time
    const now = Date.now() + (clockOffset ? Number(clockOffset) : 0);
    const counter = Math.floor(now / 30000);
    const debugOtp = calculateTotpSha256(otpSecret, counter);

    // Also output to console logs as required by DEMO.md
    console.log(`[Enclave Debug] Simulated Time: ${new Date(now).toISOString()} | Active OTP: ${debugOtp}`);

    return NextResponse.json({
      ...result,
      debugOtp
    });
  } catch (error: any) {
    console.error('API status failed:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
