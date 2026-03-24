/**
 * WasmWorker Class
 * ================
 * 
 * TypeScript class that manages Web Worker communication for WASM processing.
 * Provides a Promise-based API for async operations without blocking the main thread.
 * 
 * Key Features:
 * - Promise-based async API (no callbacks)
 * - Request/response correlation via unique IDs
 * - Transferable object support for zero-copy buffer passing
 * - Automatic timeout handling
 * - Loading state management
 * - Debug logging support
 * 
 * Usage:
 * ```typescript
 * const wasmWorker = new WasmWorker();
 * await wasmWorker.initialize();
 * const result = await wasmWorker.loadImage(file);
 * ```
 */

import type {
    WasmLoadingState,
    WasmModuleInfo,
    WasmWorkerMessage,
    WasmWorkerResponse,
    WasmWorkerState,
    Box,
    LoadImageResult,
    RedactResult,
    ImageInfo,
    PiiMatch,
    TextRegion,
} from '../types/wasm-worker';

// ============================================
// CONFIGURATION
// ============================================

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEBUG = import.meta.env.DEV;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique ID for request tracking
 */
function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if response indicates success
 */
function isSuccessResponse(type: string): boolean {
    return type.endsWith('_SUCCESS') || type.endsWith('_RESULT');
}

// ============================================
// WASM WORKER CLASS
// ============================================

export class WasmWorker {
    private worker: Worker | null = null;
    private state: WasmWorkerState = {
        loadingState: 'idle',
        moduleInfo: null,
        error: null,
        pendingRequests: new Map(),
    };
    private timeout: number;
    private debug: boolean;

    constructor(options?: { timeout?: number; debug?: boolean }) {
        this.timeout = options?.timeout ?? DEFAULT_TIMEOUT;
        this.debug = options?.debug ?? DEBUG;
    }

    // ============================================
    // PROPERTY ACCESSORS
    // ============================================

    /**
     * Current loading state of the WASM module
     */
    get loadingState(): WasmLoadingState {
        return this.state.loadingState;
    }

    /**
     * Whether the WASM module is ready for processing
     */
    get isReady(): boolean {
        return this.state.loadingState === 'ready';
    }

    /**
     * Whether an operation is currently in progress
     */
    get isLoading(): boolean {
        return this.state.loadingState === 'loading';
    }

    /**
     * Current error message, if any
     */
    get error(): string | null {
        return this.state.error;
    }

    /**
     * WASM module information
     */
    get moduleInfo(): WasmModuleInfo | null {
        return this.state.moduleInfo;
    }

    // ============================================
    // PRIVATE METHODS
    // ============================================

    /**
     * Log debug messages
     */
    private log(message: string, ...args: unknown[]): void {
        if (this.debug) {
            console.log(`[WasmWorker] ${message}`, ...args);
        }
    }

    /**
     * Get or create the worker instance
     */
    private getWorker(): Worker {
        if (!this.worker) {
            // Create worker from Vite's worker import syntax
            // The ?worker query parameter tells Vite to treat this as a worker
            this.worker = new Worker(
                new URL('./wasm.worker.ts', import.meta.url),
                { type: 'module' }
            );
            
            this.worker.onmessage = this.handleWorkerMessage.bind(this);
            this.worker.onerror = this.handleWorkerError.bind(this);
            
            this.log('Worker created');
        }
        return this.worker;
    }

    /**
     * Handle messages from the worker
     */
    private handleWorkerMessage(event: MessageEvent<WasmWorkerResponse>): void {
        const { type, id, payload, error } = event.data;
        
        // Handle log messages from worker
        if (type === 'LOG') {
            const logData = event.data as { level: string; message: string };
            if (this.debug) {
                const logFn = logData.level === 'error' 
                    ? console.error 
                    : logData.level === 'warn' 
                        ? console.warn 
                        : console.log;
                logFn(logData.message);
            }
            return;
        }
        
        this.log(`Received response: ${type} (id: ${id})`);
        
        // Find pending request
        const pending = this.state.pendingRequests.get(id);
        if (!pending) {
            this.log(`No pending request found for id: ${id}`, 'warn');
            return;
        }
        
        // Clear timeout
        clearTimeout(pending.timeout);
        this.state.pendingRequests.delete(id);
        
        // Handle response
        if (error) {
            this.log(`Request failed: ${error}`);
            pending.reject(new Error(error));
        } else {
            this.log('Request succeeded');
            pending.resolve(payload);
        }
    }

