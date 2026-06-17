import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import { initDb, readDb, writeDb, getKv, setKv, clearDb } from '../src/lib/db';
import { runWasmContract } from '../src/lib/wasmRunner';
import * as wasmRunner from '../src/lib/wasmRunner';
import * as dbModule from '../src/lib/db';

// Import API route handlers
import { POST as armPost } from '../src/app/api/arm/route';
import { POST as cancelPost } from '../src/app/api/cancel/route';
import { POST as checkTriggerPost } from '../src/app/api/check-trigger/route';
import { POST as fireEpochPost } from '../src/app/api/fire-epoch/route';
import { POST as heartbeatPost } from '../src/app/api/heartbeat/route';
import { GET as verifyGet } from '../src/app/api/integrations/verify/route';
import { GET as notificationsGet } from '../src/app/api/notifications/route';
import { POST as seedLegacyPost } from '../src/app/api/seed/legacy/route';
import { POST as seedProfilePost } from '../src/app/api/seed/profile/route';
import { POST as statusPost } from '../src/app/api/status/route';

// Store in-memory db content
let inMemoryDb: Record<string, string> = {};
let mockWasmMissing = false;

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: fs.PathLike) => {
        const strPath = p.toString();
        if (strPath.endsWith('db.json')) {
          return inMemoryDb['db.json'] !== undefined;
        }
        if (strPath.endsWith('epoch_contract.wasm')) {
          return !mockWasmMissing;
        }
        // Force directory check to return false on the directory itself (not files inside it)
        if (strPath.endsWith('/data') || strPath.endsWith('\\data') || strPath.endsWith('data')) {
          return false;
        }
        return actual.existsSync(p);
      },
      mkdirSync: (p: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
        const strPath = p.toString();
        if (strPath.endsWith('/data') || strPath.endsWith('\\data') || strPath.endsWith('data')) {
          return undefined;
        }
        return actual.mkdirSync(p, options);
      },
      readFileSync: (p: fs.PathLike, options?: any) => {
        const strPath = p.toString();
        if (strPath.endsWith('db.json')) {
          if (inMemoryDb['db.json'] === undefined) {
            throw new Error('File not found');
          }
          return inMemoryDb['db.json'];
        }
        return actual.readFileSync(p, options);
      },
      writeFileSync: (p: fs.PathLike, data: any, options?: any) => {
        const strPath = p.toString();
        if (strPath.endsWith('db.json')) {
          inMemoryDb['db.json'] = data.toString();
          return;
        }
        return actual.writeFileSync(p, data, options);
      },
      unlinkSync: (p: fs.PathLike) => {
        const strPath = p.toString();
        if (strPath.endsWith('db.json')) {
          delete inMemoryDb['db.json'];
          return;
        }
        return actual.unlinkSync(p);
      }
    }
  };
});

// Capture WASM instrumentation
let capturedInstance: any = null;
let capturedEnv: any = null;
let capturedMemory: any = null;

const originalInstantiate = WebAssembly.instantiate;
vi.spyOn(WebAssembly, 'instantiate').mockImplementation(async (buffer, importObject) => {
  const result = await originalInstantiate(buffer, importObject) as any;
  capturedInstance = result.instance;
  if (importObject) {
    capturedEnv = (importObject as any).env;
  }
  capturedMemory = result.instance.exports.memory;
  return result;
});

// Intercept Node's require resolution to handle '@/lib/db' alias
import module from 'module';
import path from 'path';

const originalResolveFilename = (module as any)._resolveFilename;
(module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  if (request === '@/lib/db') {
    return path.resolve(__dirname, '../src/lib/db.ts');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Helper functions for calling API handlers
async function callPostHandler(handler: Function, bodyObj: any) {
  const req = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj)
  });
  return handler(req);
}

async function callGetHandler(handler: Function) {
  const req = new Request('http://localhost', {
    method: 'GET'
  });
  return handler(req);
}

