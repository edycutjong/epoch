import { describe, it, expect } from 'vitest';
import { issueReleaseVc, verifyReleaseVc } from '../src/lib/realVc';

// These tests exercise the REAL published Terminal 3 SDK end-to-end, offline:
//   @terminal3/ecdsa_vc (issuance) + @terminal3/verify_vc (verification).
describe('Real Terminal 3 VC SDK integration', () => {
  it('issues a genuine, signed LegacyReleaseCredential', async () => {
    const env = await issueReleaseVc('ep-983b-18cf', {
      switchId: 'ep-983b-18cf',
      event: 'legacy.released',
      firedAt: 1781841701887,
    });
    expect(env.credential.proof.type).toBe('EcdsaSecp256k1Signature2019');
    expect(env.credential.proof.proofValue).toMatch(/^0x[0-9a-f]+$/i);
    expect(env.credential.type).toContain('LegacyReleaseCredential');
    expect(env.subject).toBe('did:t3n:ep-983b-18cf');
    expect(env.issuer.startsWith('did:ethr:')).toBe(true);
    expect(env.sdk).toContain('@terminal3/ecdsa_vc');
  });

  it('verifies a freshly issued VC as valid (real verifier)', async () => {
    const env = await issueReleaseVc('ep-verify', {
      switchId: 'ep-verify',
      event: 'legacy.released',
      firedAt: Date.now(),
    });
    const res = await verifyReleaseVc(env.credential);
    expect(res.isValid).toBe(true);
    expect(res.sdk).toContain('@terminal3/verify_vc');
  });

  it('rejects a tampered VC', async () => {
    const env = await issueReleaseVc('ep-tamper', {
      switchId: 'ep-tamper',
      event: 'legacy.released',
      firedAt: Date.now(),
    });
    const tampered = JSON.parse(JSON.stringify(env.credential));
    tampered.credentialSubject.switchId = 'HACKED';
    const res = await verifyReleaseVc(tampered);
    expect(res.isValid).toBe(false);
  });
});
