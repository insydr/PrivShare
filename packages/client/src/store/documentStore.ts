/**
 * Document Store
 * ==============
 * 
 * Zustand store for managing document processing state.
 * Integrates with WASM Web Worker for all heavy processing.
 * 
 * All data is stored locally in browser memory - never sent to any server.
 * 
 * Collaboration features sync only JSON metadata (coordinates), never files.
 * 
 * Supports multi-page PDF documents with page-specific redactions.
 */

import { create } from 'zustand';
import type { TextRegion, PiiMatch } from '../types/wasm-worker';
import type { 
    Collaborator, 
    CursorPosition,
    SyncedRedactionBox,
    ConnectionState,
    RedactionBox
} from '../types/collaboration';
import { mergeRedactions } from '../types/collaboration';

// ============================================
// TYPES
// ============================================

export interface PageInfo {
    pageNumber: number;
    width: number;
    height: number;
    rotation: number;
    scale: number;
}

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
    createdAt?: number;
    userId?: string;
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
    pages: PageInfo[];
    redactions: RedactionArea[];
    textRegions: TextRegion[];
    piiMatches: PiiMatch[];
    originalHash: string;
    redactedHash?: string;
    processedAt?: Date;
    isPdf?: boolean;
}

export interface FinalizedDocument {
    id: string;
    name: string;
    size: number;
    originalHash: string;
    redactedHash: string;
    redactionCount: number;
    finalizedAt: Date;
    encryptedKey?: string;
    keyIv?: string;
    thumbnailBase64?: string;
}

export interface ProcessingState {
    stage: 'idle' | 'loading' | 'processing' | 'rendering' | 'redacting' | 'exporting' | 'error';
    progress: number;
    message: string;
}

export interface TextRegionStore {
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
}

export interface CollaborationState {
    connectionState: ConnectionState;
    roomId: string | null;
    currentUserId: string | null;
    collaborators: Collaborator[];
    cursors: CursorPosition[];
    isCollabEnabled: boolean;
}

interface DocumentState {
    // Document data
    document: Document | null;
    imageData: ImageData | null;
    currentBuffer: ArrayBuffer | null;
    previewBuffer: ArrayBuffer | null;
    finalizedDocument: FinalizedDocument | null;
    
    // Multi-page support
    pageImageData: Map<number, ImageData>;  // Page number -> ImageData
    pdfBuffer: ArrayBuffer | null;          // Original PDF buffer for multi-page docs
    renderedPages: Set<number>;             // Track which pages have been rendered
    
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
    
    // Collaboration state
    collaboration: CollaborationState;
    
    // Actions - Document
    setDocument: (doc: Document | null) => void;
    setImageData: (data: ImageData | null) => void;
    setCurrentBuffer: (buffer: ArrayBuffer | null) => void;
    setPreviewBuffer: (buffer: ArrayBuffer | null) => void;
    
    // Actions - Multi-page
    setPageImageData: (pageNumber: number, data: ImageData) => void;
    getPageImageData: (pageNumber: number) => ImageData | null;
    setPdfBuffer: (buffer: ArrayBuffer | null) => void;
    clearPageCache: () => void;
    
    // Actions - Redactions
    addRedaction: (redaction: RedactionArea) => void;
    removeRedaction: (id: string) => void;
    updateRedaction: (id: string, updates: Partial<RedactionArea>) => void;
    clearRedactions: () => void;
    clearPageRedactions: (pageIndex: number) => void;
    setSelectedRedaction: (id: string | null) => void;
    
    // Actions - Text & PII
    setTextRegions: (regions: TextRegion[]) => void;
    setPiiMatches: (matches: PiiMatch[]) => void;
    setPagePiiMatches: (pageIndex: number, matches: PiiMatch[]) => void;
    
    // Actions - Processing
    setProcessing: (state: ProcessingState) => void;
    setWasmReady: (ready: boolean) => void;
    setWasmError: (error: string | null) => void;
    
