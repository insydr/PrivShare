/**
 * WASM Worker Types
 * =================
 * 
 * Type definitions for communication between main thread and Web Worker.
 * All communication uses postMessage with typed message structures.
 */

// ============================================
// COORDINATE & BOX TYPES
// ============================================

/**
 * Bounding box for redaction areas
 */
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
    pageIndex?: number;
}

/**
 * Image dimensions
 */
export interface ImageDimensions {
    width: number;
    height: number;
}

/**
 * Detected text region from OCR
 */
export interface TextRegion {
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

/**
 * Detected PII match
 */
export interface PiiMatch {
    text: string;
    piiType: 'email' | 'ssn' | 'phone' | 'credit_card' | 'other';
    regionIndex: number;
    confidence: number;
}

// ============================================
// WASM MODULE TYPES
// ============================================

/**
 * WASM module loading states
 */
export type WasmLoadingState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * WASM module information
 */
export interface WasmModuleInfo {
    name: string;
    version: string;
    description: string;
    license: string;
}

/**
 * Image metadata from WASM processing
 */
export interface ImageInfo {
    width: number;
    height: number;
    channels: number;
    format: string;
    sizeBytes: number;
}

/**
 * Result of image loading operation
 */
export interface LoadImageResult {
    imageData: ImageData;
    dimensions: ImageDimensions;
    info: ImageInfo;
    hash: string;
}

/**
 * Result of redaction operation
 */
export interface RedactResult {
    pngBuffer: ArrayBuffer;
    redactedPixels: number;
    hash: string;
}

/**
 * OCR processing result
 */
export interface OcrResult {
    regions: TextRegion[];
    processingTimeMs: number;
}

// ============================================
// WORKER MESSAGE TYPES
// ============================================

/**
 * Message types sent from main thread to worker
 */
export type WasmWorkerRequestType =
    | 'INIT'
    | 'LOAD_IMAGE'
    | 'REDACT_BOX'
    | 'REDACT_MULTIPLE'
    | 'GET_HASH'
    | 'GET_IMAGE_INFO'
    | 'RESIZE_IMAGE'
    | 'TO_GRAYSCALE'
    | 'DETECT_PII'
    | 'GET_MODULE_INFO'
    | 'TERMINATE';

/**
 * Message types sent from worker to main thread
 */
export type WasmWorkerResponseType =
    | 'INIT_SUCCESS'
    | 'INIT_ERROR'
    | 'LOAD_IMAGE_SUCCESS'
    | 'LOAD_IMAGE_ERROR'
    | 'REDACT_SUCCESS'
    | 'REDACT_ERROR'
    | 'HASH_RESULT'
    | 'HASH_ERROR'
    | 'IMAGE_INFO_RESULT'
    | 'IMAGE_INFO_ERROR'
    | 'RESIZE_SUCCESS'
    | 'RESIZE_ERROR'
    | 'GRAYSCALE_SUCCESS'
    | 'GRAYSCALE_ERROR'
    | 'PII_RESULT'
    | 'PII_ERROR'
    | 'MODULE_INFO_RESULT'
    | 'MODULE_INFO_ERROR'
    | 'PROCESSING_ERROR';

/**
 * Base message structure for worker communication
 */
export interface WasmWorkerMessage<T = unknown> {
    readonly type: WasmWorkerRequestType;
    readonly id: string;
    readonly payload: T;
}

/**
 * Base response structure from worker
 */
export interface WasmWorkerResponse<T = unknown> {
    readonly type: WasmWorkerResponseType;
    readonly id: string;
    readonly payload?: T;
    readonly error?: string;
}

// ============================================
// REQUEST PAYLOAD TYPES
// ============================================

export interface InitPayload {
    // No payload needed for init
}

export interface LoadImagePayload {
    buffer: ArrayBuffer;
    fileName: string;
}

export interface RedactBoxPayload {
    buffer: ArrayBuffer;
    box: Box;
}

export interface RedactMultiplePayload {
    buffer: ArrayBuffer;
    boxes: Box[];
}

export interface GetHashPayload {
    buffer: ArrayBuffer;
    label?: string;
}

export interface GetImageInfoPayload {
    buffer: ArrayBuffer;
}

export interface ResizeImagePayload {
    buffer: ArrayBuffer;
    newWidth: number;
    newHeight: number;
}

export interface ToGrayscalePayload {
    buffer: ArrayBuffer;
}

export interface DetectPiiPayload {
    regionsJson: string;
}

// ============================================
// RESPONSE PAYLOAD TYPES
// ============================================

export interface InitSuccessPayload {
    moduleInfo: WasmModuleInfo;
    timestamp: number;
}

export interface InitErrorPayload {
    message: string;
    stack?: string;
}

export interface LoadImageSuccessPayload {
    rgbaBuffer: ArrayBuffer;
    dimensions: ImageDimensions;
    info: ImageInfo;
    hash: string;
}

export interface RedactSuccessPayload {
    pngBuffer: ArrayBuffer;
    redactedPixels: number;
    hash: string;
}

export interface HashResultPayload {
    hash: string;
    label?: string;
}

export interface ImageInfoResultPayload {
    info: ImageInfo;
}

export interface ResizeSuccessPayload {
    pngBuffer: ArrayBuffer;
    newDimensions: ImageDimensions;
}

export interface GrayscaleSuccessPayload {
    pngBuffer: ArrayBuffer;
}

export interface PiiResultPayload {
    matches: PiiMatch[];
    count: number;
}

export interface ModuleInfoResultPayload {
    info: WasmModuleInfo;
}

// ============================================
// FULL MESSAGE TYPES (Request -> Response)
// ============================================

export type InitMessage = WasmWorkerMessage<InitPayload>;
export type InitSuccessResponse = WasmWorkerResponse<InitSuccessPayload>;
export type InitErrorResponse = WasmWorkerResponse<InitErrorPayload>;

export type LoadImageMessage = WasmWorkerMessage<LoadImagePayload>;
export type LoadImageSuccessResponse = WasmWorkerResponse<LoadImageSuccessPayload>;
export type LoadImageErrorResponse = WasmWorkerResponse<{ message: string }>;

export type RedactBoxMessage = WasmWorkerMessage<RedactBoxPayload>;
export type RedactSuccessResponse = WasmWorkerResponse<RedactSuccessPayload>;
export type RedactErrorResponse = WasmWorkerResponse<{ message: string }>;

export type GetHashMessage = WasmWorkerMessage<GetHashPayload>;
export type HashResultResponse = WasmWorkerResponse<HashResultPayload>;

export type GetImageInfoMessage = WasmWorkerMessage<GetImageInfoPayload>;
export type ImageInfoResultResponse = WasmWorkerResponse<ImageInfoResultPayload>;

export type ResizeImageMessage = WasmWorkerMessage<ResizeImagePayload>;
export type ResizeSuccessResponse = WasmWorkerResponse<ResizeSuccessPayload>;

export type ToGrayscaleMessage = WasmWorkerMessage<ToGrayscalePayload>;
export type GrayscaleSuccessResponse = WasmWorkerResponse<GrayscaleSuccessPayload>;

export type DetectPiiMessage = WasmWorkerMessage<DetectPiiPayload>;
export type PiiResultResponse = WasmWorkerResponse<PiiResultPayload>;

// ============================================
// HOOK TYPES
// ============================================

/**
 * Return type for useWasmProcessor hook
 */
export interface UseWasmProcessorResult {
    // State
    loadingState: WasmLoadingState;
    isReady: boolean;
    isLoading: boolean;
    error: string | null;
    
