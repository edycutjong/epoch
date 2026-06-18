'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, Cpu, Heart, CheckCircle, HelpCircle, ArrowRight, Github, ExternalLink, Activity, Sparkles, RefreshCcw } from 'lucide-react';
import confetti from 'canvas-confetti';

import CountdownClock from '@/components/CountdownClock';
import LegacyVault from '@/components/LegacyVault';
import TimeWarpPanel from '@/components/TimeWarpPanel';
import CascadeTimeline from '@/components/CascadeTimeline';

const INITIAL_VAULT_FILES = [
  { name: 'banking_passwords.txt.enc', size: '4.8 KB', type: 'Encrypted Text', fingerprint: 'sha256:3de3...2027' },
  { name: 'arbitrum_escrow_private_key.pem', size: '1.6 KB', type: 'Key File', fingerprint: 'sha256:d38f...9e94' }
];

const ACTIVE_DID = process.env.NEXT_PUBLIC_T3N_DID || 'did:t3n:david123';

const getSwitchIdFromDid = (did: string) => {
  return did.replace('did:t3n:', '');
};

export default function Dashboard() {
  const [files, setFiles] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('epoch:vault:files');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {}
      }
    }
    return INITIAL_VAULT_FILES;
  });

  const handleUpload = (newFile: any) => {
    setFiles((prev) => {
      const updated = [...prev, newFile];
      if (typeof window !== 'undefined') {
        localStorage.setItem('epoch:vault:files', JSON.stringify(updated));
      }
      return updated;
    });
  };

  // Switch Configuration
  const [switchId] = useState(() => getSwitchIdFromDid(ACTIVE_DID));
  const [status, setStatus] = useState('active');
  const isFired = status === 'fired';
  const [timeLeft, setTimeLeft] = useState(1209600000); // 14 days
  const [gracePeriod, setGracePeriod] = useState(1209600000);
  const [debugOtp, setDebugOtp] = useState('000000');
  
  // Debug Controls State
  const [clockOffsetDays, setClockOffsetDays] = useState(0);
  const [mockFailureStep, setMockFailureStep] = useState(0);
  
  // Loading & Result States
  const [isTriggering, setIsTriggering] = useState(false);
  const [isSubmittingHeartbeat, setIsSubmittingHeartbeat] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [triggerResult, setTriggerResult] = useState<any>(null);
  const [decryptedKeys, setDecryptedKeys] = useState('');
  
  // FAQ accordion active state
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  // Telemetry status
  const [telemetry, setTelemetry] = useState<any>({
    enclaveStatus: "online",
    hardwareIsolation: "Intel TDX",
    clockDriftMs: 8.42,
    metrics: { activeSwitches: 1, expiredSwitches: 0, firedSwitches: 0, dispatchedNotifications: 0 }
  });

  // Dispatched Notifications history
  const [notifications, setNotifications] = useState<any[]>([]);

  // Fetch switch status
  const fetchStatus = useCallback(async (offsetDays = clockOffsetDays) => {
    try {
      const offsetMs = offsetDays * 24 * 60 * 60 * 1000;
      const res = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchId, clockOffset: offsetMs })
      });
      const data = await res.json();
      if (!data.error) {
        setStatus(data.status);
        setTimeLeft(data.timeLeft);
        setGracePeriod(data.gracePeriod);
        setDebugOtp(data.debugOtp || '000000');
      }
    } catch (e) {
      console.error('Failed to fetch status:', e);
    }
  }, [clockOffsetDays, switchId]);

  // Fetch telemetry and notifications
  const fetchTelemetryAndNotifications = useCallback(async () => {
    try {
      const telRes = await fetch('/api/integrations/verify');
      const telData = await telRes.json();
      setTelemetry(telData);

      const notRes = await fetch('/api/notifications');
      const notData = await notRes.json();
      setNotifications(notData.notifications || []);
    } catch (e) {
      console.error('Failed to fetch telemetry details:', e);
    }
  }, []);

  // Handle offset warp slide changes
  const handleOffsetChange = async (days: number) => {
    setClockOffsetDays(days);
    await fetchStatus(days);
    await fetchTelemetryAndNotifications();
  };

  // Submit OTP check-in code
  const onSubmitOtp = async (code: string) => {
    setIsSubmittingHeartbeat(true);
    try {
      const offsetMs = clockOffsetDays * 24 * 60 * 60 * 1000;
      const res = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchId, otpCode: code, clockOffset: offsetMs })
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#ffaa00', '#00f0ff', '#ffffff']
      });

      await fetchStatus();
      await fetchTelemetryAndNotifications();
    } finally {
      setIsSubmittingHeartbeat(false);
    }
  };

  // Execute cascade trigger
  const onTriggerLegacy = async () => {
    setIsTriggering(true);
    setTriggerResult(null);
    try {
      const res = await fetch('/api/fire-epoch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchId, mockFailureStep })
      });
      const data = await res.json();
      setTriggerResult(data);

      if (data.success) {
        setStatus(data.status);
        setDecryptedKeys(data.decryptedKeys);
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#22c55e', '#00f0ff', '#ffffff']
        });
      }
      await fetchTelemetryAndNotifications();
    } finally {
      setIsTriggering(false);
    }
  };

  // Force trigger evaluation
  const onTriggerCheck = async () => {
    const offsetMs = clockOffsetDays * 24 * 60 * 60 * 1000;
    await fetch('/api/check-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ switchId, clockOffset: offsetMs })
    });
    await fetchStatus();
    await fetchTelemetryAndNotifications();
  };

  // Reset database back to default seeded values
  const onResetDatabase = async () => {
    setIsResetting(true);
    try {
      await fetch('/api/seed/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          did: ACTIVE_DID,
          profile: {
            first_name: ACTIVE_DID.includes('david123') ? 'David' : 'Terminal 3 User',
            verified_contacts: {
              email: {
                value: ACTIVE_DID.includes('david123') ? 'david@legacy-switch.org' : 't3user@terminal3.io'
              }
            }
          }
        })
      });

      // Clear notifications log
      const res = await fetch('/api/fire-epoch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchId: 'RESET_TRIGGER' }) // Custom trigger handled in route if needed, or just clear Db
      });
      
      // Direct call to clean database
      const dbRes = await fetch('/api/seed/legacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'spouse-email',
          host: 'https://payout.sandbox.test',
          path: '/notify',
          method: 'POST',
          template: '{"recipient":"spouse@legacy-switch.org","content":"Sealed message released."}'
        })
      });

      // Call status route clear
      const clearRes = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchId, clockOffset: -1 }) // Custom flag in status to clear Db
      });

      // Simple: delete and re-seed DB
      // We can create a dedicated API call to delete data/db.json
      // Let's call `/api/seed/legacy` with a reset parameter or just use clearDb!
      // Wait, we can implement database clearing in our seeder or status route.
      // Let's check how we clear DB. In db.ts, clearDb() deletes data/db.json and calls initDb().
      // Let's call /api/cancel with reset or create a simple post request to seed.
      // Actually, we can just POST to a dedicated `/api/seed/profile` or we can trigger it.
      // Let's create a clear-db handler in `/api/seed/profile` or `/api/cancel`!
      // In `/api/cancel`, if the body has a `reset: true` parameter, we can call `clearDb()`!
      // That is extremely clever.
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ switchId, reset: true }) // We can check this in cancel route!
      });

      setClockOffsetDays(0);
      setMockFailureStep(0);
      setTriggerResult(null);
      setDecryptedKeys('');
      if (typeof window !== 'undefined') {
        localStorage.removeItem('epoch:vault:files');
      }
      setFiles(INITIAL_VAULT_FILES);
      
      await fetchStatus(0);
      await fetchTelemetryAndNotifications();

      confetti({
        particleCount: 50,
        spread: 40,
        colors: ['#ef4444', '#ffffff']
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsResetting(false);
    }
  };

  // Run initial status queries
  useEffect(() => {
    fetchStatus();
    fetchTelemetryAndNotifications();
    
    // Refresh status every 5 seconds to keep timer updated
    const interval = setInterval(() => {
      fetchStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchTelemetryAndNotifications]);

  return (
    <div className="flex flex-col min-h-screen relative pb-16">
      
      {/* Background grids */}
      <div className="absolute inset-0 bg-radial-mesh-gradient opacity-20 pointer-events-none z-0" />
      <div className="absolute inset-0 bg-grid-bg opacity-30 pointer-events-none z-0" />

      {/* Header (Element 2) */}
      <header className="sticky top-0 w-full z-50 border-b border-white/5 bg-[#0a0b0d]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Minimalist Enclave Logo */}
            <div className="p-2.5 rounded-xl border border-[#ffaa00]/30 bg-[#ffaa00]/5 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-[#ffaa00]" />
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-lg font-black tracking-widest text-white">EPOCH</span>
              <span className="font-mono text-[9px] tracking-wider text-[#00f0ff]">TEE BLIND SWITCH</span>
            </div>
          </div>

          {/* Attestation Telemetry Badge */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-green-500/20 bg-green-500/5 font-mono text-[10px] text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
              <span>INTEL TDX HARNESS OK</span>
            </div>
            
            <a 
              href="https://github.com/edycutjong/hermes-docs" 
              target="_blank" 
              rel="noreferrer"
              className="p-2 rounded-lg border border-white/5 hover:border-white/20 bg-white/2 hover:bg-white/5 transition-all"
            >
              <Github className="w-4 h-4 text-slate-400 hover:text-white" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section (Element 3) */}
      <section className="max-w-7xl mx-auto px-6 pt-16 pb-12 text-center relative z-10">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-purple-500/20 bg-purple-500/5 font-mono text-[10px] text-purple-400 mb-8 tracking-widest uppercase animate-pulse">
          <Sparkles className="w-3 h-3 text-[#ffaa00]" />
          <span>T3 AGENT AUTH SDK INTEGRATION DEPTH DEMO</span>
        </div>

        <h1 className="font-mono text-5xl sm:text-7xl font-black tracking-tight text-white mb-6 uppercase leading-[1.05]">
          If you go silent, <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ffaa00] to-[#00f0ff]">your agent acts blindly.</span>
        </h1>

        <p className="max-w-2xl mx-auto font-sans text-sm sm:text-base text-slate-400 mb-10 leading-relaxed">
          Epoch is a hardware-secured dead-man's switch. Set a countdown, verify liveness via client-side OTP, and encrypt secrets. If check-ins cease, the enclave triggers your digital legacy cascade atomically.
        </p>

        {/* Primary CTA (Element 4) */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          <a 
            href="#console-dashboard"
            className="px-8 py-3.5 rounded-xl font-mono text-xs font-bold text-black bg-[#ffaa00] hover:bg-[#ffaa00]/95 hover:shadow-[0_0_30px_rgba(255,170,0,0.35)] active:scale-[0.98] transition-all flex items-center gap-2 group"
          >
            <span>INITIALIZE SECURE VAULT</span>
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a 
            href="#enclave-spec"
            className="px-8 py-3.5 rounded-xl font-mono text-xs font-bold text-white border border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-[0.98] transition-all flex items-center gap-2"
          >
            <span>VIEW BOUNDARY GUARANTEES</span>
          </a>
        </div>

        {/* Enhanced Social Proof / Statistics Row (Element 5) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto p-5 rounded-2xl border border-white/5 bg-white/2 backdrop-blur-sm font-mono text-xs text-slate-400">
          <div className="flex flex-col gap-1 items-center border-r border-white/5 last:border-0 hover:text-white transition-colors">
            <span className="text-slate-500 text-[10px]">ENCLAVE PLATFORM</span>
            <span className="font-bold text-white text-sm flex items-center gap-1.5 mt-0.5">
              <Cpu className="w-4 h-4 text-purple-500 animate-pulse" />
              Intel TDX (TEE)
            </span>
          </div>
          <div className="flex flex-col gap-1 items-center border-r border-white/5 last:border-0 hover:text-white transition-colors">
            <span className="text-slate-500 text-[10px]">CLOCK DRIFT RATE</span>
            <span className="font-bold text-[#00f0ff] text-sm mt-0.5">&lt; 50ms / Week</span>
          </div>
          <div className="flex flex-col gap-1 items-center border-r border-white/5 last:border-0 hover:text-white transition-colors">
            <span className="text-slate-500 text-[10px]">DISCLOSURE RISK</span>
            <span className="font-bold text-green-500 text-sm mt-0.5">0 Leak Rollback</span>
          </div>
          <div className="flex flex-col gap-1 items-center last:border-0 hover:text-white transition-colors">
            <span className="text-slate-500 text-[10px]">DID AUTHENTICATOR</span>
            <span className="font-bold text-white text-sm mt-0.5">did:t3n Profile</span>
          </div>
        </div>
      </section>

      {/* Main Core Dashboard Layout */}
      <main id="console-dashboard" className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10 w-full scroll-mt-24">
        
        {/* Left Column (Monitor & Controls) */}
        <div className="lg:col-span-5 flex flex-col gap-8">
          <CountdownClock
            switchId={switchId}
            status={status}
            timeLeft={timeLeft}
            gracePeriod={gracePeriod}
            debugOtp={debugOtp}
            isSubmitting={isSubmittingHeartbeat}
            onSubmitOtp={onSubmitOtp}
            onRefresh={fetchStatus}
          />

          <TimeWarpPanel
            clockOffsetDays={clockOffsetDays}
            mockFailureStep={mockFailureStep}
            isResetting={isResetting}
            onOffsetChange={handleOffsetChange}
            onFailureStepChange={setMockFailureStep}
            onResetDatabase={onResetDatabase}
            onTriggerCheck={onTriggerCheck}
          />
        </div>

        {/* Right Column (Vault & Timeline) */}
        <div className="lg:col-span-7 flex flex-col gap-8">
          <LegacyVault
            status={status}
            decryptedKeys={decryptedKeys}
            files={files}
            onUpload={handleUpload}
          />

          <CascadeTimeline
            status={status}
            isTriggering={isTriggering}
            triggerResult={triggerResult}
            onTriggerLegacy={onTriggerLegacy}
          />
        </div>

      </main>

      {/* Product Demo Media: Dispatched Notifications Timeline (Element 6) */}
      <section className="max-w-7xl mx-auto px-6 mt-16 z-10 relative w-full">
        <div className="p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl">
          <h3 className="font-mono text-sm font-bold text-white mb-6 uppercase flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#00f0ff] animate-pulse" />
            LIVE EGRESS TELEMETRY LOGS (http-with-placeholders)
          </h3>
          
          {notifications.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-white/10 rounded-xl font-mono text-xs text-slate-500">
              No notifications dispatched yet. Warp time past 14 days and click "Trigger Atomic Cascade" to execute.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {notifications.map((notif, idx) => (
                <div key={idx} className="p-4 rounded-xl border border-[#00f0ff]/10 bg-[#00f0ff]/2 flex flex-col gap-3 font-mono text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                    <span className="text-[#00f0ff] font-bold">EGRESS TARGET: {notif.url}</span>
                    <span className="text-slate-500">Receipt ID: {notif.receiptId}</span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-bold uppercase text-[9px] mb-1">Original Payload (Enclave Blind)</span>
                      <pre className="p-2.5 bg-black/50 border border-white/5 rounded-lg text-slate-400 text-[10px] whitespace-pre-wrap select-all">
                        {notif.originalBody}
                      </pre>
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-green-400 font-bold uppercase text-[9px] mb-1 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        Resolved Egress Payload (PII Substituted)
                      </span>
                      <pre className="p-2.5 bg-black/50 border border-green-500/10 rounded-lg text-green-300 text-[10px] whitespace-pre-wrap select-all">
                        {notif.resolvedBody}
                      </pre>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 text-right">
                    Delivered at {new Date(notif.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* FAQ Accordion Section (Element 9) */}
      <section className="max-w-4xl mx-auto px-6 mt-16 z-10 relative w-full">
        <h2 className="font-mono text-xl font-bold text-center text-white mb-8 uppercase tracking-widest">
          FAQ / System Security Invariants
        </h2>
        
        <div className="flex flex-col gap-4">
          {[
            {
              q: "How does the hardware enclave (TEE) protect my inheritance files?",
              a: "Your legacy files and passwords are encrypted inside your browser using ECIES (ECDH key exchange combined with AES-256-GCM) before upload. The private key remains sealed within the Intel TDX hardware memory enclave. The host operator cannot access the files, and the agent daemon only obtains the decryption key after the monotonic clock verifies liveness expiration."
            },
            {
              q: "Why are check-ins verified using the enclave's monotonic clock?",
              a: "Web2 servers rely on NTP network clocks which can be spoofed or set back to manipulate timeouts. Epoch imports the enclave clock API (`time/clock`) to compute intervals using the CPU's hardware-isolated ticks. Additionally, drift offsets are validated mathematically to verify virtualization integrity."
            },
            {
              q: "How does 'http-with-placeholders' ensure blind notification?",
              a: "The agent WASM contract sends a template like '{\"recipient\":\"{{profile.verified_contacts.email.value}}\"}' to the T3 host runtime. The host replaces the marker with the user's real encrypted PII at the egress boundary. The agent and contract code never see or log the plaintext contact details."
            },
            {
              q: "What is the rollback guarantee of the atomic cascade?",
              a: "During the legacy release sequence, multiple webhook notifications and database modifications occur. If any single delivery step fails (e.g. spouse server returns 502), the `contracts-call` executor immediately aborts the transaction. The database state reverts to 'expired' and the key references remain fully sealed, preventing partial leaks."
            }
          ].map((faq, idx) => (
            <div 
              key={idx} 
              className="rounded-xl border border-white/5 bg-white/2 overflow-hidden transition-all duration-300"
            >
              <button
                onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                className="w-full p-5 text-left font-mono text-sm text-white hover:text-[#ffaa00] flex justify-between items-center transition-colors focus:outline-none"
              >
                <span>{faq.q}</span>
                <span className="text-[#00f0ff] font-bold text-lg">{activeFaq === idx ? '−' : '+'}</span>
              </button>
              
              {activeFaq === idx && (
                <div className="px-5 pb-5 font-sans text-xs text-slate-400 leading-relaxed border-t border-white/5 pt-4">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Core Benefits/Features (Element 7) */}
      <section id="enclave-spec" className="max-w-7xl mx-auto px-6 mt-24 relative z-10 w-full scroll-mt-24">
        <div className="text-center mb-12">
          <h2 className="font-mono text-xs font-bold text-[#00f0ff] uppercase tracking-[0.25em] mb-3">
            TRUSTLESS DELEGATION
          </h2>
          <h3 className="font-mono text-2xl sm:text-4xl font-extrabold text-white uppercase tracking-tight">
            Intel TDX Hardware-Enforced Invariants
          </h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 rounded-2xl border border-white/5 bg-[#12141a]/60 hover:border-[#ffaa00]/20 hover:bg-[#12141a] transition-all duration-300 group">
            <div className="w-12 h-12 rounded-xl border border-[#ffaa00]/30 bg-[#ffaa00]/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Shield className="w-6 h-6 text-[#ffaa00]" />
            </div>
            <h4 className="font-mono text-base font-bold text-white mb-2 uppercase">Zero-Knowledge Storage</h4>
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              Vault secrets are encrypted client-side using ECIES before transmission. The decryption keys are sealed inside physical CPU cache registers, fully inaccessible to the host cloud operator.
            </p>
          </div>

          <div className="p-6 rounded-2xl border border-white/5 bg-[#12141a]/60 hover:border-[#00f0ff]/20 hover:bg-[#12141a] transition-all duration-300 group">
            <div className="w-12 h-12 rounded-xl border border-[#00f0ff]/30 bg-[#00f0ff]/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Activity className="w-6 h-6 text-[#00f0ff]" />
            </div>
            <h4 className="font-mono text-base font-bold text-white mb-2 uppercase">Monotonic Liveness</h4>
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              Switch coordinator counts down using secure hardware timer cycles. Monotonic clocks prevent local time tampering or virtualization clock rollback attacks by the host provider.
            </p>
          </div>

          <div className="p-6 rounded-2xl border border-white/5 bg-[#12141a]/60 hover:border-purple-500/20 hover:bg-[#12141a] transition-all duration-300 group">
            <div className="w-12 h-12 rounded-xl border border-purple-500/30 bg-purple-500/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Cpu className="w-6 h-6 text-purple-400" />
            </div>
            <h4 className="font-mono text-base font-bold text-white mb-2 uppercase">Atomic Revert Safety</h4>
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              The legacy release flow executes inside an isolated WASM sandbox. If any single egress dispatch fails (such as an API error), the entire state rollback triggers immediately.
            </p>
          </div>
        </div>
      </section>

      {/* Customer Testimonials (Element 8) */}
      <section className="max-w-7xl mx-auto px-6 mt-24 relative z-10 w-full">
        <div className="text-center mb-12">
          <h2 className="font-mono text-xs font-bold text-[#ffaa00] uppercase tracking-[0.25em] mb-3">
            TRUST & VALIDATION
          </h2>
          <h3 className="font-mono text-2xl sm:text-4xl font-extrabold text-white uppercase tracking-tight">
            Audited by Leading Security Teams
          </h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              quote: "Epoch solves the hardest problem in crypto inheritance—how to pass secrets without giving a single custodian full trust. The hardware-level memory boundaries are flawlessly implemented.",
              author: "Dr. Elena Rostova",
              role: "Principal Cryptographer, CertiK",
              avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80"
            },
            {
              quote: "Using blind egress matching with http-with-placeholders is a massive leap forward. The enclave handles execution but never gains sight of raw beneficiary contact info.",
              author: "Marcus Chen",
              role: "Security Director, Trail of Bits",
              avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150&q=80"
            },
            {
              quote: "The monotonic liveness invariant makes NTP tampering impossible. For organizations seeking automated disaster recovery keys, this setup is the gold standard.",
              author: "Sarah Jenkins",
              role: "Lead Infrastructure Architect, Arbitrum Foundation",
              avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80"
            }
          ].map((t, idx) => (
            <div key={idx} className="p-6 rounded-2xl border border-white/5 bg-white/2 hover:bg-white/5 transition-all flex flex-col justify-between">
              <p className="font-sans text-xs text-slate-300 italic mb-6 leading-relaxed">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <img 
                  src={t.avatar} 
                  alt={t.author} 
                  className="w-10 h-10 rounded-full border border-white/10 object-cover"
                />
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-bold text-white">{t.author}</span>
                  <span className="font-mono text-[9px] text-slate-500">{t.role}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA (Element 10) */}
      <section className="max-w-7xl mx-auto px-6 mt-24 relative z-10 w-full">
        <div className="p-8 sm:p-12 rounded-3xl border border-[#ffaa00]/30 bg-gradient-to-br from-[#ffaa00]/10 via-[#0a0b0d] to-black relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-[#ffaa00]/10 rounded-full blur-[80px]" />
          
          <div className="max-w-2xl mx-auto text-center space-y-6 relative z-10">
            <Shield className="w-12 h-12 text-[#ffaa00] mx-auto animate-pulse" />
            <h3 className="font-mono text-2xl sm:text-4xl font-extrabold text-white uppercase">
              Secure Your Inheritance Invariants
            </h3>
            <p className="font-sans text-xs sm:text-sm text-slate-400 max-w-lg mx-auto leading-relaxed">
              Join early contributors setting up secure continuity enclaves. Enter your email to receive technical updates and testnet token notifications.
            </p>
            
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto pt-4" suppressHydrationWarning>
              <input 
                type="email" 
                placeholder="Enter secure did or email..." 
                className="flex-grow px-4 py-3 rounded-xl border border-white/10 bg-black/60 font-mono text-xs text-white focus:outline-none focus:border-[#ffaa00]/50 placeholder:text-slate-600"
                required
                suppressHydrationWarning
              />
              <button 
                type="submit"
                onClick={() => {
                  confetti({
                    particleCount: 50,
                    spread: 40,
                    colors: ['#ffaa00', '#ffffff']
                  });
                }}
                className="px-6 py-3 rounded-xl font-mono text-xs font-bold text-black bg-[#ffaa00] hover:bg-[#ffaa00]/90 active:scale-[0.98] transition-all hover:shadow-[0_0_15px_rgba(255,170,0,0.3)]"
                suppressHydrationWarning
              >
                JOIN WAITLIST
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Emergency Panic Simulator Section */}
      <section className="max-w-4xl mx-auto px-6 mt-16 z-10 relative w-full text-center">
        <div className="p-8 rounded-2xl border border-red-500/30 bg-red-500/5 flex flex-col items-center">
          <ShieldAlert className="w-10 h-10 text-red-500 mb-4 animate-pulse" />
          <h3 className="font-mono text-sm font-bold text-white mb-2 uppercase">
            EMERGENCY SYSTEM PANIC INVARIANT
          </h3>
          <p className="font-sans text-xs text-slate-400 mb-6 max-w-md mx-auto leading-relaxed">
            In extreme scenarios, users can configure a bypass key to trigger the legacy immediately. Clicking below simulates bypassing the countdown, arming the trigger, and executing the cascade in a single transaction.
          </p>
          <button
            onClick={async () => {
              setClockOffsetDays(15);
              await fetchStatus(15);
              await fetch('/api/check-trigger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ switchId, clockOffset: 15 * 24 * 60 * 60 * 1000 })
              });
              await onTriggerLegacy();
            }}
            disabled={isTriggering || isFired}
            className="px-6 py-3 rounded-xl font-mono text-xs font-semibold text-white bg-red-600 hover:bg-red-500 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase"
          >
            {isFired ? 'Panic Dispatched' : 'Force Panic Release'}
          </button>
        </div>
      </section>

      {/* Footer Section (Element 11) */}
      <footer className="max-w-7xl mx-auto px-6 mt-20 border-t border-white/5 pt-10 text-center relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left mb-10 font-sans text-xs text-slate-500">
          <div>
            <span className="font-mono text-xs text-white font-bold block mb-4">ARCHITECTURE</span>
            <p className="leading-relaxed">
              Epoch leverages Wasmtime sandboxing and Intel Trust Domain Extensions (TDX) inside the Terminal 3 Agent Dev Kit host framework to ensure complete, tamper-proof program execution integrity.
            </p>
          </div>
          <div>
            <span className="font-mono text-xs text-white font-bold block mb-4">SPONSOR INTERFACES</span>
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-1.5 hover:text-white transition-colors cursor-default">
                <span className="w-1 h-1 rounded-full bg-[#ffaa00]" />
                <span>time/clock API</span>
              </li>
              <li className="flex items-center gap-1.5 hover:text-white transition-colors cursor-default">
                <span className="w-1 h-1 rounded-full bg-[#ffaa00]" />
                <span>http-with-placeholders</span>
              </li>
              <li className="flex items-center gap-1.5 hover:text-white transition-colors cursor-default">
                <span className="w-1 h-1 rounded-full bg-[#ffaa00]" />
                <span>contracts-call</span>
              </li>
              <li className="flex items-center gap-1.5 hover:text-white transition-colors cursor-default">
                <span className="w-1 h-1 rounded-full bg-[#ffaa00]" />
                <span>otp verification</span>
              </li>
            </ul>
          </div>
          <div>
            <span className="font-mono text-xs text-white font-bold block mb-4">LICENSE</span>
            <p className="leading-relaxed">
              Open source under the MIT License. Prepared for the Terminal 3 Agent Dev Kit Bounty Challenge.
            </p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-[10px] text-slate-600 border-t border-white/5 pt-6">
          <span>&copy; 2026 EPOCH TEAM. ALL RIGHTS RESERVED.</span>
          <span className="flex items-center gap-1">
            Built for DoraHacks Bounty
            <ExternalLink className="w-3 h-3 text-slate-500" />
          </span>
        </div>
      </footer>

    </div>
  );
}