    // Actions - View
    setCurrentPage: (page: number) => void;
    setZoom: (zoom: number) => void;
    toggleRedactionPreview: () => void;
    
    // Actions - Collaboration
    setConnectionState: (state: ConnectionState) => void;
    setRoomId: (roomId: string | null) => void;
    setCurrentUserId: (userId: string | null) => void;
    setCollaborators: (collaborators: Collaborator[]) => void;
    addCollaborator: (collaborator: Collaborator) => void;
    removeCollaborator: (userId: string) => void;
    updateCursor: (cursor: CursorPosition) => void;
    removeCursor: (userId: string) => void;
    setCollabEnabled: (enabled: boolean) => void;
    
    // Actions - Remote Redaction Sync (last-write-wins)
    mergeRemoteRedactions: (remoteBoxes: SyncedRedactionBox[], remoteUserId: string) => void;
    replaceRedactions: (redactions: RedactionArea[]) => void;
    
    // Actions - Finalized Document
    setFinalizedDocument: (doc: FinalizedDocument | null) => void;
    clearFinalizedDocument: () => void;
    
    // Actions - Reset
    clearDocument: () => void;
    reset: () => void;
}

// ============================================
// INITIAL STATE
// ============================================

const initialCollaborationState: CollaborationState = {
    connectionState: 'disconnected',
    roomId: null,
    currentUserId: null,
    collaborators: [],
    cursors: [],
    isCollabEnabled: false,
};

