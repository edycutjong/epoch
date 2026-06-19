// Real Terminal 3 Verifiable Credential issuance + verification.
//
// Unlike the in-enclave mock signer (which runs at the synchronous WASM host
// boundary), the host "signing" service here issues a GENUINE W3C Verifiable
// Credential using the real published Terminal 3 SDK:
//   - @terminal3/ecdsa_vc   — EcdsaSecp256k1Signature2019 issuance
//   - @terminal3/verify_vc  — real cryptographic verification
// Everything runs offline (secp256k1 via ethers) with no credentials/network.
//
// SERVER-ONLY: imported by API routes (Node), never by client components.
import { EthrDID, createEcdsaCredential } from '@terminal3/ecdsa_vc';
import { verifyVc } from '@terminal3/verify_vc';
import { DID, randomKeyEcdsa, type SignedCredential } from '@terminal3/vc_core';

export const VC_ISSUE_SDK = '@terminal3/ecdsa_vc@0.1.34';
export const VC_VERIFY_SDK = '@terminal3/verify_vc@0.0.38';

// Stable enclave-authority issuer for the process. Override with a real key via
// EPOCH_VC_ISSUER_KEY (32-byte hex); otherwise a sandbox key is generated once.
let cachedIssuer: EthrDID | null = null;
function getIssuer(): EthrDID {
  if (!cachedIssuer) {
    const key = process.env.EPOCH_VC_ISSUER_KEY || randomKeyEcdsa();
    cachedIssuer = new EthrDID(key);
  }
  return cachedIssuer;
}

export interface ReleaseVcEnvelope {
  credential: SignedCredential;
  issuer: string;
  subject: string;
  sdk: string;
  verifyWith: string;
}

/**
 * Issue a real, signed `LegacyReleaseCredential` over the cascade claims.
 * The subject is the switch identity (`did:t3n:<switchId>`).
 */
export async function issueReleaseVc(
  switchId: string,
  claims: Record<string, unknown>,
): Promise<ReleaseVcEnvelope> {
  const issuer = getIssuer();
  const subject = new DID('t3n', switchId); // did:t3n:<switchId>
  const credential = await createEcdsaCredential(
    issuer,
    subject,
    claims,
    ['VerifiableCredential', 'LegacyReleaseCredential'],
  );
  return {
    credential,
    issuer: issuer.did,
    subject: subject.did,
    sdk: VC_ISSUE_SDK,
    verifyWith: VC_VERIFY_SDK,
  };
}

/**
 * Verify a credential with the real Terminal 3 verifier. The SDK throws on a
 * signature/verificationMethod mismatch (e.g. a tampered VC), which we map to
 * an invalid result rather than propagating.
 */
export async function verifyReleaseVc(
  credential: SignedCredential,
): Promise<{ isValid: boolean; message: string; sdk: string }> {
  try {
    const res = await verifyVc(credential);
    return {
      isValid: !!res.isValid,
      message: res.message || (res.isValid ? 'Verification successful' : 'Verification failed'),
      sdk: VC_VERIFY_SDK,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Verification failed';
    return { isValid: false, message, sdk: VC_VERIFY_SDK };
  }
}