    /**
     * Handle worker errors
     */
    private handleWorkerError(event: ErrorEvent): void {
        this.log(`Worker error: ${event.message}`, 'error');
        this.state.error = event.message;
        this.state.loadingState = 'error';
        
        // Reject all pending requests
        for (const [id, pending] of this.state.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`Worker error: ${event.message}`));
        }
        this.state.pendingRequests.clear();
    }

    /**
     * Send a message to the worker and return a promise
     */
    private send<T = unknown>(
        type: WasmWorkerMessage['type'],
        payload?: unknown,
        transfer?: Transferable[]
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = generateRequestId();
            
            // Set up timeout
            const timeoutId = setTimeout(() => {
                this.state.pendingRequests.delete(id);
                reject(new Error(`Operation timed out after ${this.timeout}ms`));
            }, this.timeout);
            
            // Store pending request
            this.state.pendingRequests.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timeout: timeoutId,
            });
            
            // Send message
            const message = { type, id, payload };
            this.log(`Sending message: ${type} (id: ${id})`);
            
            if (transfer && transfer.length > 0) {
                this.getWorker().postMessage(message, transfer);
            } else {
                this.getWorker().postMessage(message);
            }
        });
    }

    // ============================================
    // PUBLIC API METHODS
    // ============================================

    /**
     * Initialize the WASM module
     * Must be called before any other operations
     */
    async initialize(): Promise<void> {
        if (this.state.loadingState === 'ready') {
            this.log('Already initialized');
            return;
        }
        
        if (this.state.loadingState === 'loading') {
            throw new Error('Initialization already in progress');
        }
        
        this.state.loadingState = 'loading';
        this.state.error = null;
        
        try {
            this.log('Initializing WASM module...');
            
            const result = await this.send<{
                moduleInfo: WasmModuleInfo;
                timestamp: number;
            }>('INIT');
            
            this.state.moduleInfo = result.moduleInfo;
            this.state.loadingState = 'ready';
            
            this.log(`WASM module initialized: v${result.moduleInfo.version}`);
        } catch (error) {
            this.state.loadingState = 'error';
            this.state.error = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }

    /**
     * Load an image file and get RGBA pixel data
     * 
     * @param file - File object from input or drag-drop
     * @returns LoadImageResult with pixel data and metadata
     */
    async loadImage(file: File): Promise<LoadImageResult> {
        this.ensureReady();
        
        this.log(`Loading image: ${file.name} (${file.size} bytes)`);
        
        // Read file as ArrayBuffer
        const buffer = await file.arrayBuffer();
        
        // Send to worker with transferable for zero-copy
        const result = await this.send<{
            rgbaBuffer: ArrayBuffer;
            dimensions: { width: number; height: number };
            info: ImageInfo;
            hash: string;
        }>('LOAD_IMAGE', { buffer, fileName: file.name }, [buffer]);
        
        // Convert RGBA buffer to ImageData
        const rgbaData = new Uint8ClampedArray(result.rgbaBuffer);
        const imageData = new ImageData(
            rgbaData,
            result.dimensions.width,
            result.dimensions.height
        );
        
        return {
            imageData,
            dimensions: result.dimensions,
            info: result.info,
            hash: result.hash,
        };
    }

    /**
     * Load an image from ArrayBuffer
     * 
     * @param buffer - Raw image bytes
     * @param fileName - Optional file name for logging
     * @returns LoadImageResult with pixel data and metadata
     */
    async loadImageFromBuffer(buffer: ArrayBuffer, fileName = 'unknown'): Promise<LoadImageResult> {
        this.ensureReady();
        
        this.log(`Loading image from buffer: ${fileName} (${buffer.byteLength} bytes)`);
        
        // Clone buffer for transfer (can't use original as it becomes detached)
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{
            rgbaBuffer: ArrayBuffer;
            dimensions: { width: number; height: number };
            info: ImageInfo;
            hash: string;
        }>('LOAD_IMAGE', { buffer: transferBuffer, fileName }, [transferBuffer]);
        
        const rgbaData = new Uint8ClampedArray(result.rgbaBuffer);
        const imageData = new ImageData(
            rgbaData,
            result.dimensions.width,
            result.dimensions.height
        );
        
        return {
            imageData,
            dimensions: result.dimensions,
            info: result.info,
            hash: result.hash,
        };
    }

    /**
     * Redact (burn) a black rectangle onto the image
     * This operation is IRREVERSIBLE
     * 
     * @param buffer - Image buffer (PNG/JPEG/etc)
     * @param box - Bounding box to redact
     * @returns RedactResult with redacted PNG buffer
     */
    async redactBox(buffer: ArrayBuffer, box: Box): Promise<RedactResult> {
        this.ensureReady();
        
        this.log(`Redacting box at (${box.x}, ${box.y}) size ${box.width}x${box.height}`);
        
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{
            pngBuffer: ArrayBuffer;
            redactedPixels: number;
            hash: string;
        }>('REDACT_BOX', { buffer: transferBuffer, box }, [transferBuffer]);
        
        return {
            pngBuffer: result.pngBuffer,
            redactedPixels: result.redactedPixels,
            hash: result.hash,
        };
    }

    /**
     * Apply multiple redactions at once
     * 
     * @param buffer - Image buffer
     * @param boxes - Array of bounding boxes to redact
     * @returns RedactResult with redacted PNG buffer
     */
    async redactMultiple(buffer: ArrayBuffer, boxes: Box[]): Promise<RedactResult> {
        this.ensureReady();
        
        this.log(`Applying ${boxes.length} redactions`);
        
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{
            pngBuffer: ArrayBuffer;
            redactedPixels: number;
            hash: string;
        }>('REDACT_MULTIPLE', { buffer: transferBuffer, boxes }, [transferBuffer]);
        
        return {
            pngBuffer: result.pngBuffer,
            redactedPixels: result.redactedPixels,
            hash: result.hash,
        };
    }

    /**
     * Generate SHA-256 hash of a buffer
     * 
     * @param buffer - Data to hash
     * @param label - Optional label for audit logging
     * @returns Hex-encoded SHA-256 hash
     */
    async getHash(buffer: ArrayBuffer, label?: string): Promise<string> {
        this.ensureReady();
        
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{ hash: string; label?: string }>(
            'GET_HASH',
            { buffer: transferBuffer, label },
            [transferBuffer]
        );
        
        return result.hash;
    }

    /**
     * Get image metadata without fully processing
     * 
     * @param buffer - Image buffer
     * @returns ImageInfo with dimensions and format
     */
    async getImageInfo(buffer: ArrayBuffer): Promise<ImageInfo> {
        this.ensureReady();
        
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{ info: ImageInfo }>(
            'GET_IMAGE_INFO',
            { buffer: transferBuffer },
            [transferBuffer]
        );
        
        return result.info;
    }

    /**
     * Resize an image to new dimensions
     * 
     * @param buffer - Image buffer
     * @param width - Target width
     * @param height - Target height
     * @returns Resized PNG buffer
     */
    async resizeImage(buffer: ArrayBuffer, width: number, height: number): Promise<ArrayBuffer> {
        this.ensureReady();
        
        this.log(`Resizing image to ${width}x${height}`);
        
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{
            pngBuffer: ArrayBuffer;
            newDimensions: { width: number; height: number };
        }>('RESIZE_IMAGE', { buffer: transferBuffer, newWidth: width, newHeight: height }, [transferBuffer]);
        
        return result.pngBuffer;
    }

    /**
     * Convert image to grayscale
     * 
     * @param buffer - Image buffer
     * @returns Grayscale PNG buffer
     */
    async toGrayscale(buffer: ArrayBuffer): Promise<ArrayBuffer> {
        this.ensureReady();
        
        this.log('Converting to grayscale');
        
        const transferBuffer = buffer.slice(0);
        
        const result = await this.send<{ pngBuffer: ArrayBuffer }>(
            'TO_GRAYSCALE',
            { buffer: transferBuffer },
            [transferBuffer]
        );
        
        return result.pngBuffer;
    }

    /**
     * Detect PII in text regions
     * 
     * @param regions - Array of detected text regions
     * @returns Array of PII matches
     */
    async detectPii(regions: TextRegion[]): Promise<PiiMatch[]> {
        this.ensureReady();
        
        this.log(`Detecting PII in ${regions.length} text regions`);
        
        const regionsJson = JSON.stringify(regions.map(r => ({
            text: r.text,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            confidence: r.confidence,
        })));
        
        const result = await this.send<{ matches: PiiMatch[]; count: number }>(
            'DETECT_PII',
            { regionsJson }
        );
        
        return result.matches;
    }

    /**
     * Get WASM module information
     * 
     * @returns Module info object
     */
    async getModuleInfo(): Promise<WasmModuleInfo> {
        if (this.state.moduleInfo) {
            return this.state.moduleInfo;
        }
        
        const result = await this.send<{ info: WasmModuleInfo }>('GET_MODULE_INFO');
        return result.info;
    }

    /**
     * Terminate the worker and cleanup resources
     */
    terminate(): void {
        if (this.worker) {
            this.log('Terminating worker');
            this.worker.postMessage({ type: 'TERMINATE', id: 'terminate' });
            this.worker.terminate();
            this.worker = null;
        }
        
        // Clear all pending requests
        for (const [, pending] of this.state.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Worker terminated'));
        }
        this.state.pendingRequests.clear();
        
        // Reset state
        this.state.loadingState = 'idle';
        this.state.moduleInfo = null;
        this.state.error = null;
    }

    /**
     * Ensure the worker is ready for operations
     */
    private ensureReady(): void {
        if (!this.isReady) {
            throw new Error(
                `WASM module not ready. Current state: ${this.state.loadingState}. ` +
                'Call initialize() first.'
            );
        }
    }
}

// ============================================
// SINGLETON INSTANCE (Optional)
// ============================================

let defaultInstance: WasmWorker | null = null;

/**
 * Get the default WasmWorker instance (singleton)
 */
export function getWasmWorker(): WasmWorker {
    if (!defaultInstance) {
        defaultInstance = new WasmWorker();
    }
    return defaultInstance;
}

/**
 * Terminate the default WasmWorker instance
 */
export function terminateWasmWorker(): void {
    if (defaultInstance) {
        defaultInstance.terminate();
        defaultInstance = null;
    }
}