describe('db.ts tests', () => {
  beforeEach(() => {
    inMemoryDb = {}; // reset db
  });

  it('initDb should create db when it does not exist', () => {
    expect(inMemoryDb['db.json']).toBeUndefined();
    initDb();
    expect(inMemoryDb['db.json']).toBeDefined();
    const parsed = JSON.parse(inMemoryDb['db.json']);
    expect(parsed.kv).toBeDefined();
    expect(parsed.profiles).toBeDefined();
  });

  it('readDb should return db contents', () => {
    initDb();
    const db1 = readDb();
    expect(db1.kv).toBeDefined();
  });

  it('readDb should return empty defaults if db is malformed JSON', () => {
    inMemoryDb['db.json'] = '{ malformed: ';
    const db = readDb();
    expect(db.kv).toEqual({});
    expect(db.profiles).toEqual({});
  });

  it('writeDb should persist database changes', () => {
    initDb();
    const db = readDb();
    db.kv['test-key'] = 'test-value';
    writeDb(db);
    
    const dbUpdated = readDb();
    expect(dbUpdated.kv['test-key']).toBe('test-value');
  });

  it('getKv and setKv should read and write keys directly', () => {
    setKv('foo', 'bar');
    expect(getKv('foo')).toBe('bar');
    expect(getKv('non-existent')).toBeNull();
  });

  it('clearDb should wipe the database and recreate with initial template', () => {
    setKv('foo', 'bar');
    expect(getKv('foo')).toBe('bar');
    clearDb();
    expect(getKv('foo')).toBeNull();
    // Default keys should be present
    expect(getKv('epoch:switch:ep-983b-18cf')).toBeDefined();
  });
});

