import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Minimal mock database for testing
let mockKv: Record<string, string> = {};
let mockStash: Record<string, string> = {};
let mockTime = Date.now();

// Base32 Decode helper
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

// Node TOTP Calculator for comparison
function calculateTotpSha256(secret: string, counter: number): string {
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
  return (binary % 1000000).toString().padStart(6, '0');
}

describe('Epoch Enclave Contract Unit Tests', () => {
  let wasmInstance: any;
  let wasmMemory: WebAssembly.Memory;

  const readStringFromWasm = (ptr: number, len: number): string => {
    const memView = new Uint8Array(wasmMemory.buffer, ptr, len);
    return new TextDecoder().decode(memView);
  };

  const writeStringToWasm = (str: string, ptr: number, maxLen: number): number => {
    const encoded = new TextEncoder().encode(str);
    const len = Math.min(encoded.length, maxLen);
    const memView = new Uint8Array(wasmMemory.buffer, ptr, maxLen);
    memView.set(encoded.slice(0, len));
    return len;
  };

  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '../src/lib/epoch_contract.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);

    const importObject = {
      env: {
        host_kv_store_get: (keyPtr: number, keyLen: number, valBufPtr: number, valBufLen: number): number => {
          const key = readStringFromWasm(keyPtr, keyLen);
          const value = mockKv[key] || null;
          if (value === null) return -1;
          return writeStringToWasm(value, valBufPtr, valBufLen);
        },
        host_kv_store_set: (keyPtr: number, keyLen: number, valPtr: number, valLen: number): number => {
          const key = readStringFromWasm(keyPtr, keyLen);
          const value = readStringFromWasm(valPtr, valLen);
          mockKv[key] = value;
          return 0;
        },
        host_clock_now: (): bigint => BigInt(mockTime),
        host_http_with_placeholders_post: (
          urlPtr: number, urlLen: number,
          bodyPtr: number, bodyLen: number,
          resBufPtr: number, resBufLen: number
        ): number => {
          return writeStringToWasm(JSON.stringify({ status: "delivered", receiptId: "rcpt-test" }), resBufPtr, resBufLen);
        },
        host_signing_issue_vc: (
          subjectPtr: number, subjectLen: number,
          claimsPtr: number, claimsLen: number,
          vcBufPtr: number, vcBufLen: number
        ): number => {
          return writeStringToWasm(JSON.stringify({ signature: "mock-sig" }), vcBufPtr, vcBufLen);
        },
        host_logging_log: (): void => {},
        host_stash_put: (dataPtr: number, dataLen: number, refBufPtr: number, refBufLen: number): number => {
          const memView = new Uint8Array(wasmMemory.buffer, dataPtr, dataLen);
          const dataBase64 = Buffer.from(memView).toString('base64');
          const refId = `ref-${Math.random().toString(36).substr(2, 9)}`;
          const refStr = `stash://${refId}`;
          mockStash[refStr] = dataBase64;
          return writeStringToWasm(refStr, refBufPtr, refBufLen);
        },
        host_stash_get: (refPtr: number, refLen: number, dataBufPtr: number, dataBufLen: number): number => {
          const refStr = readStringFromWasm(refPtr, refLen);
          const dataBase64 = mockStash[refStr] || null;
          if (dataBase64 === null) return -1;
          const buffer = Buffer.from(dataBase64, 'base64');
          const memView = new Uint8Array(wasmMemory.buffer, dataBufPtr, dataBufLen);
          const writeLen = Math.min(buffer.length, dataBufLen);
          memView.set(buffer.slice(0, writeLen));
          return writeLen;
        }
      }
    };

    const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
    wasmInstance = instance;
    wasmMemory = instance.exports.memory as WebAssembly.Memory;
  });

  const runWasm = (functionName: string, req: any) => {
    const allocFn = wasmInstance.exports.alloc as (size: number) => number;
    const deallocFn = wasmInstance.exports.dealloc as (ptr: number, size: number) => void;
    const contractFn = wasmInstance.exports[functionName] as (ptr: number, len: number) => bigint;

    const requestJson = JSON.stringify(req);
    const requestBytes = new TextEncoder().encode(requestJson);
    const requestPtr = allocFn(requestBytes.length);
    
    const memView = new Uint8Array(wasmMemory.buffer, requestPtr, requestBytes.length);
    memView.set(requestBytes);

    const packedResult = contractFn(requestPtr, requestBytes.length);
    deallocFn(requestPtr, requestBytes.length);

    const resultPtr = Number(packedResult >> 32n);
    const resultLen = Number(packedResult & 0xffffffffn);

    const resultJson = readStringFromWasm(resultPtr, resultLen);
    deallocFn(resultPtr, resultLen);

    return JSON.parse(resultJson);
  };

  test('001: should successfully arm a new switch and vault', () => {
    mockKv = {};
    mockStash = {};
    const res = runWasm('arm_switch', {
      switchId: 'test-switch-001',
      gracePeriod: 1209600000,
      beneficiaries: ['{{profile.verified_contacts.email.value}}'],
      stashRefs: ['stash-1'],
      encryptedKeys: '0x-encrypted-vault-key',
      otpSecret: 'DAVID_SECRET_KEY'
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('active');
    expect(mockKv['epoch:switch:test-switch-001']).toBeDefined();
    expect(mockKv['epoch:vault:test-switch-001']).toBeDefined();
  });

  // Generate 50 unique active offset heartbeat check tests (tests 2 to 51)
  for (let i = 2; i <= 51; i++) {
    test(`${i.toString().padStart(3, '0')}: should reset clock when valid heartbeat OTP is sent at offset ${i}h`, () => {
      const offsetMs = i * 60 * 60 * 1000;
      const futureTime = mockTime + offsetMs;
      const counter = Math.floor(futureTime / 30000);
      const code = calculateTotpSha256('DAVID_SECRET_KEY', counter);

      const res = runWasm('heartbeat', {
        switchId: 'test-switch-001',
        otpCode: code,
        clockOffset: offsetMs
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('active');
    });
  }

  // Generate 50 unique trigger expiration evaluation tests (tests 52 to 101)
  for (let i = 52; i <= 101; i++) {
    test(`${i.toString().padStart(3, '0')}: should expire switch if offset ${14 + i} days exceeds grace period`, () => {
      const offsetMs = (14 + i) * 24 * 60 * 60 * 1000;

      const res = runWasm('check_trigger', {
        switchId: 'test-switch-001',
        clockOffset: offsetMs
      });

      expect(res.expired).toBe(true);
      expect(res.status).toBe('expired');
    });
  }
});
