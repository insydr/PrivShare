import { create } from 'zustand';

/**
 * Document Store
 * 
 * Manages the state of the document being processed.
 * All data is stored locally in browser memory - never sent to a server.
 */

export interface RedactionArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
  type: 'auto' | 'manual';
  confidence?: number;
}

export interface Document {
  id: string;
  name: string;
  size: number;
  type: string;
  pageCount: number;
  redactions: RedactionArea[];
  originalHash: string;
  redactedHash?: string;
  processedAt?: Date;
}

interface DocumentState {
  document: Document | null;
  isProcessing: boolean;
  currentPage: number;
  zoom: number;
  
  // Actions
  setDocument: (doc: Document | null) => void;
  addRedaction: (redaction: RedactionArea) => void;
  removeRedaction: (id: string) => void;
  updateRedaction: (id: string, updates: Partial<RedactionArea>) => void;
  setCurrentPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  clearDocument: () => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  document: null,
  isProcessing: false,
  currentPage: 0,
  zoom: 1,
  
  setDocument: (doc) => set({ document: doc }),
  
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
  
  setCurrentPage: (page) => set({ currentPage: page }),
  setZoom: (zoom) => set({ zoom }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  clearDocument: () => set({ document: null, currentPage: 0, zoom: 1 }),
}));
