import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite Configuration for PrivShare Client
 * 
 * Key features:
 * - Serves .wasm files with correct MIME type ('application/wasm')
 * - Configures proper headers for WebAssembly compilation
 * - Enables SharedArrayBuffer for multi-threaded WASM (requires COOP/COEP headers)
 * - Enforces strict Content Security Policy for security
 */
export default defineConfig({
  plugins: [react()],
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Asset handling for WASM files
  assetsInclude: ['**/*.wasm'],
  
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Ensure WASM files are copied to output
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'wasm/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },

  optimizeDeps: {
    // Exclude WASM packages from optimization
    exclude: ['wasm-core'],
    esbuildOptions: {
      target: 'esnext',
    },
  },

  server: {
    port: 3000,
    strictPort: true,
    
    // Custom headers for WASM and security
    headers: {
      // WASM MIME type - critical for WebAssembly compilation
      'Content-Type': 'application/wasm',
      
      // Required for SharedArrayBuffer (multi-threaded WASM)
      // These headers enable the browser to create shared memory
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      
      // Security headers
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      
      // Content Security Policy for Zero-Trust architecture
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' ws://localhost:3001 wss://*.privshare.app",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; '),
    },
    
    // Proxy for signaling server API
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },

  preview: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Worker configuration for WASM Web Workers
  worker: {
    format: 'es',
    plugins: () => [],
  },
});
