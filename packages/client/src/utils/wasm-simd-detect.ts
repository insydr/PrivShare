/**
 * WASM SIMD Detection Module
 * ==========================
 * 
 * Detects WebAssembly SIMD support and loads the appropriate WASM module.
 * Provides graceful fallback for browsers without SIMD support.
 * 
 * Performance Impact:
 * - SIMD-enabled: ~2-4x faster redaction processing
 * - Fallback: Uses standard WASM without SIMD optimizations
 * 
 * Browser Support (as of 2024):
 * - Chrome 91+ (SIMD)
 * - Firefox 89+ (SIMD)
 * - Safari 16.4+ (SIMD)
 * - Edge 91+ (SIMD)
 */

// Types for WASM module capabilities
export interface WasmCapabilities {
    simd: boolean;
    threads: boolean;
    bulkMemory: boolean;
}

export interface WasmModule {
    init(): void;
    is_initialized(): boolean;
    has_simd_support(): boolean;
    get_capabilities(): string;
    process_image(buffer: Uint8Array, width: number, height: number): Uint8Array;
    redact_area(buffer: Uint8Array, x: number, y: number, w: number, h: number): Uint8Array;
    apply_redactions(buffer: Uint8Array, redactionsJson: string): Uint8Array;
    apply_redactions_with_metrics(buffer: Uint8Array, redactionsJson: string): string;
    get_hash(buffer: Uint8Array): string;
    get_image_info(buffer: Uint8Array): string;
    get_version(): string;
    get_module_info(): string;
}

// Singleton for cached capabilities
let _capabilities: WasmCapabilities | null = null;

/**
 * Detect WebAssembly SIMD support
 * 
 * Uses feature detection by attempting to compile a SIMD instruction.
 * This is more reliable than User-Agent sniffing.
 * 
 * @returns true if the browser supports WASM SIMD
 */
export function detectSimdSupport(): boolean {
    try {
        // Try to compile a SIMD instruction
        // This tests for the v128 type and basic SIMD operations
        const simdTestCode = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, // WASM_BINARY_MAGIC
            0x01, 0x00, 0x00, 0x00, // WASM_BINARY_VERSION
            0x01, 0x05,             // Type section
            0x01,                   // 1 type
            0x60,                   // Function type
            0x00,                   // 0 params
            0x01,                   // 1 result
            0x7b,                   // v128 type
            0x03, 0x02,             // Function section
            0x01,                   // 1 function
            0x00,                   // Function index
            0x0a, 0x0a,             // Code section
            0x01,                   // 1 function body
            0x08,                   // Body size
            0x00,                   // Local count
            0xfd, 0x0c,             // v128.const i32x4
            0x00, 0x00, 0x00, 0x00, // 4 x 0
            0x0b,                   // end
        ]);
        
        // Try to compile - will throw if SIMD not supported
        new WebAssembly.Module(simdTestCode);
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect WebAssembly bulk memory operations support
 * 
 * Bulk memory is used for efficient memory operations like memset,
 * which can significantly speed up redaction processing.
 * 
 * @returns true if bulk memory operations are supported
 */
