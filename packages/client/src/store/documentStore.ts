/**
 * Document Store
 * ==============
 * 
 * Zustand store for managing document processing state.
 * Integrates with WASM Web Worker for all heavy processing.
 * 
 * All data is stored locally in browser memory - never sent to any server.
 */

import { create } from 'zustand';
import type { Box, ImageInfo, TextRegion, PiiMatch } from '../types/wasm-worker';

// ============================================
// TYPES
// ============================================

export interface RedactionArea {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    pageIndex: number;
    type: 'auto' | 'manual';
    piiType?: string;
    confidence?: number;
}

export interface Document {
    id: string;
    name: string;
    size: number;
    type: string;
    pageCount: number;
    width: number;
    height: number;
    format: string;
    redactions: RedactionArea[];
    textRegions: TextRegion[];
    piiMatches: PiiMatch[];
    originalHash: string;
    redactedHash?: string;
    processedAt?: Date;
}

export interface ProcessingState {
    stage: 'idle' | 'loading' | 'processing' | 'redacting' | 'exporting' | 'error';
    progress: number;
    message: string;
}

interface DocumentState {
    // Document data
    document: Document | null;
    imageData: ImageData | null;
    currentBuffer: ArrayBuffer | null;
    previewBuffer: ArrayBuffer | null;
    
    // Processing state
    processing: ProcessingState;
    
    // View state
    currentPage: number;
    zoom: number;
    showRedactionPreview: boolean;
    selectedRedaction: string | null;
    
    // WASM state
    wasmReady: boolean;
    wasmError: string | null;
    
    // Actions - Document
    setDocument: (doc: Document | null) => void;
    setImageData: (data: ImageData | null) => void;
    setCurrentBuffer: (buffer: ArrayBuffer | null) => void;
    setPreviewBuffer: (buffer: ArrayBuffer | null) => void;
    
    // Actions - Redactions
    addRedaction: (redaction: RedactionArea) => void;
    removeRedaction: (id: string) => void;
    updateRedaction: (id: string, updates: Partial<RedactionArea>) => void;
    clearRedactions: () => void;
    setSelectedRedaction: (id: string | null) => void;
    
    // Actions - Text & PII
    setTextRegions: (regions: TextRegion[]) => void;
    setPiiMatches: (matches: PiiMatch[]) => void;
    
    // Actions - Processing
    setProcessing: (state: ProcessingState) => void;
    setWasmReady: (ready: boolean) => void;
    setWasmError: (error: string | null) => void;
    
    // Actions - View
    setCurrentPage: (page: number) => void;
    setZoom: (zoom: number) => void;
    toggleRedactionPreview: () => void;
    
    // Actions - Reset
    clearDocument: () => void;
    reset: () => void;
}

// ============================================
// INITIAL STATE
// ============================================

const initialState = {
    document: null,
    imageData: null,
    currentBuffer: null,
    previewBuffer: null,
    processing: {
        stage: 'idle' as const,
        progress: 0,
        message: '',
    },
    currentPage: 0,
    zoom: 1,
    showRedactionPreview: false,
    selectedRedaction: null,
    wasmReady: false,
    wasmError: null,
};

// ============================================
// STORE
// ============================================

export const useDocumentStore = create<DocumentState>((set, get) => ({
    ...initialState,

    // ============================================
    // DOCUMENT ACTIONS
    // ============================================

    setDocument: (doc) => set({ document: doc }),
    
    setImageData: (data) => set({ imageData: data }),
    
    setCurrentBuffer: (buffer) => set({ currentBuffer: buffer }),
    
    setPreviewBuffer: (buffer) => set({ previewBuffer: buffer }),

    // ============================================
    // REDACTION ACTIONS
    // ============================================

    addRedaction: (redaction) => set((state) => ({
        document: state.document
            ? {
                  ...state.document,
                  redactions: [...state.document.redactions, redaction],
              }
            : null,
    })),

    removeRedaction: (id) => set((state) => ({
        document: state.document
            ? {
                  ...state.document,
                  redactions: state.document.redactions.filter((r) => r.id !== id),
              }
            : null,
        selectedRedaction: state.selectedRedaction === id ? null : state.selectedRedaction,
    })),

    updateRedaction: (id, updates) => set((state) => ({
        document: state.document
            ? {
                  ...state.document,
                  redactions: state.document.redactions.map((r) =>
                      r.id === id ? { ...r, ...updates } : r
                  ),
              }
            : null,
    })),

    clearRedactions: () => set((state) => ({
        document: state.document
            ? {
                  ...state.document,
                  redactions: [],
                  piiMatches: [],
              }
            : null,
    })),

    setSelectedRedaction: (id) => set({ selectedRedaction: id }),

    // ============================================
    // TEXT & PII ACTIONS
    // ============================================

    setTextRegions: (regions) => set((state) => ({
        document: state.document
            ? { ...state.document, textRegions: regions }
            : null,
    })),

    setPiiMatches: (matches) => set((state) => {
        // Auto-create redactions for PII matches
        const autoRedactions: RedactionArea[] = matches.map((match, index) => {
            const region = state.document?.textRegions[match.regionIndex];
            return {
                id: `pii-${index}`,
                x: region?.x ?? 0,
                y: region?.y ?? 0,
                width: region?.width ?? 100,
                height: region?.height ?? 20,
                pageIndex: 0,
                type: 'auto' as const,
                piiType: match.piiType,
                confidence: match.confidence,
            };
        });

        return {
            document: state.document
                ? {
                      ...state.document,
                      piiMatches: matches,
                      redactions: [
                          ...state.document.redactions.filter(r => r.type !== 'auto'),
                          ...autoRedactions,
                      ],
                  }
                : null,
        };
    }),

    // ============================================
    // PROCESSING ACTIONS
    // ============================================

    setProcessing: (processing) => set({ processing }),

    setWasmReady: (ready) => set({ wasmReady: ready }),

    setWasmError: (error) => set({ wasmError: error, wasmReady: false }),

    // ============================================
    // VIEW ACTIONS
    // ============================================

    setCurrentPage: (page) => set({ currentPage: page }),

    setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),

    toggleRedactionPreview: () => set((state) => ({
        showRedactionPreview: !state.showRedactionPreview,
    })),

    // ============================================
    // RESET ACTIONS
    // ============================================

    clearDocument: () => set({
        document: null,
        imageData: null,
        currentBuffer: null,
        previewBuffer: null,
        processing: { stage: 'idle', progress: 0, message: '' },
        currentPage: 0,
        zoom: 1,
        showRedactionPreview: false,
        selectedRedaction: null,
    }),

    reset: () => set(initialState),
}));

// ============================================
// SELECTORS
// ============================================

export const selectDocument = (state: DocumentState) => state.document;
export const selectImageData = (state: DocumentState) => state.imageData;
export const selectRedactions = (state: DocumentState) => state.document?.redactions ?? [];
export const selectProcessing = (state: DocumentState) => state.processing;
export const selectIsProcessing = (state: DocumentState) => 
    state.processing.stage !== 'idle' && state.processing.stage !== 'error';
export const selectWasmStatus = (state: DocumentState) => ({
    ready: state.wasmReady,
    error: state.wasmError,
});
