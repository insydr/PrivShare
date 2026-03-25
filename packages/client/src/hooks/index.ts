/**
 * Hooks Index
 * Export all custom React hooks
 */

export { useWasmProcessor, useDocumentProcessor } from './useWasmProcessor';

export { useCanvas } from './useCanvas';
export type { UseCanvasOptions, UseCanvasReturn } from './useCanvas';

export { useCollaboration } from './useCollaboration';
export type { UseCollaborationOptions, UseCollaborationResult } from './useCollaboration';

// OCR Processing
export { useOcrProcessor, useOcrWithPiiDetection } from './useOcrProcessor';
export type { UseOcrProcessorOptions, UseOcrProcessorResult, TextRegion, OcrResult, OcrProgress } from './useOcrProcessor';

// OCR with PII Detection
export { useOcrWithPii } from './useOcrWithPii';
export type { 
    UseOcrWithPiiOptions, 
    UseOcrWithPiiResult, 
    PiiRegion, 
    OcrPiiResult 
} from './useOcrWithPii';

// P2P File Transfer
export { useP2PTransfer } from './useP2PTransfer';
export type { 
    UseP2PTransferOptions, 
    UseP2PTransferResult, 
    TransferState,
    IncomingTransferRequest
} from './useP2PTransfer';

// PDF Processing
export { usePdfProcessor } from './usePdfProcessor';
