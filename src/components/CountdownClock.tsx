'use client';

import React, { useState, useEffect } from 'react';
import { Shield, KeyRound, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import confetti from 'canvas-confetti';

interface CountdownClockProps {
  switchId: string;
  status: string;
  timeLeft: number;
  gracePeriod: number;
  debugOtp: string;
  isSubmitting: boolean;
  onSubmitOtp: (otp: string) => Promise<void>;
  onRefresh: () => void;
}

export default function CountdownClock({
  switchId,
  status,
  timeLeft,
  gracePeriod,
  debugOtp,
  isSubmitting,
  onSubmitOtp,
  onRefresh,
}: CountdownClockProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [scheduleDays, setScheduleDays] = useState(14);
  const [isArming, setIsArming] = useState(false);
  const [localTimeLeft, setLocalTimeLeft] = useState(timeLeft);

  useEffect(() => {
    setLocalTimeLeft(timeLeft);
  }, [timeLeft]);

  useEffect(() => {
    if (status !== 'active') return;
    const interval = setInterval(() => {
      setLocalTimeLeft((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Format time remaining
  const formatTime = (ms: number) => {
    if (ms <= 0) return '00:00:00:00';
    const totalSecs = Math.floor(ms / 1000);
    const days = Math.floor(totalSecs / (3600 * 24));
    const hours = Math.floor((totalSecs % (3600 * 24)) / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    return `${days.toString().padStart(2, '0')}:${hours.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const percentLeft = gracePeriod > 0 ? (localTimeLeft / gracePeriod) * 100 : 0;
  const strokeDashoffset = 502 - (502 * percentLeft) / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (otpCode.length !== 6 || !/^\d+$/.test(otpCode)) {
      setErrorMsg('OTP must be a 6-digit number');
      return;
    }

    try {
      await onSubmitOtp(otpCode);
      setIsModalOpen(false);
      setOtpCode('');
    } catch (e: any) {
      setErrorMsg(e.message || 'Verification failed');
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'active':
        return 'text-[#ffaa00] border-[#ffaa00]/20 bg-[#ffaa00]/5';
      case 'expired':
        return 'text-red-500 border-red-500/20 bg-red-500/5';
      case 'fired':
        return 'text-green-500 border-green-500/20 bg-green-500/5';
      case 'cancelled':
        return 'text-gray-500 border-gray-500/20 bg-gray-500/5';
      default:
        return 'text-blue-500 border-blue-500/20 bg-blue-500/5';
    }
  };

  return (
    <div className="flex flex-col items-center p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-lg relative overflow-hidden">
      {/* Glow highlight */}
      <div className="absolute -top-24 -left-24 w-48 h-48 rounded-full bg-[#ffaa00]/10 blur-3xl pointer-events-none" />

      <div className="flex justify-between items-center w-full mb-6 z-10">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#ffaa00] drop-shadow-[0_0_8px_rgba(255,170,0,0.5)]" />
          <span className="font-mono text-sm tracking-wider text-slate-300">SWITCH MONITOR</span>
        </div>
        <div className={`px-3 py-1 rounded-full border font-mono text-xs uppercase tracking-widest ${getStatusColor()}`}>
          {status === 'active' ? 'Armed' : status}
        </div>
      </div>

      {/* Circular Timer Display */}
      <div className="relative w-64 h-64 flex items-center justify-center mb-6 z-10">
        <svg className="absolute w-full h-full transform -rotate-90">
          {/* Base track */}
          <circle cx="128" cy="128" r="80" stroke="rgba(255,255,255,0.03)" strokeWidth="6" fill="transparent" />
          {/* Progress circle */}
          <circle
            cx="128"
            cy="128"
            r="80"
            stroke={status === 'expired' ? '#ef4444' : status === 'fired' ? '#22c55e' : 'url(#timerGrad)'}
            strokeWidth="8"
            fill="transparent"
            strokeDasharray="502"
            strokeDashoffset={status === 'expired' ? 502 : status === 'fired' ? 0 : strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
          <defs>
            <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffaa00" />
              <stop offset="100%" stopColor="#00f0ff" />
            </linearGradient>
          </defs>
        </svg>

        <div className="flex flex-col items-center text-center">
          <Clock className={`w-8 h-8 mb-2 ${status === 'expired' ? 'text-red-500 animate-pulse' : 'text-[#ffaa00]'}`} />
          <span className="font-mono text-2xl font-black tracking-tight text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">
            {formatTime(localTimeLeft)}
          </span>
          <span className="font-mono text-[10px] tracking-wider text-slate-500 mt-1">
            DAYS : HRS : MINS : SECS
          </span>
        </div>
      </div>

      <div className="w-full text-center z-10 mb-6">
        <span className="font-mono text-xs text-slate-400">ID: </span>
        <span className="font-mono text-xs text-slate-200 select-all">{switchId}</span>
      </div>

      {/* Configuration & Arming Panel */}
      {status === 'active' && (
        <div className="w-full p-4 mb-4 rounded-xl border border-white/5 bg-white/2 z-10">
          <div className="flex justify-between items-center mb-2">
            <span className="font-mono text-[10px] text-slate-400">LIVENESS SCHEDULE</span>
            <span className="font-mono text-xs text-[#ffaa00] font-bold">{scheduleDays} Days</span>
          </div>
          <input
            type="range"
            min="1"
            max="30"
            value={scheduleDays}
            onChange={(e) => setScheduleDays(parseInt(e.target.value))}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#ffaa00] mb-4"
          />
          <button
            onClick={async () => {
              setIsArming(true);
              try {
                const res = await fetch('/api/arm', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    switchId,
                    gracePeriod: scheduleDays * 24 * 60 * 60 * 1000,
                    beneficiaries: ['{{profile.verified_contacts.email.value}}'],
                    stashRefs: ['stash-ref-1'],
                    encryptedKeys: '0x-ephemeral-ecdh-aes-gcm-key-agreement-vector',
                    otpSecret: 'DAVID_SECRET_KEY'
                  })
                });
                const data = await res.json();
                if (data.success) {
                  onRefresh();
                  confetti({
                    particleCount: 60,
                    spread: 50,
                    origin: { y: 0.8 },
                    colors: ['#ffaa00', '#00f0ff', '#ffffff']
                  });
                }
              } catch (e) {
                console.error('Arming failed:', e);
              } finally {
                setIsArming(false);
              }
            }}
            disabled={isArming}
            className="w-full py-2.5 px-4 rounded-xl border border-[#ffaa00]/30 hover:bg-[#ffaa00] hover:text-black font-mono text-xs font-semibold text-[#ffaa00] transition-all mb-2"
          >
            {isArming ? 'ARMING...' : 'ARM SWITCH'}
          </button>
        </div>
      )}

      {/* CTA Button */}
      {status === 'active' && (
        <button
          onClick={() => {
            setIsModalOpen(true);
            setErrorMsg('');
          }}
          className="w-full py-3.5 px-6 rounded-xl font-mono text-sm tracking-wider font-semibold text-black bg-[#ffaa00] hover:bg-[#ffb732] active:scale-[0.98] transition-all shadow-[0_0_20px_rgba(255,170,0,0.3)] hover:shadow-[0_0_30px_rgba(255,170,0,0.5)] z-10"
        >
          SEND HEARTBEAT (OTP)
        </button>
      )}

      {status === 'expired' && (
        <div className="w-full p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-500 font-mono text-xs text-center z-10 flex items-center justify-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Switch expired. Execute atomic cascade.</span>
        </div>
      )}

      {status === 'fired' && (
        <div className="w-full p-4 rounded-xl border border-green-500/20 bg-green-500/5 text-green-500 font-mono text-xs text-center z-10 flex items-center justify-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Digital Legacy Dispatched. Secrets Released.</span>
        </div>
      )}

      {/* OTP verification Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-[1000] p-4 animate-fadeIn">
          <div className="w-full max-w-md p-6 rounded-2xl border border-white/10 bg-[#0d0e12] shadow-2xl relative">
            <h3 className="font-mono text-lg font-bold text-white mb-2 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-[#ffaa00]" />
              SUBMIT HEARTBEAT CODE
            </h3>
            <p className="font-sans text-sm text-slate-400 mb-6">
              Enter the 6-digit OTP code to verify your liveness and reset the countdown switch back to 14 days.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full py-4 px-4 bg-black/60 border border-white/10 rounded-xl font-mono text-2xl text-center text-white tracking-[0.5em] focus:outline-none focus:border-[#ffaa00] transition-all"
                  autoFocus
                  required
                />
              </div>

              {errorMsg && (
                <div className="text-red-500 font-mono text-xs text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20">
                  {errorMsg}
                </div>
              )}

              {/* Debug Helper inside the Modal */}
              <div className="p-4 rounded-xl border border-[#00f0ff]/20 bg-[#00f0ff]/5 flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="font-mono text-[9px] tracking-wider text-[#00f0ff]">SIMULATED SMS / TERMINAL OTP</span>
                  <span className="font-mono text-lg font-bold text-white tracking-widest">{debugOtp}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOtpCode(debugOtp)}
                  className="px-3 py-1.5 font-mono text-[10px] text-black bg-[#00f0ff] hover:bg-[#33f3ff] rounded-md transition-colors"
                >
                  AUTOFILL
                </button>
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-white/10 hover:bg-white/5 font-mono text-xs rounded-xl text-slate-400 transition-colors"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-[#ffaa00] hover:bg-[#ffb732] text-black font-mono text-xs font-bold rounded-xl transition-all shadow-[0_0_15px_rgba(255,170,0,0.2)] disabled:opacity-50"
                >
                  {isSubmitting ? 'VERIFYING...' : 'VERIFY HEARTBEAT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
