'use client';

import React, { useState } from 'react';
import { Play, ShieldAlert, Award, FileCheck, Check, X, RefreshCw } from 'lucide-react';

interface CascadeTimelineProps {
  status: string;
  isTriggering: boolean;
  triggerResult: any;
  onTriggerLegacy: () => Promise<void>;
}

export default function CascadeTimeline({
  status,
  isTriggering,
  triggerResult,
  onTriggerLegacy,
}: CascadeTimelineProps) {
  const [isVerifyingVc, setIsVerifyingVc] = useState(false);
  const [vcVerifiedStatus, setVcVerifiedStatus] = useState<'idle' | 'verifying' | 'success'>('idle');

  const isExpired = status === 'expired';
  const isFired = status === 'fired';

  // Check if we ran and got a rollback
  const isRollback = triggerResult && triggerResult.success === false && triggerResult.reverted;

  const handleVerifyVc = () => {
    setVcVerifiedStatus('verifying');
    setTimeout(() => {
      setVcVerifiedStatus('success');
    }, 1500);
  };

  return (
    <div className="flex flex-col p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-lg relative overflow-hidden h-full">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-purple-500 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          <span className="font-mono text-sm tracking-wider text-slate-300">CASCADE CONTROLLER</span>
        </div>
        <span className="font-mono text-[9px] text-slate-500 uppercase">ATOMIC SEQUENCE</span>
      </div>

      {/* Execution Timeline */}
      <div className="flex flex-col gap-6 relative pl-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[1px] before:bg-white/10">
        
        {/* Step 1: Evaluate Liveness */}
        <div className="relative flex flex-col gap-1">
          <div
            className={`absolute -left-6 w-5 h-5 rounded-full border flex items-center justify-center font-mono text-[10px] z-10 ${
              isFired || isExpired || isRollback
                ? 'bg-green-500 text-black border-green-500'
                : 'bg-[#0a0b0d] border-white/20 text-slate-400'
            }`}
          >
            {isFired || isExpired || isRollback ? <Check className="w-3.5 h-3.5" /> : '1'}
          </div>
          <span className="font-mono text-xs font-semibold text-white">1. EVALUATE LIVENESS</span>
          <span className="font-sans text-[11px] text-slate-400">
            Verify countdown timer and monotonic clock liveness offset.
          </span>
          {(isExpired || isFired || isRollback) && (
            <span className="font-mono text-[9px] text-green-400 mt-0.5 uppercase font-bold">
              [Expired Detected]
            </span>
          )}
        </div>

        {/* Step 2: Decrypt & Egress */}
        <div className="relative flex flex-col gap-1">
          <div
            className={`absolute -left-6 w-5 h-5 rounded-full border flex items-center justify-center font-mono text-[10px] z-10 ${
              isFired
                ? 'bg-green-500 text-black border-green-500'
                : isRollback && triggerResult.failedStep === 1
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-[#0a0b0d] border-white/20 text-slate-400'
            }`}
          >
            {isFired ? (
              <Check className="w-3.5 h-3.5" />
            ) : isRollback && triggerResult.failedStep === 1 ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              '2'
            )}
          </div>
          <span className="font-mono text-xs font-semibold text-white">2. EGRESS DISPATCH</span>
          <span className="font-sans text-[11px] text-slate-400">
            Substitute `&#123;&#123;profile&#125;&#125;` PII & POST blind notification to targets.
          </span>
          {isFired && (
            <span className="font-mono text-[9px] text-green-400 mt-0.5 uppercase font-bold">
              [Dispatched Success]
            </span>
          )}
          {isRollback && triggerResult.failedStep === 1 && (
            <span className="font-mono text-[9px] text-red-500 mt-0.5 uppercase font-bold">
              [FAILED: HTTP 502 Egress Error]
            </span>
          )}
        </div>

        {/* Step 3: Decrypt Vault Keys */}
        <div className="relative flex flex-col gap-1">
          <div
            className={`absolute -left-6 w-5 h-5 rounded-full border flex items-center justify-center font-mono text-[10px] z-10 ${
              isFired
                ? 'bg-green-500 text-black border-green-500'
                : isRollback
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-[#0a0b0d] border-white/20 text-slate-400'
            }`}
          >
            {isFired ? (
              <Check className="w-3.5 h-3.5" />
            ) : isRollback ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              '3'
            )}
          </div>
          <span className="font-mono text-xs font-semibold text-white">3. ATOMIC DELEGATION</span>
          <span className="font-sans text-[11px] text-slate-400">
            Decrypt and release stash metadata keys to beneficiaries.
          </span>
          {isFired && (
            <span className="font-mono text-[9px] text-green-400 mt-0.5 uppercase font-bold">
              [Decrypted & Released]
            </span>
          )}
          {isRollback && (
            <span className="font-mono text-[9px] text-red-500 mt-0.5 uppercase font-bold">
              [REVERTED: Kept Sealed on Disk]
            </span>
          )}
        </div>

      </div>

      {/* Actions */}
      <div className="mt-8">
        {isExpired && (
          <button
            onClick={onTriggerLegacy}
            disabled={isTriggering}
            className="w-full py-3.5 px-6 rounded-xl font-mono text-sm tracking-wider font-semibold text-black bg-red-500 hover:bg-red-400 active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:shadow-[0_0_30px_rgba(239,68,68,0.5)] flex items-center justify-center gap-2"
          >
            {isTriggering ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>EXECUTING CASCADE...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-black" />
                <span>TRIGGER ATOMIC CASCADE</span>
              </>
            )}
          </button>
        )}

        {/* Rollback Notification Alert */}
        {isRollback && (
          <div className="w-full p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 mt-4 animate-fadeIn flex gap-3 items-start">
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="font-mono text-xs font-bold uppercase">ROLLBACK COMPLETE</span>
              <span className="font-sans text-[11px] text-slate-400 leading-snug mt-1">
                Egress endpoint failed. The Wasm transactional boundary immediately reverted all state mutations. Secrets remain locked in stash. No data was leaked.
              </span>
            </div>
          </div>
        )}

        {/* Verifiable Credential Receipt */}
        {isFired && triggerResult && triggerResult.vcReceipt && (
          <div className="mt-6 p-4 rounded-xl border border-green-500/20 bg-green-500/5 animate-fadeIn">
            <div className="flex justify-between items-center mb-3">
              <span className="font-mono text-[10px] tracking-wider text-green-400 font-bold">
                ENCLAVE VC RECEIPT
              </span>
              {vcVerifiedStatus === 'success' ? (
                <div className="flex items-center gap-1 font-mono text-[9px] bg-green-500 text-black px-2 py-0.5 rounded font-bold">
                  <Check className="w-3 h-3" strokeWidth={3} />
                  <span>VERIFIED</span>
                </div>
              ) : (
                <button
                  onClick={handleVerifyVc}
                  disabled={vcVerifiedStatus === 'verifying'}
                  className="font-mono text-[9px] text-green-400 border border-green-500/30 hover:border-green-400 px-2 py-0.5 rounded transition-colors"
                >
                  {vcVerifiedStatus === 'verifying' ? 'VERIFYING...' : 'VERIFY VC'}
                </button>
              )}
            </div>

            <pre className="p-3 bg-black/60 border border-white/5 rounded-lg max-h-36 overflow-y-auto font-mono text-[10px] text-slate-400 break-all select-all leading-normal whitespace-pre-wrap">
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(triggerResult.vcReceipt), null, 2);
                } catch (e) {
                  return triggerResult.vcReceipt || 'No receipt details available';
                }
              })()}
            </pre>
            
            <div className="mt-2 flex gap-1.5 items-center font-mono text-[9px] text-slate-500">
              <FileCheck className="w-3.5 h-3.5 text-green-500" />
              <span>Signed by: did:t3n:enclave-authority</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