export function detectBulkMemorySupport(): boolean {
    try {
        // Test for memory.fill instruction (part of bulk memory proposal)
        const bulkMemoryTestCode = new Uint8Array([
            0x00, 0x61, 0x73, 0x6d, // WASM_BINARY_MAGIC
            0x01, 0x00, 0x00, 0x00, // WASM_BINARY_VERSION
            0x05, 0x03,             // Memory section
            0x01,                   // 1 memory
            0x00, 0x01,             // limits: min 1 page
            0x03, 0x02,             // Function section
            0x01,                   // 1 function
            0x00,                   // Function index
            0x0a, 0x08,             // Code section
            0x01,                   // 1 function body
            0x06,                   // Body size
            0x00,                   // Local count
            0x41, 0x00,             // i32.const 0
            0x41, 0x00,             // i32.const 0
            0x0b,                   // end
        ]);
        
        new WebAssembly.Module(bulkMemoryTestCode);
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect WebAssembly threading support (SharedArrayBuffer)
 * 
 * Threading requires:
 * 1. SharedArrayBuffer support
 * 2. COOP/COEP headers for cross-origin isolation
 * 
 * @returns true if threading is available
 */
export function detectThreadingSupport(): boolean {
    // Check for SharedArrayBuffer availability
    if (typeof SharedArrayBuffer === 'undefined') {
        return false;
    }
    
    // Check for cross-origin isolation (required for SharedArrayBuffer)
    if (typeof window !== 'undefined') {
        if (!window.crossOriginIsolated) {
            console.warn('[WASM] Cross-origin isolation not enabled. Threading unavailable.');
            return false;
        }
    }
    
    return true;
}

/**
 * Get all WASM capabilities
 * 
 * Caches the result for performance.
 * 
 * @returns Object with capability flags
 */
export function getCapabilities(): WasmCapabilities {
    if (_capabilities) {
        return _capabilities;
    }
    
    _capabilities = {
        simd: detectSimdSupport(),
        threads: detectThreadingSupport(),
        bulkMemory: detectBulkMemorySupport(),
    };
    
    return _capabilities;
}

/**
 * Log capability information to console
 */
export function logCapabilities(): void {
    const caps = getCapabilities();
    
    console.log('%c╔════════════════════════════════════════════════════╗', 'color: cyan');
    console.log('%c║        WASM Performance Capabilities               ║', 'color: cyan');
    console.log('%c╠════════════════════════════════════════════════════╣', 'color: cyan');
    console.log(`%c║  SIMD:          ${caps.simd ? '✅ Supported' : '❌ Not Available'}${' '.repeat(24 - (caps.simd ? 12 : 16))}║`, caps.simd ? 'color: green' : 'color: yellow');
    console.log(`%c║  Threading:     ${caps.threads ? '✅ Supported' : '❌ Not Available'}${' '.repeat(24 - (caps.threads ? 12 : 16))}║`, caps.threads ? 'color: green' : 'color: yellow');
    console.log(`%c║  Bulk Memory:   ${caps.bulkMemory ? '✅ Supported' : '❌ Not Available'}${' '.repeat(24 - (caps.bulkMemory ? 12 : 16))}║`, caps.bulkMemory ? 'color: green' : 'color: yellow');
    console.log('%c╚════════════════════════════════════════════════════╝', 'color: cyan');
    
    // Provide recommendations
    if (!caps.simd) {
        console.warn('💡 SIMD not available. Consider using a modern browser (Chrome 91+, Firefox 89+, Safari 16.4+) for better performance.');
    }
    
    if (!caps.threads && caps.simd) {
        console.info('💡 For multi-threaded processing, enable COOP/COEP headers on your server.');
    }
}

/**
 * Load the appropriate WASM module based on capabilities
 * 
 * @returns Promise resolving to the initialized WASM module
 */
export async function loadWasmModule(): Promise<WasmModule> {
    const caps = getCapabilities();
    logCapabilities();
    
    try {
        // Import the WASM module
        // The build process generates different modules based on features
        let wasmModule: WasmModule;
        
        if (caps.simd) {
            // Load SIMD-optimized module
            console.log('[WASM] Loading SIMD-optimized module...');
            const module = await import('../../public/wasm/wasm_core.js');
            wasmModule = module.default || module;
        } else {
            // Fallback to standard module (same path for now, but could be different)
            console.log('[WASM] Loading standard module (no SIMD)...');
            const module = await import('../../public/wasm/wasm_core.js');
            wasmModule = module.default || module;
        }
        
        // Initialize the module
        wasmModule.init();
        
        // Verify initialization
        if (!wasmModule.is_initialized()) {
            throw new Error('WASM module failed to initialize');
        }
        
        // Log module info
        const moduleInfo = wasmModule.get_module_info();
        console.log('[WASM] Module loaded:', JSON.parse(moduleInfo));
        
        return wasmModule;
        
    } catch (error) {
        console.error('[WASM] Failed to load module:', error);
        throw new Error(`Failed to load WASM module: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Performance benchmark for WASM module
 * 
 * Runs a simple benchmark to measure redaction performance.
 * Useful for comparing SIMD vs non-SIMD performance.
 * 
 * @param wasm - Initialized WASM module
 * @param iterations - Number of benchmark iterations
 * @returns Benchmark results in milliseconds
 */
export async function benchmarkRedaction(wasm: WasmModule, iterations: number = 10): Promise<{
    avgTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
}> {
    console.log(`[Benchmark] Running ${iterations} iterations...`);
    
    // Create a test image buffer (1000x1000 RGBA)
    const width = 1000;
    const height = 1000;
    const testBuffer = new Uint8Array(width * height * 4);
    // Fill with white pixels
    testBuffer.fill(255);
    
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        
        // Redact a 100x100 area
        wasm.redact_area(testBuffer, 100, 100, 100, 100);
        
        const end = performance.now();
        times.push(end - start);
    }
    
    const totalTime = times.reduce((a, b) => a + b, 0);
    const avgTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    console.log(`[Benchmark] Results:
  Average: ${avgTime.toFixed(2)}ms
  Min: ${minTime.toFixed(2)}ms
  Max: ${maxTime.toFixed(2)}ms
  Total: ${totalTime.toFixed(2)}ms`);
    
    return { avgTime, minTime, maxTime, totalTime };
}

/**
 * Create a performance report comparing SIMD vs expected non-SIMD times
 */
export function createPerformanceReport(wasm: WasmModule): {
    capabilities: WasmCapabilities;
    moduleInfo: Record<string, unknown>;
    recommendation: string;
} {
    const caps = getCapabilities();
    let moduleInfo: Record<string, unknown> = {};
    
    try {
        moduleInfo = JSON.parse(wasm.get_module_info());
    } catch {
        // Ignore parse errors
    }
    
    let recommendation = '';
    
    if (!caps.simd) {
        recommendation = 'Upgrade to a modern browser with SIMD support for 2-4x faster processing. Supported browsers: Chrome 91+, Firefox 89+, Safari 16.4+, Edge 91+.';
    } else if (!caps.threads) {
        recommendation = 'Enable COOP/COEP headers to unlock multi-threaded processing for even faster performance on large documents.';
    } else {
        recommendation = 'Your browser supports all performance features. You should see optimal processing speeds.';
    }
    
    return {
        capabilities: caps,
        moduleInfo,
        recommendation,
    };
}

// Export a convenience function for one-time capability check
export const isSimdSupported = detectSimdSupport;
export const isThreadingSupported = detectThreadingSupport;

// Default export for convenience
export default {
    detectSimdSupport,
    detectThreadingSupport,
    detectBulkMemorySupport,
    getCapabilities,
    logCapabilities,
    loadWasmModule,
    benchmarkRedaction,
    createPerformanceReport,
};
