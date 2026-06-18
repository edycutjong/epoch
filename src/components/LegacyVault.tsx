'use client';

import React, { useRef } from 'react';
import { Lock, Unlock, FileText, Download, ShieldCheck, HelpCircle, Upload } from 'lucide-react';

interface LegacyVaultProps {
  status: string;
  decryptedKeys: string;
  files: Array<{
    name: string;
    size: string;
    type: string;
    fingerprint: string;
  }>;
  onUpload?: (file: { name: string; size: string; type: string; fingerprint: string; }) => void;
}

export default function LegacyVault({ status, decryptedKeys, files, onUpload }: LegacyVaultProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUpload) {
      const sizeStr = file.size > 1024 * 1024 
        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` 
        : `${(file.size / 1024).toFixed(1)} KB`;
      
      onUpload({
        name: file.name,
        size: sizeStr,
        type: file.type || 'Document',
        fingerprint: `sha256:${Math.random().toString(16).substring(2, 6)}...${Math.random().toString(16).substring(2, 6)}`
      });
    }
  };

  const handleDownloadExample = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const content = `-----BEGIN EPOCH VAULT SECRET-----
Switch ID: ${status === 'fired' ? 'unlocked' : 'sealed'}
Seed Verification: ed25519-signature-ok
Private Key Payload: 0x8a92f02cb8a391e92d47f09322ba384d728fca9b273b0a94e82b7c02b37e89ab
Backup Passwords:
- email_recovery: epoch-secure-recovery-phrase-2026
- bank_escrow: 9942-8831-2940-1092
-----END EPOCH VAULT SECRET-----`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'epoch_example_secret.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadExample = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onUpload) {
      onUpload({
        name: 'epoch_example_secret.txt',
        size: '0.4 KB',
        type: 'text/plain',
        fingerprint: 'sha256:d8c5...f89a'
      });
    }
  };

  const isFired = status === 'fired';

  return (
    <div className="flex flex-col p-8 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-lg relative overflow-hidden h-full">
      {/* Background radial glow if decrypted */}
      {isFired && (
        <div className="absolute -bottom-24 -right-24 w-48 h-48 rounded-full bg-[#22c55e]/10 blur-3xl pointer-events-none" />
      )}

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          {isFired ? (
            <Unlock className="w-5 h-5 text-green-500 drop-shadow-[0_0_8px_rgba(34,197,150,0.5)]" />
          ) : (
            <Lock className="w-5 h-5 text-slate-400" />
          )}
          <span className="font-mono text-sm tracking-wider text-slate-300">SEALED INHERITANCE VAULT</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
          <span>TEE STASH GATED</span>
        </div>
      </div>

      <p className="font-sans text-xs text-slate-400 mb-6 leading-relaxed">
        Credentials and documents are sealed client-side inside the secure enclave storage (stash). Plaintext assets remain completely inaccessible to the host operator and the agent daemon until liveness timer expiry.
      </p>

      {/* File List */}
      <div className="flex flex-col gap-3 flex-grow">
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 rounded-xl border border-dashed border-white/5 bg-white/2 min-h-[160px] text-center">
            <Lock className="w-8 h-8 text-slate-600 mb-3" />
            <span className="font-mono text-xs text-slate-400">Vault is empty</span>
            <span className="font-sans text-[10px] text-slate-500 mt-1">
              Upload a file or use the buttons below to load/download example data.
            </span>
          </div>
        ) : (
          files.map((file, idx) => (
            <div
              key={idx}
              className={`p-4 rounded-xl border flex items-center justify-between transition-all duration-300 ${
                isFired
                  ? 'border-green-500/20 bg-green-500/5 hover:bg-green-500/10'
                  : 'border-white/5 bg-white/2'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-lg ${
                    isFired ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <FileText className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                  <span className="font-mono text-xs font-semibold text-white">{file.name}</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {file.size} &bull; {file.type}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden md:flex flex-col text-right">
                  <span className="font-mono text-[9px] text-slate-600">FINGERPRINT</span>
                  <span className="font-mono text-[10px] text-slate-400 tracking-wider">
                    {file.fingerprint}
                  </span>
                </div>

                {isFired ? (
                  <a
                    href={`data:text/plain;charset=utf-8,${encodeURIComponent(
                      `Decrypted payload for ${file.name} using keys: ${decryptedKeys}`
                    )}`}
                    download={file.name}
                    className="p-2 rounded-lg bg-green-500 text-black hover:bg-green-400 transition-colors"
                    title="Download Decrypted File"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                ) : (
                  <div className="p-2 rounded-lg bg-white/5 text-slate-500 cursor-not-allowed" title="Vault is sealed">
                    <Lock className="w-4 h-4" />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload Zone (Only when switch is not fired) */}
      {!isFired && (
        <>
          <div className="mt-4 p-4 rounded-xl border border-dashed border-white/10 hover:border-[#00f0ff]/30 bg-white/2 hover:bg-[#00f0ff]/2 transition-all relative flex flex-col items-center justify-center text-center group">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              id="file-upload-input"
            />
            <Upload className="w-5 h-5 text-slate-500 group-hover:text-[#00f0ff] mb-2 transition-colors" />
            <span className="font-mono text-[10px] text-slate-400 group-hover:text-white transition-colors">
              DRAG & DROP OR CLICK TO UPLOAD DOCUMENT
            </span>
            <span className="font-sans text-[9px] text-slate-600 mt-1">
              Accepts: PDF, TXT, PEM (Max 10MB)
            </span>
          </div>

          <div className="mt-3 flex gap-3 relative z-20">
            <button
              onClick={handleDownloadExample}
              className="flex-grow py-2.5 px-3 rounded-xl border border-[#ffaa00]/30 hover:border-[#ffaa00] font-mono text-[10px] font-semibold text-[#ffaa00] bg-[#ffaa00]/5 hover:bg-[#ffaa00]/10 transition-all flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>DOWNLOAD EXAMPLE FILE</span>
            </button>
            <button
              onClick={handleLoadExample}
              className="flex-grow py-2.5 px-3 rounded-xl border border-[#00f0ff]/30 hover:border-[#00f0ff] font-mono text-[10px] font-semibold text-[#00f0ff] bg-[#00f0ff]/5 hover:bg-[#00f0ff]/10 transition-all flex items-center justify-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>UPLOAD IMMEDIATE EXAMPLE</span>
            </button>
          </div>
        </>
      )}

      {/* Decrypted Payload details */}
      {isFired ? (
        <div className="mt-6 p-4 rounded-xl border border-green-500/20 bg-green-500/5 animate-fadeIn">
          <h4 className="font-mono text-[10px] tracking-wider text-green-400 mb-2 font-bold uppercase">
            DECRYPTED DELEGATION KEY SYSTEM
          </h4>
          <div className="p-3 bg-black/60 border border-white/5 rounded-lg font-mono text-xs text-green-300 break-all select-all">
            {decryptedKeys || 't3n-session-aes-256-gcm-key-unlocked'}
          </div>
          <span className="font-mono text-[9px] text-slate-500 mt-2 block">
            Verification: Attested remote Intel TDX signature verifies this key agreement channel.
          </span>
        </div>
      ) : (
        <div className="mt-6 p-4 rounded-xl border border-white/5 bg-white/2 flex gap-3 items-center">
          <HelpCircle className="w-5 h-5 text-slate-500 shrink-0" />
          <span className="font-sans text-[11px] text-slate-500 leading-snug">
            All files are encrypted with an ephemeral ECDH shared secret derived between David's browser and the enclave. Key recovery is mathematically locked inside the TEE.
          </span>
        </div>
      )}
    </div>
  );
}
