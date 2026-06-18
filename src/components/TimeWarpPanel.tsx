'use client';

import React from 'react';
import { Sliders, RefreshCw, AlertCircle, HelpCircle } from 'lucide-react';

interface TimeWarpPanelProps {
  status: string;
  clockOffsetDays: number;
  mockFailureStep: number;
  isResetting: boolean;
  onOffsetChange: (days: number) => void;
  onFailureStepChange: (step: number) => void;
  onResetDatabase: () => Promise<void>;
  onTriggerCheck: () => void;
}

export default function TimeWarpPanel({
  status,
  clockOffsetDays,
  mockFailureStep,
  isResetting,
  onOffsetChange,
  onFailureStepChange,
  onResetDatabase,
  onTriggerCheck,
}: TimeWarpPanelProps) {
  const isFired = status === 'fired';
  return (
    <div className="flex flex-col p-8 rounded-2xl border border-[#ffaa00]/20 bg-black/40 backdrop-blur-xl shadow-lg relative overflow-hidden h-full">
      {/* Background highlight */}
      <div className="absolute -top-24 -right-24 w-48 h-48 rounded-full bg-[#00f0ff]/5 blur-3xl pointer-events-none" />

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-[#00f0ff] drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]" />
          <span className="font-mono text-sm tracking-wider text-slate-300">JUDGE DEBUG CONSOLE</span>
        </div>
        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[9px] text-slate-400">
          DEVELOPMENT ONLY
        </span>
      </div>

      {/* Step 3: Time-Warp Slider */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <label className="font-mono text-xs text-slate-300 flex items-center gap-1.5">
            <span>Simulate Time Warp (Clock Offset)</span>
          </label>
          <span className="font-mono text-xs font-bold text-[#ffaa00] bg-[#ffaa00]/10 px-2 py-0.5 rounded border border-[#ffaa00]/20">
            +{clockOffsetDays} Days
          </span>
        </div>
        <input
          type="range"
          id="time-warp-slider"
          min="0"
          max="15"
          step="1"
          value={clockOffsetDays}
          onChange={(e) => onOffsetChange(parseInt(e.target.value))}
          disabled={isFired}
          className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#ffaa00] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="flex justify-between font-mono text-[9px] text-slate-500 mt-2 px-1">
          <span>Realtime (0d)</span>
          <span>5d</span>
          <span>10d</span>
          <span className="text-red-500 font-bold">Expired (15d)</span>
        </div>
      </div>

      {/* Mock Cascade Failure Step Selector */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <label className="font-mono text-xs text-slate-300">
            Toggle Mock Cascade Failure
          </label>
          <span className="font-mono text-[10px] text-slate-500">Demo Rollback Safety</span>
        </div>
        <select
          value={mockFailureStep}
          onChange={(e) => onFailureStepChange(parseInt(e.target.value))}
          className="w-full py-2.5 px-3 bg-black/60 border border-white/10 rounded-xl font-mono text-xs text-slate-300 focus:outline-none focus:border-[#00f0ff] transition-all"
        >
          <option value={0}>None (Full Cascade Success)</option>
          <option value={1}>Step 1: Egress Notification Fail</option>
        </select>
        <div className="mt-2 text-slate-500 font-sans text-[10px] leading-relaxed flex gap-1.5 items-start">
          <AlertCircle className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
          <span>
            Selecting Step 1 simulates an HTTP 502 error during notification. The atomic execution contract will trigger a rollback: database states revert and the vault remains locked.
          </span>
        </div>
      </div>

      {/* Database Reset Action */}
      <div className="mt-auto flex flex-col gap-3">
        <button
          onClick={onTriggerCheck}
          disabled={isFired}
          className="w-full py-2.5 px-4 rounded-xl border border-[#00f0ff]/30 hover:border-[#00f0ff] font-mono text-xs font-semibold text-[#00f0ff] bg-[#00f0ff]/5 hover:bg-[#00f0ff]/10 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          FORCE TRIGGER EVALUATION
        </button>

        <button
          onClick={onResetDatabase}
          disabled={isResetting}
          className="w-full py-2.5 px-4 rounded-xl border border-red-500/30 hover:border-red-500 font-mono text-xs font-semibold text-red-500 bg-red-500/5 hover:bg-red-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
          <span>RESET SWITCH & SEED DATA</span>
        </button>
      </div>
    </div>
  );
}
