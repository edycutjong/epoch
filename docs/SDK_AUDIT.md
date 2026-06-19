# Terminal 3 VC SDK — Confirmed Bug Report

**Submission for:** Terminal 3 Agent Dev Kit — Bug Discovery Bounty (Track 2)
**Method:** Downloaded the **published npm tarballs** with `npm pack @terminal3/<pkg>`, extracted the shipped `src/`, and read the actual source. **Every finding below is quoted from the real published package source** with `package@version → file:line` citations. Reproduce with the same `npm pack`.
**Audit date:** 2026-06-19

**Severity legend:** `blocker` · `major` · `minor` · `docs`

### Verified package versions
| Package | Version |
|---|---|
| `@terminal3/verify_vp` | 0.0.48 |
| `@terminal3/verify_vc` | 0.0.38 |
| `@terminal3/verify_vc_core` | 0.0.37 |
| `@terminal3/vc_core` | 0.0.37 |
| `@terminal3/bbs_vc` | 0.2.36 |
| `@terminal3/revoke_vc` | 0.1.33 |
| `@terminal3/ecdsa_vc` | 0.1.34 |

> These VC packages back the `signing` / verifiable-credential flows that every enclave in the Vouch Suite (Epoch, Lethe, Silo, Synod, Visor) relies on for receipts and delegation proofs, which is why we audited them.

---

## 1. BBS+ presentation verification uses a hardcoded `nonce` → proof replay
**Severity:** major · **Where:** `@terminal3/verify_vp@0.0.48` → `src/verifyVP.ts:56` and `src/verifyBbsVpW3c.ts:127`

Both BBS verification paths pass a **constant** nonce to `blsVerifyProof`:

```ts
// verifyVP.ts:52  (BbsPlusSignature2020Proof branch)
const res = await blsVerifyProof({
  proof: proofUint8, publicKey: publicKeyUint8, messages: messagesUint8,
  nonce: Uint8Array.from(Buffer.from('nonce', 'utf8')),   // ← hardcoded
});
// verifyBbsVpW3c.ts:123  (bbs-2023 DataIntegrityProof branch)
const res = await blsVerifyProof({
  proof: bbsProof, publicKey: publicKeyUint8, messages: messagesUint8,
  nonce: Uint8Array.from(Buffer.from('nonce', 'utf8')),   // ← hardcoded
});
```

**Expected:** the verifier supplies a fresh, per-request challenge/nonce so a derived BBS proof is bound to the current session.
**Impact:** every proof is verified against the literal bytes `"nonce"`. A holder proof derived once can be **replayed across sessions/verifiers** — there is no session binding. This is the core replay-protection primitive for selective-disclosure presentations.

## 2. No `challenge`/`domain`/`nonce` anywhere in the VP verification types
**Severity:** major · **Where:** `@terminal3/vc_core@0.0.37` → `src/types.ts:27` and `src/types.ts:43`

```ts
export interface VerifiablePresentation {   // :27
  holder: string;
  credentials: PartialCredential[];
}
export interface VerificationOptions {      // :43
  revocationRegistryAddress?; provider?; didRegistryAddress?;
  mandatoryPointers?; ethrDidRegistry?; signatureRole?; debug?;
}                                            // ← no challenge / nonce / domain
```

**Expected:** VP verification accepts a verifier challenge/domain.
**Impact:** even a developer who *wants* to do challenge-bound verification correctly cannot — the public types expose no field to carry it. Combined with #1, challenge binding is impossible through the public API.

## 3. `verifyPresentation()` never verifies a presentation-level holder proof
**Severity:** major · **Where:** `@terminal3/verify_vp@0.0.48` → `src/verifyVP.ts:12-103`

`verifyPresentation(vp, options)` maps over `vp.credentials` and verifies each credential's proof. It **never** checks a presentation-level proof, a holder signature, a challenge, or a domain (and `VerifiablePresentation` has no `proof` field to check — see #2).

**Impact:** a VP is accepted as a *bag of individually-valid credentials*, not as an **authenticated, fresh holder action**. Anyone who obtains a holder's previously-derived credentials can present them. For agent/holder delegation flows (the entire point of Agent Auth) this defeats holder binding and replay protection.

## 4. No public holder-side selective-disclosure (derive) API
**Severity:** major · **Where:** `@terminal3/bbs_vc@0.2.36` → `src/index.ts`; `@terminal3/verify_vp@0.0.48` → `src/index.ts`

