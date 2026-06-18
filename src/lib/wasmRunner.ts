import fs from 'fs';
import path from 'path';
import { getKv, setKv, readDb, writeDb, getStash, setStash } from './db';

// Simple base64 encoding helper for VCs
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function runWasmContract(
  functionName: 'arm_switch' | 'heartbeat' | 'check_trigger' | 'fire_epoch' | 'cancel' | 'get_status',
  requestPayload: any
): Promise<any> {
  const wasmPath = path.resolve(process.cwd(), 'src/lib/epoch_contract.wasm');
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WebAssembly binary not found at ${wasmPath}. Run cargo build first.`);
  }

  const wasmBuffer = fs.readFileSync(wasmPath);

  // We need to keep a reference to Wasm memory to read/write from imported functions
  let wasmMemory: WebAssembly.Memory;

  // Helper: Read a string from Wasm memory
  const readStringFromWasm = (ptr: number, len: number): string => {
    const memView = new Uint8Array(wasmMemory.buffer, ptr, len);
    return new TextDecoder().decode(memView);
  };

  // Helper: Write a string to Wasm memory (using a preallocated buffer)
  const writeStringToWasm = (str: string, ptr: number, maxLen: number): number => {
    const encoded = new TextEncoder().encode(str);
    const len = Math.min(encoded.length, maxLen);
    const memView = new Uint8Array(wasmMemory.buffer, ptr, maxLen);
    memView.set(encoded.slice(0, len));
    return len;
  };

  // Host imports object
  const importObject = {
    env: {
      host_kv_store_get: (keyPtr: number, keyLen: number, valBufPtr: number, valBufLen: number): number => {
        const key = readStringFromWasm(keyPtr, keyLen);
        const value = getKv(key);
        if (value === null) {
          return -1;
        }
        return writeStringToWasm(value, valBufPtr, valBufLen);
      },

      host_kv_store_set: (keyPtr: number, keyLen: number, valPtr: number, valLen: number): number => {
        const key = readStringFromWasm(keyPtr, keyLen);
        const value = readStringFromWasm(valPtr, valLen);
        setKv(key, value);
        return 0;
      },

      host_clock_now: (): bigint => {
        // Return current wall clock in milliseconds (bigint for u64)
        return BigInt(Date.now());
      },

      host_stash_put: (dataPtr: number, dataLen: number, refBufPtr: number, refBufLen: number): number => {
        const memView = new Uint8Array(wasmMemory.buffer, dataPtr, dataLen);
        const dataBase64 = Buffer.from(memView).toString('base64');
        const refId = `ref-${Math.random().toString(36).substr(2, 9)}`;
        const refStr = `stash://${refId}`;
        setStash(refStr, dataBase64);
        
        console.log(`[Host Stash] Uploaded ${dataLen} bytes to stash, reference: ${refStr}`);
        return writeStringToWasm(refStr, refBufPtr, refBufLen);
      },

      host_stash_get: (refPtr: number, refLen: number, dataBufPtr: number, dataBufLen: number): number => {
        const refStr = readStringFromWasm(refPtr, refLen);
        const dataBase64 = getStash(refStr);
        if (dataBase64 === null) {
          console.error(`[Host Stash] Stash reference not found: ${refStr}`);
          return -1;
        }
        const buffer = Buffer.from(dataBase64, 'base64');
        
        const memView = new Uint8Array(wasmMemory.buffer, dataBufPtr, dataBufLen);
        const writeLen = Math.min(buffer.length, dataBufLen);
        memView.set(buffer.slice(0, writeLen));
        console.log(`[Host Stash] Downloaded ${writeLen} bytes from stash: ${refStr}`);
        return writeLen;
      },

      host_http_with_placeholders_post: (
        urlPtr: number, urlLen: number,
        bodyPtr: number, bodyLen: number,
        resBufPtr: number, resBufLen: number
      ): number => {
        const url = readStringFromWasm(urlPtr, urlLen);
        const body = readStringFromWasm(bodyPtr, bodyLen);
        console.log(`[Host Egress] Received POST to ${url} with placeholder body: ${body}`);

        // Resolve profile placeholders
        const db = readDb();
        const activeDid = process.env.DID || "did:t3n:david123";
        const profile = db.profiles[activeDid] || db.profiles["did:t3n:david123"] || {
          first_name: "David",
          verified_contacts: { email: { value: "david@legacy-switch.org" } }
        };

        // Standard substitute markers: {{profile.first_name}}, {{profile.verified_contacts.email.value}}
        let resolvedBody = body;
        resolvedBody = resolvedBody.replace(/\{\{profile\.first_name\}\}/g, profile.first_name);
        resolvedBody = resolvedBody.replace(
          /\{\{profile\.verified_contacts\.email\.value\}\}/g,
          profile.verified_contacts?.email?.value || "spouse@legacy-switch.org"
        );

        console.log(`[Host Egress] Egress filter resolved body: ${resolvedBody}`);

        // Extract beneficiary contact details from resolved body for simulation
        let recipient = "spouse@legacy-switch.org";
        try {
          const parsed = JSON.parse(resolvedBody);
          if (parsed.recipient) recipient = parsed.recipient;
        } catch (e) {}

        // Log this delivery to database so dashboard can fetch and show it
        const notification = {
          timestamp: Date.now(),
          url,
          originalBody: body,
          resolvedBody,
          recipient,
          status: "delivered",
          receiptId: `rcpt-${Math.random().toString(36).substr(2, 9)}`
        };

        db.dispatchedNotifications = db.dispatchedNotifications || [];
        db.dispatchedNotifications.push(notification);
        writeDb(db);

        // Return a mock response
        const responseJson = JSON.stringify({
          status: "delivered",
          receiptId: notification.receiptId
        });

        return writeStringToWasm(responseJson, resBufPtr, resBufLen);
      },

      host_signing_issue_vc: (
        subjectPtr: number, subjectLen: number,
        claimsPtr: number, claimsLen: number,
        vcBufPtr: number, vcBufLen: number
      ): number => {
        const subject = readStringFromWasm(subjectPtr, subjectLen);
        let claims = readStringFromWasm(claimsPtr, claimsLen);

        console.log(`[Host Signing] Issuing VC for subject=${subject}, claims=${claims}`);

        let claimsObj: any = {};
        try {
          // Sanitize claims string from any potential null-bytes or control characters
          const sanitizedClaims = claims.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
          claimsObj = JSON.parse(sanitizedClaims);
        } catch (e: any) {
          console.error(`[Host Signing Error] Failed to parse claims JSON: ${e.message}`);
          console.error(`Claims raw string length: ${claims.length}`);
          const charCodes = [];
          for (let i = 0; i < Math.min(claims.length, 100); i++) {
            charCodes.push(`${claims[i]} (${claims.charCodeAt(i)})`);
          }
          console.error(`Claims char codes: ${charCodes.join(', ')}`);
          
          // Fallback parsing strategy or default object to prevent crashing
          try {
            // Attempt to clean single quotes or malformations
            let fallback = claims.replace(/'/g, '"').replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();
            claimsObj = JSON.parse(fallback);
          } catch (err) {
            console.error(`[Host Signing Fallback Error] Fallback also failed: ${err}`);
            claimsObj = {
              switchId: subject.replace("did:t3n:", ""),
              firedAt: Date.now(),
              error: "claims_parse_failed"
            };
          }
        }

        // Construct a mock Verifiable Credential (W3C format)
        const header = JSON.stringify({ alg: "EdDSA", typ: "JWT" });
        const payload = JSON.stringify({
          sub: subject,
          iss: "did:t3n:enclave-authority",
          nbf: Math.floor(Date.now() / 1000),
          vc: {
            "@context": [
              "https://www.w3.org/2018/credentials/v1"
            ],
            type: ["VerifiableCredential", "LegacyReleaseCredential"],
            credentialSubject: claimsObj
          }
        });

        // Mock signature using simple SHA256 string hash representation
        const signature = "sig-" + Buffer.from(payload).slice(0, 16).toString('hex');
        const jwt = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.${base64UrlEncode(signature)}`;

        const vcResponse = JSON.stringify({
          credential: jwt,
          issuer: "did:t3n:enclave-authority",
          subject,
          claims: claimsObj
        });

        return writeStringToWasm(vcResponse, vcBufPtr, vcBufLen);
      },

      host_logging_log: (msgPtr: number, msgLen: number): void => {
        const msg = readStringFromWasm(msgPtr, msgLen);
        console.log(`[Contract Log] ${msg}`);
      }
    }
  };

  // Instantiate Wasm Module
  const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
  
  // Expose memory reference to imports
  wasmMemory = instance.exports.memory as WebAssembly.Memory;

  const allocFn = instance.exports.alloc as (size: number) => number;
  const deallocFn = instance.exports.dealloc as (ptr: number, size: number) => void;
  const contractFn = instance.exports[functionName] as (ptr: number, len: number) => bigint;

  if (!contractFn) {
    throw new Error(`Exported function ${functionName} not found in WebAssembly binary.`);
  }

  // 1. Serialize request payload to JSON
  const requestJson = JSON.stringify(requestPayload);
  const requestBytes = new TextEncoder().encode(requestJson);

  // 2. Allocate memory in Wasm and write payload
  const requestPtr = allocFn(requestBytes.length);
  const memView = new Uint8Array(wasmMemory.buffer, requestPtr, requestBytes.length);
  memView.set(requestBytes);

  // 3. Invoke contract function
  let packedResult: bigint;
  try {
    packedResult = contractFn(requestPtr, requestBytes.length);
  } finally {
    // Always deallocate request buffer
    deallocFn(requestPtr, requestBytes.length);
  }

  // 4. Unpack result (pointer in upper 32 bits, length in lower 32 bits)
  const resultPtr = Number(packedResult >> 32n);
  const resultLen = Number(packedResult & 0xffffffffn);

  // 5. Read and parse result JSON
  const resultJson = readStringFromWasm(resultPtr, resultLen);
  
  // Deallocate result buffer in Wasm
  deallocFn(resultPtr, resultLen);

  try {
    return JSON.parse(resultJson);
  } catch (e: any) {
    console.error(`[Wasm Runner Error] Failed to parse result JSON from function ${functionName}: ${e.message}`);
    console.error(`resultJson raw length: ${resultJson.length}`);
    console.error(`resultJson value: ${resultJson}`);
    const charCodes = [];
    for (let i = 0; i < Math.min(resultJson.length, 200); i++) {
      charCodes.push(`${resultJson[i]} (${resultJson.charCodeAt(i)})`);
    }
    console.error(`resultJson char codes: ${charCodes.join(', ')}`);
    throw e;
  }
}
