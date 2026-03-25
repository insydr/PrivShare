import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCSPPlugin } from './vite-plugins/csp-plugin';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        viteCSPPlugin({
            productionDomain: 'api.privshare.app',
            wsDomain: 'wss://api.privshare.app',
            generateSRI: true,
        }),
    ],
    
    // Build configuration
    build: {
        outDir: 'dist',
        sourcemap: false, // Disable source maps for production
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
            },
        },
        rollupOptions: {
            output: {
                // Ensure consistent file naming for SRI
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
    },
    
    // Development server configuration
    server: {
        port: 3000,
        headers: {
            // Security headers for development
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), microphone=()',
        },
    },
    
    // Optimize dependencies
    optimizeDeps: {
        include: ['react', 'react-dom', 'zustand'],
    },
});
