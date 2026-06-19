import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: __dirname,
  },
  // Real Terminal 3 VC SDK packages run server-side only (ethers/jsonld); keep
  // them external so they aren't bundled into client/edge output.
  serverExternalPackages: [
    '@terminal3/ecdsa_vc',
    '@terminal3/verify_vc',
    '@terminal3/verify_vc_core',
    '@terminal3/vc_core',
    '@terminal3/revoke_vc',
    '@terminal3/bbs_vc',
    'ethers',
  ],
  allowedDevOrigins: ['127.0.2.2'],
};

export default nextConfig;
