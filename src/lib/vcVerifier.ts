export function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
}

export interface VerificationResult {
  success: boolean;
  error?: string;
  claims?: any;
}

export function verifyVc(jwt: string): VerificationResult {
  try {
    if (!jwt) {
      return { success: false, error: 'Empty JWT credential' };
    }

    const parts = jwt.split('.');
    if (parts.length !== 3) {
      return { success: false, error: 'Malformed JWT: Must contain 3 parts' };
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode and parse header
    const headerStr = base64UrlDecode(headerB64);
    const header = JSON.parse(headerStr);
    if (header.alg !== 'EdDSA' || header.typ !== 'JWT') {
      return { success: false, error: `Invalid JWT header: alg=${header.alg}, typ=${header.typ}` };
    }

    // Decode and parse payload
    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr);

    if (payload.iss !== 'did:t3n:enclave-authority') {
      return { success: false, error: `Invalid issuer: ${payload.iss}` };
    }

    const vc = payload.vc;
    if (!vc || !Array.isArray(vc.type) || !vc.type.includes('VerifiableCredential') || !vc.type.includes('LegacyReleaseCredential')) {
      return { success: false, error: 'Invalid VC structure or credential types' };
    }

    // Verify mock signature (first 16 bytes of payload JSON -> hex string)
    const payloadBytes = new TextEncoder().encode(payloadStr);
    const sliced = payloadBytes.slice(0, 16);
    let hex = '';
    for (let i = 0; i < sliced.length; i++) {
      hex += sliced[i].toString(16).padStart(2, '0');
    }
    const expectedSig = 'sig-' + hex;

    const signatureStr = base64UrlDecode(signatureB64);
    if (signatureStr !== expectedSig) {
      return { success: false, error: 'Cryptographic signature verification failed' };
    }

    return {
      success: true,
      claims: vc.credentialSubject
    };
  } catch (e: any) {
    return { success: false, error: `Parsing failed: ${e.message}` };
  }
}