const initialState = {
    document: null,
    imageData: null,
    currentBuffer: null,
    previewBuffer: null,
    finalizedDocument: null,
    pageImageData: new Map<number, ImageData>(),
    pdfBuffer: null,
    renderedPages: new Set<number>(),
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
    collaboration: initialCollaborationState,
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
    // MULTI-PAGE ACTIONS
    // ============================================

    setPageImageData: (pageNumber, data) => set((state) => {
        const newPageImageData = new Map(state.pageImageData);
        newPageImageData.set(pageNumber, data);
        const newRenderedPages = new Set(state.renderedPages);
        newRenderedPages.add(pageNumber);
        
        // Also update the main imageData if this is the current page
        if (pageNumber === state.currentPage) {
            return {
                pageImageData: newPageImageData,
                renderedPages: newRenderedPages,
                imageData: data,
            };
        }
        
        return {
            pageImageData: newPageImageData,
            renderedPages: newRenderedPages,
        };
    }),

    getPageImageData: (pageNumber) => {
        return get().pageImageData.get(pageNumber) || null;
    },

    setPdfBuffer: (buffer) => set({ pdfBuffer: buffer }),

    clearPageCache: () => set({
        pageImageData: new Map(),
        renderedPages: new Set(),
    }),

    // ============================================
    // REDACTION ACTIONS
    // ============================================

    addRedaction: (redaction) => set((state) => ({
        document: state.document
            ? {
                  ...state.document,
                  redactions: [...state.document.redactions, {
                      ...redaction,
                      createdAt: redaction.createdAt || Date.now(),
                      userId: redaction.userId || state.collaboration.currentUserId || undefined,
                  }],
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
                      r.id === id ? { ...r, ...updates, createdAt: Date.now() } : r
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

    clearPageRedactions: (pageIndex) => set((state) => ({
        document: state.document
            ? {
                  ...state.document,
                  redactions: state.document.redactions.filter((r) => r.pageIndex !== pageIndex),
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
        const currentPage = state.currentPage;
        
        // Auto-create redactions for PII matches on the current page
        const autoRedactions: RedactionArea[] = matches.map((match, index) => {
            const region = state.document?.textRegions[match.regionIndex];
            return {
                id: `pii-page${currentPage}-${index}`,
                x: region?.x ?? 0,
                y: region?.y ?? 0,
                width: region?.width ?? 100,
                height: region?.height ?? 20,
                pageIndex: currentPage,
                type: 'auto' as const,
                piiType: match.piiType,
                confidence: match.confidence,
                createdAt: Date.now(),
                userId: 'system',
            };
        });

        // Remove existing auto redactions for this page and add new ones
        const existingManualRedactions = state.document?.redactions.filter(r => r.type !== 'auto') ?? [];
        const existingAutoRedactionsOtherPages = state.document?.redactions.filter(
            r => r.type === 'auto' && r.pageIndex !== currentPage
        ) ?? [];

        return {
            document: state.document
                ? {
                      ...state.document,
                      piiMatches: matches,
                      redactions: [
                          ...existingManualRedactions,
                          ...existingAutoRedactionsOtherPages,
                          ...autoRedactions,
                      ],
                  }
                : null,
        };
    }),

    setPagePiiMatches: (pageIndex, matches) => set((state) => {
        // Auto-create redactions for PII matches on the specified page
        const autoRedactions: RedactionArea[] = matches.map((match, index) => {
            const region = state.document?.textRegions[match.regionIndex];
            return {
                id: `pii-page${pageIndex}-${index}`,
                x: region?.x ?? 0,
                y: region?.y ?? 0,
                width: region?.width ?? 100,
                height: region?.height ?? 20,
                pageIndex: pageIndex,
                type: 'auto' as const,
                piiType: match.piiType,
                confidence: match.confidence,
                createdAt: Date.now(),
                userId: 'system',
            };
        });

        // Remove existing auto redactions for this page and add new ones
        const existingManualRedactions = state.document?.redactions.filter(r => r.type !== 'auto') ?? [];
        const existingAutoRedactionsOtherPages = state.document?.redactions.filter(
            r => r.type === 'auto' && r.pageIndex !== pageIndex
        ) ?? [];

        return {
            document: state.document
                ? {
                      ...state.document,
                      redactions: [
                          ...existingManualRedactions,
                          ...existingAutoRedactionsOtherPages,
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

    setCurrentPage: (page) => set((state) => {
        // Get the image data for the new page if it exists
        const pageData = state.pageImageData.get(page);
        
        return {
            currentPage: page,
            imageData: pageData || state.imageData,
        };
    }),

    setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),

    toggleRedactionPreview: () => set((state) => ({
        showRedactionPreview: !state.showRedactionPreview,
    })),

    // ============================================
    // COLLABORATION ACTIONS
    // ============================================

    setConnectionState: (connectionState) => set((state) => ({
        collaboration: { ...state.collaboration, connectionState },
    })),

    setRoomId: (roomId) => set((state) => ({
        collaboration: { ...state.collaboration, roomId },
    })),

    setCurrentUserId: (userId) => set((state) => ({
        collaboration: { ...state.collaboration, currentUserId: userId },
    })),

    setCollaborators: (collaborators) => set((state) => ({
        collaboration: { ...state.collaboration, collaborators },
    })),

    addCollaborator: (collaborator) => set((state) => {
        // Avoid duplicates
        if (state.collaboration.collaborators.some(c => c.id === collaborator.id)) {
            return state;
        }
        return {
            collaboration: {
                ...state.collaboration,
                collaborators: [...state.collaboration.collaborators, collaborator],
            },
        };
    }),

    removeCollaborator: (userId) => set((state) => ({
        collaboration: {
            ...state.collaboration,
            collaborators: state.collaboration.collaborators.filter(c => c.id !== userId),
            cursors: state.collaboration.cursors.filter(c => c.userId !== userId),
        },
    })),

    updateCursor: (cursor) => set((state) => {
        const existingIndex = state.collaboration.cursors.findIndex(
            c => c.userId === cursor.userId
        );
        
        if (existingIndex >= 0) {
            const updatedCursors = [...state.collaboration.cursors];
            updatedCursors[existingIndex] = cursor;
            return {
                collaboration: { ...state.collaboration, cursors: updatedCursors },
            };
        }
        
        return {
            collaboration: {
                ...state.collaboration,
                cursors: [...state.collaboration.cursors, cursor],
            },
        };
    }),

    removeCursor: (userId) => set((state) => ({
        collaboration: {
            ...state.collaboration,
            cursors: state.collaboration.cursors.filter(c => c.userId !== userId),
        },
    })),

    setCollabEnabled: (enabled) => set((state) => ({
        collaboration: { ...state.collaboration, isCollabEnabled: enabled },
    })),

    // ============================================
    // REMOTE REDACTION SYNC (LAST-WRITE-WINS)
    // ============================================

    mergeRemoteRedactions: (remoteBoxes, remoteUserId) => set((state) => {
        if (!state.document) return state;

        const currentUserId = state.collaboration.currentUserId || 'local';

        // Convert RedactionArea[] to RedactionBox[] for the merge function
        const localBoxes: RedactionBox[] = state.document.redactions.map(r => ({
            id: r.id,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            type: r.type,
            pageIndex: r.pageIndex,
            piiType: r.piiType,
            confidence: r.confidence,
            createdAt: r.createdAt || Date.now(),
        }));

        // Merge with last-write-wins conflict resolution
        const merged = mergeRedactions(
            localBoxes,
            remoteBoxes,
            currentUserId
        );

        // Convert back to RedactionArea[]
        const mergedAreas: RedactionArea[] = merged.map(box => ({
            id: box.id,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            pageIndex: box.pageIndex,
            type: box.type,
            piiType: box.piiType,
            confidence: box.confidence,
            createdAt: box.createdAt,
        }));

        console.log('[DocumentStore] Merged remote redactions from:', remoteUserId, 
            'Local:', state.document.redactions.length, 
            'Remote:', remoteBoxes.length, 
            'Merged:', mergedAreas.length);

        return {
            document: {
                ...state.document,
                redactions: mergedAreas,
            },
        };
    }),

    replaceRedactions: (redactions) => set((state) => ({
        document: state.document
            ? { ...state.document, redactions }
            : null,
    })),

    // ============================================
    // FINALIZED DOCUMENT ACTIONS
    // ============================================

    setFinalizedDocument: (doc) => set({ finalizedDocument: doc }),

    clearFinalizedDocument: () => set({ finalizedDocument: null }),

    // ============================================
    // RESET ACTIONS
    // ============================================

    clearDocument: () => set({
        document: null,
        imageData: null,
        currentBuffer: null,
        previewBuffer: null,
        finalizedDocument: null,
        pageImageData: new Map(),
        pdfBuffer: null,
        renderedPages: new Set(),
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
export const selectCurrentPageRedactions = (state: DocumentState) => 
    state.document?.redactions.filter(r => r.pageIndex === state.currentPage) ?? [];
export const selectProcessing = (state: DocumentState) => state.processing;
export const selectIsProcessing = (state: DocumentState) => 
    state.processing.stage !== 'idle' && state.processing.stage !== 'error';
export const selectWasmStatus = (state: DocumentState) => ({
    ready: state.wasmReady,
    error: state.wasmError,
});
export const selectCollaboration = (state: DocumentState) => state.collaboration;
export const selectCollaborators = (state: DocumentState) => state.collaboration.collaborators;
export const selectCursors = (state: DocumentState) => state.collaboration.cursors;
export const selectIsConnected = (state: DocumentState) => 
    state.collaboration.connectionState === 'connected';
export const selectCurrentPage = (state: DocumentState) => state.currentPage;
export const selectPageCount = (state: DocumentState) => state.document?.pageCount ?? 1;
export const selectPageInfo = (state: DocumentState, pageNumber: number) => 
    state.document?.pages.find(p => p.pageNumber === pageNumber);
export const selectFinalizedDocument = (state: DocumentState) => state.finalizedDocument;