```ts
// bbs_vc/src/index.ts — issuance + verifier helpers only
export * from './issueBbsVc'; export * from './verifyBbsVC';
export * from './rdfCanonicalize'; export * from './getMessagesW3c';
export * from './localLoader'; export * from './BbsDid';
// verify_vp/src/index.ts — verifier side only
export * from './verifyVP'; export * from './verifyBbsVpW3c';
```

**Impact:** the SDK exposes functions to **verify** a derived presentation but **none to create one** (`derivePresentation` / `createPresentation` / `makeBbsW3cProof`). Developers must reach into `@mattrglobal/bbs-signatures` internals themselves to produce the very objects `verifyPresentation()` consumes. The holder half of selective disclosure is missing from the public surface.

## 5. `verifyBbsVpW3c()` JSDoc documents the wrong cryptosuite
**Severity:** minor (docs) · **Where:** `@terminal3/verify_vp@0.0.48` → `src/verifyBbsVpW3c.ts:16-28`

The JSDoc says it verifies "*a signed selective disclosure derived document with **ECDSA-SD** procedures*" and `@param pubKey — the issuers **P256** public key`. The implementation actually calls `blsVerifyProof` (BBS+/BLS12-381). **Impact:** auditors/integrators get actively misleading cryptographic guidance.

## 6. Revocation is silently skipped unless the caller passes `revocationRegistryAddress`
**Severity:** major · **Where:** `@terminal3/verify_vc_core@0.0.37` → `src/verifyVC.ts:17`

```ts
export async function verifyVcNonSpecificPart(vc, options?) {
  // ...field + signature checks...
  if (options && options.revocationRegistryAddress) {   // ← only path that checks revocation
    if (!options.provider) throw new Error('Provider is required ...');
    if (await isRevoked(vc.id, vc.issuer, options))
      return { isValid: false, message: 'Credential has been revoked' };
  }
  return { isValid: true, message: 'Common verification successful' };
}
```

`CredentialPayload` carries an optional `credentialStatus` (`vc_core/src/types.ts`), but it is **never read**. If the caller does not pass `revocationRegistryAddress` (+ `provider`), a **revoked credential verifies as valid**. The `revoke_vc` README also shows verification called without these options, reinforcing the wrong expectation.
**Impact:** revocation bypass by default — a dangerous secure-by-omission failure for any app that assumes the SDK honors a credential's own `credentialStatus`.

## 7. `revokeVC()` resolves before the revocation transaction is mined (TOCTOU)
**Severity:** major · **Where:** `@terminal3/revoke_vc@0.1.33` → `src/revokeVC.ts:42`

```ts
const contract = new ethers.Contract(await options.revocationRegistryAddress,
  ['function revoke(string vcHash) public'], signer);
await contract.revoke(vcId);   // ← awaits tx *submission*, not .wait() (mining)
```

`revokeVC()` returns `Promise<void>` and resolves as soon as the transaction is **broadcast**, not **confirmed**, and returns no tx handle for the caller to await.
**Impact:** an `isRevoked()` / `verify` call immediately after `revokeVC()` resolves can still observe the credential as **valid** (time-of-check/time-of-use). Callers cannot reliably sequence "revoke → confirm revoked".

## 8. `revoke()` write ABI vs `revoked()` read ABI are asymmetric *(original observation — needs registry confirmation)*
**Severity:** minor · **Where:** `@terminal3/revoke_vc@0.1.33` → `src/revokeVC.ts:39` (write) vs `:69` (read)

The write path uses `function revoke(string vcHash)` and passes the **raw `vcId`** (not a hash), while the read path uses `function revoked(address issuer, string id)` keyed on `(issuer, vcId)`. The write call omits the issuer dimension and names its arg `vcHash` while a plain id is supplied. **Impact:** at minimum a naming/clarity defect; if the on-chain registry actually hashes the argument or keys differently between `revoke`/`revoked`, writes and reads could target different keys. Flagged as needs-confirmation against the deployed registry.

---

## Note on what is *not* broken
To avoid false positives, we confirmed the field-validity checks are **correct**: `verify_vc_core@0.0.37 → src/verifyVC.ts:51-58` properly rejects expired (`validUntil < now`) **and** not-yet-valid (`validFrom > now`) credentials. We report only what the source actually shows.
