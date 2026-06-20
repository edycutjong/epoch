import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@': path.resolve(__dirname, './src'),
      'did-jwt': path.resolve(__dirname, './node_modules/did-jwt/lib/index.module.js'),
    },
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/theme/**', '**/theme/**', '**/*snippet*.ts'],
    },
    server: {
      deps: {
        inline: [
          '@terminal3/ecdsa_vc',
          '@terminal3/vc_core',
          '@terminal3/verify_vc',
          '@terminal3/t3n-sdk',
          'did-jwt',
          '@scure/base',
        ],
      },
    },
  },
});