    // Module info
    moduleInfo: WasmModuleInfo | null;
    
    // Actions
    initialize: () => Promise<void>;
    loadImage: (file: File) => Promise<LoadImageResult>;
    redactBox: (buffer: ArrayBuffer, box: Box) => Promise<RedactResult>;
    redactMultiple: (buffer: ArrayBuffer, boxes: Box[]) => Promise<RedactResult>;
    getHash: (buffer: ArrayBuffer, label?: string) => Promise<string>;
    getImageInfo: (buffer: ArrayBuffer) => Promise<ImageInfo>;
    resizeImage: (buffer: ArrayBuffer, width: number, height: number) => Promise<ArrayBuffer>;
    toGrayscale: (buffer: ArrayBuffer) => Promise<ArrayBuffer>;
    detectPii: (regions: TextRegion[]) => Promise<PiiMatch[]>;
    terminate: () => void;
}

/**
 * Options for useWasmProcessor hook
 */
export interface UseWasmProcessorOptions {
    /**
     * Auto-initialize on mount
     * @default true
     */
    autoInit?: boolean;
    
    /**
     * Log worker messages to console
     * @default false
     */
    debug?: boolean;
    
    /**
     * Timeout for operations (ms)
     * @default 30000
     */
    timeout?: number;
}

// ============================================
// WORKER STATE TYPES
// ============================================

/**
 * Internal state of the WasmWorker instance
 */
export interface WasmWorkerState {
    loadingState: WasmLoadingState;
    moduleInfo: WasmModuleInfo | null;
    error: string | null;
    pendingRequests: Map<string, {
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>;
}
