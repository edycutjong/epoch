import { describe, test, expect } from 'vitest';
import { verifyVc, base64UrlDecode } from '../src/lib/vcVerifier';

// Simple base64 encoding helper for test setup
function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('VC Verifier Client-Side Helper', () => {
  test('should correctly base64url-decode standard strings', () => {
    const original = 'Hello World! ⏳';
    const encoded = base64UrlEncode(original);
    const decoded = base64UrlDecode(encoded);
    expect(decoded).toBe(original);
  });

  test('should successfully verify a valid simulated VC JWT', () => {
    const claims = {
      switchId: 'test-123',
      firedAt: 1729600000000,
      deliveredBeneficiaries: ['friend@legacy-switch.org'],
      releasedStashKeys: '0x-keys'
    };

    const header = JSON.stringify({ alg: 'EdDSA', typ: 'JWT' });
    const payload = JSON.stringify({
      sub: 'did:t3n:test-123',
      iss: 'did:t3n:enclave-authority',
      nbf: 1729600000,
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'LegacyReleaseCredential'],
        credentialSubject: claims
      }
    });

    // Mock signature (first 16 bytes of payload string -> hex string)
    const payloadBytes = new TextEncoder().encode(payload);
    const sliced = payloadBytes.slice(0, 16);
    let hex = '';
    for (let i = 0; i < sliced.length; i++) {
      hex += sliced[i].toString(16).padStart(2, '0');
    }
    const expectedSig = 'sig-' + hex;

    const jwt = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.${base64UrlEncode(expectedSig)}`;

    const result = verifyVc(jwt);
    expect(result.success).toBe(true);
    expect(result.claims).toEqual(claims);
  });

  test('should fail if JWT is empty or malformed', () => {
    expect(verifyVc('').success).toBe(false);
    expect(verifyVc('abc.def').success).toBe(false);
  });

  test('should fail if JWT header has invalid alg or typ', () => {
    const badHeader = JSON.stringify({ alg: 'HS256', typ: 'JWT' });
    const payload = JSON.stringify({
      iss: 'did:t3n:enclave-authority',
      vc: { type: ['VerifiableCredential', 'LegacyReleaseCredential'] }
    });
    const jwt = `${base64UrlEncode(badHeader)}.${base64UrlEncode(payload)}.sig-123`;
    const result = verifyVc(jwt);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JWT header');
  });

  test('should fail if issuer is incorrect', () => {
    const header = JSON.stringify({ alg: 'EdDSA', typ: 'JWT' });
    const payload = JSON.stringify({
      iss: 'did:t3n:malicious-authority',
      vc: { type: ['VerifiableCredential', 'LegacyReleaseCredential'] }
    });
    const jwt = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.sig-123`;
    const result = verifyVc(jwt);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issuer');
  });

  test('should fail if VC types are missing or incorrect', () => {
    const header = JSON.stringify({ alg: 'EdDSA', typ: 'JWT' });
    const payload = JSON.stringify({
      iss: 'did:t3n:enclave-authority',
      vc: { type: ['VerifiableCredential'] }
    });
    const jwt = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.sig-123`;
    const result = verifyVc(jwt);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid VC structure');
  });

  test('should fail if signature verification does not match', () => {
    const header = JSON.stringify({ alg: 'EdDSA', typ: 'JWT' });
    const payload = JSON.stringify({
      iss: 'did:t3n:enclave-authority',
      vc: { type: ['VerifiableCredential', 'LegacyReleaseCredential'] }
    });
    const jwt = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.${base64UrlEncode('sig-wrongsignature')}`;
    const result = verifyVc(jwt);
    expect(result.success).toBe(false);
    expect(result.error).toContain('signature verification failed');
  });

  test('should handle invalid JSON or decoding failures gracefully', () => {
    const badHeader = base64UrlEncode('not-json');
    const jwt = `${badHeader}.payloadB64.signature`;
    const result = verifyVc(jwt);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Parsing failed');
  });
});