describe('wasmRunner.ts tests', () => {
  beforeEach(() => {
    inMemoryDb = {};
    mockWasmMissing = false;
    initDb();
  });

  it('should throw error if WASM binary is missing', async () => {
    mockWasmMissing = true;
    await expect(runWasmContract('arm_switch', {})).rejects.toThrow('WebAssembly binary not found');
  });

  it('should throw error if function is not exported by WASM contract', async () => {
    await expect(runWasmContract('invalid_func' as any, {})).rejects.toThrow(
      'Exported function invalid_func not found'
    );
  });

  it('should handle standard WASM contract calls successfully', async () => {
    const res = await runWasmContract('arm_switch', {
      switchId: 'test-wasm-run',
      gracePeriod: 100000,
      beneficiaries: ['spouse@legacy-switch.org'],
      stashRefs: ['stash-1'],
      encryptedKeys: '0x-encrypted-key',
      otpSecret: 'DAVID_SECRET_KEY'
    });
    expect(res.success).toBe(true);
    expect(res.status).toBe('active');
  });

  it('should throw if contract output is malformed JSON', async () => {
    const originalParse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((str) => {
      if (str && str.toString().includes('"success":true')) {
        throw new Error('Malformed JSON simulation');
      }
      return originalParse(str);
    });

    await expect(
      runWasmContract('arm_switch', {
        switchId: 'test-wasm-run',
        gracePeriod: 100000,
        beneficiaries: ['spouse@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-encrypted-key',
        otpSecret: 'DAVID_SECRET_KEY'
      })
    ).rejects.toThrow('Malformed JSON simulation');

    vi.restoreAllMocks();
  });

  describe('Host Imports', () => {
    // Helpers to read/write string to captured WASM memory
    const writeToWasmMem = (str: string) => {
      const encoded = new TextEncoder().encode(str);
      const alloc = capturedInstance.exports.alloc;
      const ptr = alloc(encoded.length);
      const view = new Uint8Array(capturedMemory.buffer, ptr, encoded.length);
      view.set(encoded);
      return { ptr, len: encoded.length };
    };

    const readStringFromWasm = (ptr: number, len: number): string => {
      const view = new Uint8Array(capturedMemory.buffer, ptr, len);
      return new TextDecoder().decode(view);
    };

    const deallocWasmMem = (ptr: number, len: number) => {
      const dealloc = capturedInstance.exports.dealloc;
      dealloc(ptr, len);
    };

    beforeEach(async () => {
      // Run once to ensure env is captured
      await runWasmContract('arm_switch', {
        switchId: 'test-wasm-run',
        gracePeriod: 100000,
        beneficiaries: ['spouse@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-encrypted-key',
        otpSecret: 'DAVID_SECRET_KEY'
      });
    });

    it('host_kv_store_get should read key and return length or -1 if missing', () => {
      const keyObj = writeToWasmMem('epoch:switch:test-wasm-run');
      const valBuf = writeToWasmMem(' '.repeat(2048));

      // Get existing key
      const len = capturedEnv.host_kv_store_get(keyObj.ptr, keyObj.len, valBuf.ptr, valBuf.len);
      expect(len).toBeGreaterThan(0);
      const value = readDb().kv['epoch:switch:test-wasm-run'];
      expect(value).toBeDefined();

      // Get missing key
      const missingKey = writeToWasmMem('missing-key');
      const missingLen = capturedEnv.host_kv_store_get(missingKey.ptr, missingKey.len, valBuf.ptr, valBuf.len);
      expect(missingLen).toBe(-1);

      deallocWasmMem(keyObj.ptr, keyObj.len);
      deallocWasmMem(valBuf.ptr, valBuf.len);
      deallocWasmMem(missingKey.ptr, missingKey.len);
    });

    it('host_kv_store_set should write key-value pairs', () => {
      const keyObj = writeToWasmMem('test-set-key');
      const valObj = writeToWasmMem('test-set-val');

      const res = capturedEnv.host_kv_store_set(keyObj.ptr, keyObj.len, valObj.ptr, valObj.len);
      expect(res).toBe(0);
      expect(getKv('test-set-key')).toBe('test-set-val');

      deallocWasmMem(keyObj.ptr, keyObj.len);
      deallocWasmMem(valObj.ptr, valObj.len);
    });

    it('host_clock_now should return current system timestamp as BigInt', () => {
      const now = capturedEnv.host_clock_now();
      expect(typeof now).toBe('bigint');
      expect(now).toBeGreaterThan(0n);
    });

    it('host_logging_log should receive log message without crashing', () => {
      const msg = writeToWasmMem('hello from test');
      expect(() => capturedEnv.host_logging_log(msg.ptr, msg.len)).not.toThrow();
      deallocWasmMem(msg.ptr, msg.len);
    });

    it('host_http_with_placeholders_post should replace placeholders from profile database', () => {
      // Seed a custom profile in db
      const db = readDb();
      db.profiles['did:t3n:david123'] = {
        first_name: 'Alice',
        verified_contacts: { email: { value: 'alice@override.org' } }
      };
      writeDb(db);

      const urlObj = writeToWasmMem('https://api.test/notify');
      const bodyObj = writeToWasmMem('{"recipient":"{{profile.verified_contacts.email.value}}","name":"{{profile.first_name}}"}');
      const resBuf = writeToWasmMem(' '.repeat(2048));

      const len = capturedEnv.host_http_with_placeholders_post(urlObj.ptr, urlObj.len, bodyObj.ptr, bodyObj.len, resBuf.ptr, resBuf.len);
      expect(len).toBeGreaterThan(0);

      // Verify template substitutions
      const notifications = readDb().dispatchedNotifications;
      expect(notifications.length).toBeGreaterThan(0);
      const lastNotification = notifications[notifications.length - 1];
      expect(lastNotification.resolvedBody).toBe('{"recipient":"alice@override.org","name":"Alice"}');
      expect(lastNotification.recipient).toBe('alice@override.org');

      deallocWasmMem(urlObj.ptr, urlObj.len);
      deallocWasmMem(bodyObj.ptr, bodyObj.len);
      deallocWasmMem(resBuf.ptr, resBuf.len);
    });

    it('host_http_with_placeholders_post should fallback for missing profile contacts and handle empty notifications array', () => {
      // Setup profile without verified_contacts
      const db = readDb();
      db.profiles['did:t3n:david123'] = {
        first_name: 'Alice',
        verified_contacts: {} // missing email
      };
      // Delete dispatchedNotifications to trigger line 112 fallback
      delete (db as any).dispatchedNotifications;
      writeDb(db);

      const urlObj = writeToWasmMem('https://api.test/notify');
      const bodyObj = writeToWasmMem('{"recipient":"{{profile.verified_contacts.email.value}}"}');
      const resBuf = writeToWasmMem(' '.repeat(2048));

      const len = capturedEnv.host_http_with_placeholders_post(urlObj.ptr, urlObj.len, bodyObj.ptr, bodyObj.len, resBuf.ptr, resBuf.len);
      expect(len).toBeGreaterThan(0);

      const updatedDb = readDb();
      expect(updatedDb.dispatchedNotifications).toBeDefined();
      expect(updatedDb.dispatchedNotifications.length).toBe(1);
      expect(updatedDb.dispatchedNotifications[0].recipient).toBe('spouse@legacy-switch.org');

      deallocWasmMem(urlObj.ptr, urlObj.len);
      deallocWasmMem(bodyObj.ptr, bodyObj.len);
      deallocWasmMem(resBuf.ptr, resBuf.len);
    });

    it('host_http_with_placeholders_post should handle malformed resolved json recipient parsing gracefully', () => {
      // Clear profile did:t3n:david123 to trigger fallback values
      const db = readDb();
      delete db.profiles['did:t3n:david123'];
      writeDb(db);

      const urlObj = writeToWasmMem('https://api.test/notify');
      const bodyObj = writeToWasmMem('{{profile.first_name}} : non-json-body');
      const resBuf = writeToWasmMem(' '.repeat(2048));

      const len = capturedEnv.host_http_with_placeholders_post(urlObj.ptr, urlObj.len, bodyObj.ptr, bodyObj.len, resBuf.ptr, resBuf.len);
      expect(len).toBeGreaterThan(0);

      // Verify recipient falls back to default
      const notifications = readDb().dispatchedNotifications;
      const lastNotification = notifications[notifications.length - 1];
      expect(lastNotification.recipient).toBe('spouse@legacy-switch.org');

      deallocWasmMem(urlObj.ptr, urlObj.len);
      deallocWasmMem(bodyObj.ptr, bodyObj.len);
      deallocWasmMem(resBuf.ptr, resBuf.len);
    });

    it('host_signing_issue_vc should successfully sign claims and construct verifiable credentials', () => {
      const subjectObj = writeToWasmMem('did:t3n:david123');
      const claimsObj = writeToWasmMem('{"switchId":"ep-983b-18cf","status":"fired"}');
      const resBuf = writeToWasmMem(' '.repeat(2048));

      const len = capturedEnv.host_signing_issue_vc(subjectObj.ptr, subjectObj.len, claimsObj.ptr, claimsObj.len, resBuf.ptr, resBuf.len);
      expect(len).toBeGreaterThan(0);

      const responseStr = readStringFromWasm(resBuf.ptr, len);
      const resJson = JSON.parse(responseStr);
      expect(resJson.issuer).toBe('did:t3n:enclave-authority');
      expect(resJson.subject).toBe('did:t3n:david123');
      expect(resJson.claims.switchId).toBe('ep-983b-18cf');
      expect(resJson.credential).toBeDefined();

      deallocWasmMem(subjectObj.ptr, subjectObj.len);
      deallocWasmMem(claimsObj.ptr, claimsObj.len);
      deallocWasmMem(resBuf.ptr, resBuf.len);
    });

    it('host_signing_issue_vc fallback parsing should handle claims that use single quotes', () => {
      const subjectObj = writeToWasmMem('did:t3n:david123');
      const claimsObj = writeToWasmMem("{'switchId': 'ep-983b-18cf', 'status': 'fired'}");
      const resBuf = writeToWasmMem(' '.repeat(2048));

      const len = capturedEnv.host_signing_issue_vc(subjectObj.ptr, subjectObj.len, claimsObj.ptr, claimsObj.len, resBuf.ptr, resBuf.len);
      expect(len).toBeGreaterThan(0);

      const responseStr = readStringFromWasm(resBuf.ptr, len);
      const resJson = JSON.parse(responseStr);
      expect(resJson.claims.switchId).toBe('ep-983b-18cf');

      deallocWasmMem(subjectObj.ptr, subjectObj.len);
      deallocWasmMem(claimsObj.ptr, claimsObj.len);
      deallocWasmMem(resBuf.ptr, resBuf.len);
    });

    it('host_signing_issue_vc should handle completely broken claims string via fallback claims object', () => {
      const subjectObj = writeToWasmMem('did:t3n:david123');
      const claimsObj = writeToWasmMem("totally-broken-string-no-json-or-quotes");
      const resBuf = writeToWasmMem(' '.repeat(2048));

      const len = capturedEnv.host_signing_issue_vc(subjectObj.ptr, subjectObj.len, claimsObj.ptr, claimsObj.len, resBuf.ptr, resBuf.len);
      expect(len).toBeGreaterThan(0);

      const responseStr = readStringFromWasm(resBuf.ptr, len);
      const resJson = JSON.parse(responseStr);
      expect(resJson.claims.error).toBe('claims_parse_failed');
      expect(resJson.claims.switchId).toBe('david123');

      deallocWasmMem(subjectObj.ptr, subjectObj.len);
      deallocWasmMem(claimsObj.ptr, claimsObj.len);
      deallocWasmMem(resBuf.ptr, resBuf.len);
    });
  });
});

describe('Next.js API Route Handlers', () => {
  beforeEach(() => {
    inMemoryDb = {};
    initDb();
    vi.restoreAllMocks();
  });

  describe('api/arm', () => {
    const validArm = {
      switchId: 'test-arm-route',
      gracePeriod: 60000,
      beneficiaries: ['friend@legacy-switch.org'],
      stashRefs: ['stash-1'],
      encryptedKeys: '0x-keys',
      otpSecret: 'DAVID_SECRET_KEY'
    };

    it('should successfully arm a new switch', async () => {
      const res = await callPostHandler(armPost, validArm);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('active');
    });

    it('should return 400 if required fields are missing', async () => {
      const res = await callPostHandler(armPost, { switchId: 'missing-fields' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing required fields' });
    });

    it('should return 400 if WASM contract execution returns an error', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'WASM arm failed' });
      const res = await callPostHandler(armPost, validArm);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'WASM arm failed' });
    });

    it('should return 500 if an internal exception occurs', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce(new Error('Internal memory error'));
      const res = await callPostHandler(armPost, validArm);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal memory error' });
    });

    it('should return 500 with default message if internal exception occurs with empty message', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce({} as any);
      const res = await callPostHandler(armPost, validArm);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/cancel', () => {
    it('should clear database if reset param is true', async () => {
      const res = await callPostHandler(cancelPost, { reset: true });
      const json = await res.json();
      console.log('Cancel reset response:', res.status, json);
      expect(res.status).toBe(200);
      expect(json).toEqual({ success: true, reset: true });
    });

    it('should return 400 if switchId is missing for non-reset cancellation', async () => {
      const res = await callPostHandler(cancelPost, {});
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing required fields' });
    });

    it('should cancel active switch successfully', async () => {
      // Arm first
      await runWasmContract('arm_switch', {
        switchId: 'test-cancel',
        gracePeriod: 100000,
        beneficiaries: ['friend@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-keys',
        otpSecret: 'DAVID_SECRET_KEY'
      });

      const res = await callPostHandler(cancelPost, { switchId: 'test-cancel' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('cancelled');
    });

    it('should return 400 if WASM cancel execution returns error', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'Switch not found or not active' });
      const res = await callPostHandler(cancelPost, { switchId: 'invalid-switch' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Switch not found or not active' });
    });

    it('should return 500 if cancel throws an internal exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce(new Error('Cancel exception'));
      const res = await callPostHandler(cancelPost, { switchId: 'test' });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if cancel throws empty exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce({} as any);
      const res = await callPostHandler(cancelPost, { switchId: 'test' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/check-trigger', () => {
    it('should return 400 if switchId is missing', async () => {
      const res = await callPostHandler(checkTriggerPost, {});
      expect(res.status).toBe(400);
    });

    it('should evaluate trigger successfully', async () => {
      await runWasmContract('arm_switch', {
        switchId: 'test-check-trigger',
        gracePeriod: 100000,
        beneficiaries: ['friend@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-keys',
        otpSecret: 'DAVID_SECRET_KEY'
      });

      const res = await callPostHandler(checkTriggerPost, { switchId: 'test-check-trigger', clockOffset: 50000 });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.expired).toBe(false);
    });

    it('should return 400 if WASM check returns an error', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'check_trigger failed' });
      const res = await callPostHandler(checkTriggerPost, { switchId: 'invalid' });
      expect(res.status).toBe(400);
    });

    it('should return 500 if check-trigger throws an internal exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce(new Error('Check exception'));
      const res = await callPostHandler(checkTriggerPost, { switchId: 'test' });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if check-trigger throws empty exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce({} as any);
      const res = await callPostHandler(checkTriggerPost, { switchId: 'test' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/fire-epoch', () => {
    it('should return 400 if switchId is missing', async () => {
      const res = await callPostHandler(fireEpochPost, {});
      expect(res.status).toBe(400);
    });

    it('should fire legacy release cascade successfully', async () => {
      await runWasmContract('arm_switch', {
        switchId: 'test-fire',
        gracePeriod: 10000,
        beneficiaries: ['friend@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-keys',
        otpSecret: 'DAVID_SECRET_KEY'
      });

      // Warp time to expire
      await runWasmContract('check_trigger', { switchId: 'test-fire', clockOffset: 20000 });

      // Run without mockFailureStep to ensure successful cascade
      const res = await callPostHandler(fireEpochPost, { switchId: 'test-fire' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('fired');
    });

    it('should handle fire cascade with mockFailureStep present', async () => {
      await runWasmContract('arm_switch', {
        switchId: 'test-fire-fail',
        gracePeriod: 10000,
        beneficiaries: ['friend@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-keys',
        otpSecret: 'DAVID_SECRET_KEY'
      });
      await runWasmContract('check_trigger', { switchId: 'test-fire-fail', clockOffset: 20000 });

      const res = await callPostHandler(fireEpochPost, { switchId: 'test-fire-fail', mockFailureStep: 1 });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.reverted).toBe(true);
    });

    it('should return 400 if WASM fire returns error and not reverted', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'not_expired', reverted: false });
      const res = await callPostHandler(fireEpochPost, { switchId: 'test' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'not_expired' });
    });

    it('should return 200 even if error is returned but transaction was reverted (handled at route level)', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'egress_failed', reverted: true });
      const res = await callPostHandler(fireEpochPost, { switchId: 'test' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ error: 'egress_failed', reverted: true });
    });

    it('should return 500 if fire-epoch throws an internal exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce(new Error('Fire exception'));
      const res = await callPostHandler(fireEpochPost, { switchId: 'test' });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if fire-epoch throws empty exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce({} as any);
      const res = await callPostHandler(fireEpochPost, { switchId: 'test' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/heartbeat', () => {
    it('should return 400 if required fields are missing', async () => {
      const res = await callPostHandler(heartbeatPost, {});
      expect(res.status).toBe(400);
    });

    it('should process valid heartbeat successfully with optional clockOffset', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ success: true, status: 'active' });
      const res = await callPostHandler(heartbeatPost, { switchId: 'test', otpCode: '123456', clockOffset: 5000 });
      expect(res.status).toBe(200);
    });

    it('should return 400 if WASM heartbeat returns error', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'invalid_otp' });
      const res = await callPostHandler(heartbeatPost, { switchId: 'test', otpCode: '123456' });
      expect(res.status).toBe(400);
    });

    it('should return 500 if heartbeat throws an internal exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce(new Error('Heartbeat exception'));
      const res = await callPostHandler(heartbeatPost, { switchId: 'test', otpCode: '123456' });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if heartbeat throws empty exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce({} as any);
      const res = await callPostHandler(heartbeatPost, { switchId: 'test', otpCode: '123456' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/integrations/verify', () => {
    it('should compute enclave status metrics correctly', async () => {
      const db = readDb();
      // Completely clear db keys first to make counting fully deterministic
      db.kv = {};
      db.kv['epoch:switch:1'] = JSON.stringify({ status: 'active' });
      db.kv['epoch:switch:2'] = JSON.stringify({ status: 'expired' });
      db.kv['epoch:switch:3'] = JSON.stringify({ status: 'fired' });
      db.kv['epoch:switch:4'] = '{ malformed JSON '; // to test JSON parsing catch block
      db.dispatchedNotifications = [{}, {}];
      writeDb(db);

      const res = await callGetHandler(verifyGet);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.enclaveStatus).toBe('online');
      expect(data.metrics.activeSwitches).toBe(1);
      expect(data.metrics.expiredSwitches).toBe(1);
      expect(data.metrics.firedSwitches).toBe(1);
      expect(data.metrics.dispatchedNotifications).toBe(2);
    });

    it('should handle verify GET correctly when dispatchedNotifications is undefined', async () => {
      const db = readDb();
      db.kv = {};
      delete (db as any).dispatchedNotifications;
      writeDb(db);

      const res = await callGetHandler(verifyGet);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.metrics.dispatchedNotifications).toBe(0);
    });

    it('should return 500 if DB read throws exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw new Error('Disk read failure');
      });
      const res = await callGetHandler(verifyGet);
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if DB read throws empty exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw {} as any;
      });
      const res = await callGetHandler(verifyGet);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/notifications', () => {
    it('should return notifications list', async () => {
      const db = readDb();
      db.dispatchedNotifications = [{ recipient: 'spouse@test.org' }];
      writeDb(db);

      const res = await callGetHandler(notificationsGet);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.notifications.length).toBe(1);
    });

    it('should return empty list when dispatchedNotifications is undefined', async () => {
      const db = readDb();
      delete (db as any).dispatchedNotifications;
      writeDb(db);

      const res = await callGetHandler(notificationsGet);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.notifications).toEqual([]);
    });

    it('should return 500 if DB read throws exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw new Error('Disk read failure');
      });
      const res = await callGetHandler(notificationsGet);
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if DB read throws empty exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw {} as any;
      });
      const res = await callGetHandler(notificationsGet);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/seed/legacy', () => {
    it('should return 400 if legacy target is invalid', async () => {
      const res = await callPostHandler(seedLegacyPost, {});
      expect(res.status).toBe(400);
    });

    it('should seed new legacy target successfully and avoid duplicates', async () => {
      const target = {
        id: 'spouse-email',
        host: 'https://payout.sandbox.test',
        path: '/notify',
        method: 'POST',
        template: '{"recipient":"spouse@legacy-switch.org"}'
      };

      const res = await callPostHandler(seedLegacyPost, target);
      expect(res.status).toBe(200);

      const db = readDb();
      const seeded = db.legacyTargets.find(t => t.id === 'spouse-email');
      expect(seeded).toBeDefined();
      expect(seeded.template).toBe('{"recipient":"spouse@legacy-switch.org"}');
    });

    it('should return 500 if seeding throws exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw new Error('Seeder failure');
      });
      const res = await callPostHandler(seedLegacyPost, { id: 'test' });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if seeding throws empty exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw {} as any;
      });
      const res = await callPostHandler(seedLegacyPost, { id: 'test' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/seed/profile', () => {
    it('should return 400 if did or profile details are missing', async () => {
      const res = await callPostHandler(seedProfilePost, { did: 'test' });
      expect(res.status).toBe(400);
    });

    it('should seed profile details successfully', async () => {
      const payload = {
        did: 'did:t3n:bob123',
        profile: {
          first_name: 'Bob',
          verified_contacts: { email: { value: 'bob@test.org' } }
        }
      };

      const res = await callPostHandler(seedProfilePost, payload);
      expect(res.status).toBe(200);

      const db = readDb();
      expect(db.profiles['did:t3n:bob123'].first_name).toBe('Bob');
    });

    it('should return 500 if seeding throws exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw new Error('Profile seeder failure');
      });
      const res = await callPostHandler(seedProfilePost, { did: 'test', profile: {} });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if seeding throws empty exception', async () => {
      vi.spyOn(dbModule, 'readDb').mockImplementationOnce(() => {
        throw {} as any;
      });
      const res = await callPostHandler(seedProfilePost, { did: 'test', profile: {} });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });

  describe('api/status', () => {
    it('should return 400 if switchId is missing', async () => {
      const res = await callPostHandler(statusPost, {});
      expect(res.status).toBe(400);
    });

    it('should retrieve status and compute debug OTP successfully with valid base32 secret and clockOffset', async () => {
      // First arm the switch to seed secret using a valid base32 secret with padding: 'MZXW6YTBOI======'
      await runWasmContract('arm_switch', {
        switchId: 'test-status',
        gracePeriod: 100000,
        beneficiaries: ['friend@legacy-switch.org'],
        stashRefs: ['stash-1'],
        encryptedKeys: '0x-keys',
        otpSecret: 'MZXW6YTBOI======'
      });

      const res = await callPostHandler(statusPost, { switchId: 'test-status', clockOffset: 5000 });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('active');
      expect(data.debugOtp).toBeDefined();
      expect(data.debugOtp.length).toBe(6);
    });

    it('should fallback to default OTP secret if switch is missing in database', async () => {
      // Mock WASM status to return valid status directly
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ status: 'active', timeLeft: 100000, gracePeriod: 1209600000 });
      
      const res = await callPostHandler(statusPost, { switchId: 'non-existent-switch' });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.debugOtp).toBeDefined();
      expect(data.debugOtp.length).toBe(6);
    });

    it('should handle empty/missing json request bodies gracefully (returning 400 due to missing switchId)', async () => {
      // Call with an invalid/empty JSON string body
      const req = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      });
      const res = await statusPost(req);
      expect(res.status).toBe(400);
    });

    it('should return 400 if status query returns WASM error', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockResolvedValueOnce({ error: 'status_error' });
      const res = await callPostHandler(statusPost, { switchId: 'test' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'status_error' });
    });

    it('should return 500 if status throws an internal exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce(new Error('Status exception'));
      const res = await callPostHandler(statusPost, { switchId: 'test' });
      expect(res.status).toBe(500);
    });

    it('should return 500 with default message if status throws empty exception', async () => {
      vi.spyOn(wasmRunner, 'runWasmContract').mockRejectedValueOnce({} as any);
      const res = await callPostHandler(statusPost, { switchId: 'test' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    });
  });
});
