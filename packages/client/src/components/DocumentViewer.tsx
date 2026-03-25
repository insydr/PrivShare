/**
 * DocumentViewer Component
 * ========================
 * 
 * Dual-layer canvas system for document viewing and redaction:
 * - Layer 1 (Bottom): Renders the original/burned image/document
 * - Layer 2 (Top): Transparent canvas for drawing redaction rectangles
 * 
 * Features:
 * - Responsive resizing with aspect ratio preservation
 * - Mouse event handlers for drawing redaction boxes
 * - WASM-powered redaction processing (non-blocking via Web Worker)
 * - Download functionality for redacted documents
 * - Real-time collaboration with cursor sync and redaction sync
 */

import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
    useMemo,
} from 'react';
import type { Point, Rect, RedactionBox, RedactionTool } from '../types/canvas';
import { generateRedactionId, pointInRect } from '../types/canvas';
import type { Box } from '../types/wasm-worker';
import type { SyncedRedactionBox } from '../types/collaboration';
import { useDocumentStore } from '../store/documentStore';
import { useWasmProcessor } from '../hooks/useWasmProcessor';
import { CollaboratorCursors, CollaboratorList } from './CollaboratorCursors';
import './DocumentViewer.css';

// ============================================
// COMPONENT PROPS
// ============================================

interface DocumentViewerProps {
    className?: string;
    enableCollaboration?: boolean;
    roomId?: string;
}

// ============================================
// DEFAULT VALUES
// ============================================

const DEFAULT_HIGHLIGHT_COLOR = '#FFD700'; // Gold for auto-detected
const DEFAULT_MANUAL_COLOR = '#FF0000';    // Red for manual
const SELECTED_COLOR = '#00FF00';          // Green for selected
const REDACTION_OPACITY = 0.4;
const MIN_BOX_SIZE = 5; // Minimum box size in pixels
const CURSOR_SYNC_THROTTLE = 50; // ms between cursor syncs

// ============================================
// DOCUMENT VIEWER COMPONENT
// ============================================

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ 
    className = '',
    enableCollaboration = false,
}) => {
    // ============================================
    // STATE FROM STORE
    // ============================================

    const {
        document: doc,
        imageData,
        currentBuffer,
        processing,
        zoom,
        selectedRedaction,
        collaboration,
        setZoom,
        addRedaction,
        removeRedaction,
        setSelectedRedaction,
        setProcessing,
        clearDocument,
        mergeRemoteRedactions,
    } = useDocumentStore();

    // ============================================
    // WASM PROCESSOR HOOK
    // ============================================

    const {
        isReady: wasmReady,
        redactMultiple,
        getHash,
    } = useWasmProcessor({ autoInit: true, debug: true });

    // ============================================
    // LOCAL STATE
    // ============================================

    const [currentTool, setCurrentTool] = useState<RedactionTool>('draw');
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState<Point | null>(null);
    const [currentRect, setCurrentRect] = useState<Rect | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [scale, setScale] = useState(1);
    const [isProcessed, setIsProcessed] = useState(false);
    const [redactedBuffer, setRedactedBuffer] = useState<ArrayBuffer | null>(null);
    const [isFinalized, setIsFinalized] = useState(false);

    // ============================================
    // REFS
    // ============================================

    const containerRef = useRef<HTMLDivElement>(null);
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const lastCursorSyncRef = useRef<number>(0);

    // ============================================
    // DERIVED VALUES
    // ============================================

    const redactionBoxes = useMemo(() => doc?.redactions ?? [], [doc?.redactions]);
    const hasDocument = imageData !== null;
    const isProcessing = processing.stage !== 'idle' && processing.stage !== 'error';
    const isConnected = collaboration.connectionState === 'connected';
    const currentUserId = collaboration.currentUserId;

    // ============================================
    // COLLABORATION: HANDLE REMOTE REDACTION SYNC
    // ============================================

    useEffect(() => {
        if (!enableCollaboration) return;

        const handleRemoteSync = (event: CustomEvent<{ boxes: SyncedRedactionBox[]; userId: string }>) => {
            const { boxes, userId } = event.detail;
            
            // Don't merge if this is from us
            if (userId === currentUserId) return;
            
            console.log('[DocumentViewer] Received remote redactions from:', userId);
            mergeRemoteRedactions(boxes, userId);
        };

        window.addEventListener('collaboration:redaction-sync', handleRemoteSync as EventListener);

        return () => {
            window.removeEventListener('collaboration:redaction-sync', handleRemoteSync as EventListener);
        };
    }, [enableCollaboration, currentUserId, mergeRemoteRedactions]);

    // ============================================
    // CANVAS SETUP & RESIZE
    // ============================================

    /**
     * Calculate canvas dimensions to fit container while maintaining aspect ratio
     */
    const calculateCanvasDimensions = useCallback(() => {
        if (!containerRef.current || !imageData) return;

        const container = containerRef.current;
        const containerWidth = container.clientWidth - 40;
        const containerHeight = container.clientHeight - 40;

        const imageAspect = imageData.width / imageData.height;
        const containerAspect = containerWidth / containerHeight;

        let canvasWidth: number;
        let canvasHeight: number;

        if (imageAspect > containerAspect) {
            canvasWidth = containerWidth;
            canvasHeight = containerWidth / imageAspect;
        } else {
            canvasHeight = containerHeight;
            canvasWidth = containerHeight * imageAspect;
        }

        const newScale = canvasWidth / imageData.width;

        setCanvasSize({ width: canvasWidth, height: canvasHeight });
        setScale(newScale);
    }, [imageData]);

    /**
     * Resize observer for responsive canvas
     */
    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver(() => {
            calculateCanvasDimensions();
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [calculateCanvasDimensions]);

    /**
     * Update canvas dimensions when image data changes
     */
    useEffect(() => {
        if (imageData) {
            calculateCanvasDimensions();
        }
    }, [imageData, calculateCanvasDimensions]);

    // ============================================
    // IMAGE RENDERING (LAYER 1)
    // ============================================

    /**
     * Render the document image on the bottom canvas layer
     */
    useEffect(() => {
        const canvas = imageCanvasRef.current;
        if (!canvas || !imageData) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;

        // Clear and draw image
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Create temporary canvas for ImageData scaling
        const tempCanvas = window.document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCtx.putImageData(imageData, 0, 0);

        // Draw scaled image
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);

    }, [imageData, canvasSize]);

    // ============================================
    // RENDER BURNED IMAGE FROM WASM
    // ============================================

    /**
     * Render burned/redacted image after WASM processing
     */
    useEffect(() => {
        if (!redactedBuffer || !imageCanvasRef.current) return;

        const canvas = imageCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Create image from redacted PNG buffer
        const blob = new Blob([redactedBuffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            // Clear and draw redacted image
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
        };

        img.src = url;

    }, [redactedBuffer, canvasSize]);

    // ============================================
    // OVERLAY RENDERING (LAYER 2)
    // ============================================

    /**
     * Render redaction boxes and preview on the overlay canvas
     */
    useEffect(() => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size
        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;

        // Clear overlay
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Don't show overlay boxes if already processed/finalized
        if (isProcessed || isFinalized) return;

        // Draw existing redaction boxes
        redactionBoxes.forEach((box) => {
            const scaledRect = {
                x: box.x * scale,
                y: box.y * scale,
                width: box.width * scale,
                height: box.height * scale,
            };

            const isSelected = box.id === selectedRedaction;
            const color = isSelected
                ? SELECTED_COLOR
                : box.type === 'auto'
                    ? DEFAULT_HIGHLIGHT_COLOR
                    : DEFAULT_MANUAL_COLOR;

            // Fill with semi-transparent color
            ctx.fillStyle = color;
            ctx.globalAlpha = REDACTION_OPACITY;
            ctx.fillRect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height);

            // Draw border
            ctx.globalAlpha = 1;
            ctx.strokeStyle = color;
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.setLineDash(isSelected ? [] : [5, 5]);
            ctx.strokeRect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height);
            ctx.setLineDash([]);

            // Show collaborator indicator if box is from another user
            if (box.userId && box.userId !== currentUserId) {
                ctx.fillStyle = '#3b82f6';
                ctx.globalAlpha = 1;
                ctx.beginPath();
                ctx.arc(scaledRect.x + scaledRect.width - 5, scaledRect.y + 5, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Draw current drawing preview
        if (isDrawing && currentRect) {
            const scaledRect = {
                x: currentRect.x * scale,
                y: currentRect.y * scale,
                width: currentRect.width * scale,
                height: currentRect.height * scale,
            };

            ctx.fillStyle = DEFAULT_MANUAL_COLOR;
            ctx.globalAlpha = REDACTION_OPACITY;
            ctx.fillRect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height);

            ctx.globalAlpha = 1;
            ctx.strokeStyle = DEFAULT_MANUAL_COLOR;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(scaledRect.x, scaledRect.y, scaledRect.width, scaledRect.height);
            ctx.setLineDash([]);
        }

    }, [redactionBoxes, currentRect, isDrawing, scale, canvasSize, selectedRedaction, isProcessed, isFinalized, currentUserId]);

    // ============================================
    // MOUSE EVENT HANDLERS
    // ============================================

    /**
     * Get canvas-relative coordinates from mouse event
     */
    const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Point => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / scale,
            y: (e.clientY - rect.top) / scale,
        };
    }, [scale]);

    /**
     * Handle mouse down - start drawing or select existing box
     */
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!hasDocument || isProcessed || isProcessing || isFinalized) return;

        const point = getCanvasCoordinates(e);

        if (currentTool === 'select' || currentTool === 'erase') {
            const clickedBox = [...redactionBoxes].reverse().find((box) =>
                pointInRect(point, {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                })
            );

            if (clickedBox) {
                if (currentTool === 'erase') {
                    removeRedaction(clickedBox.id);
                } else {
                    setSelectedRedaction(clickedBox.id);
                }
            } else {
                setSelectedRedaction(null);
            }
        } else if (currentTool === 'draw') {
            setIsDrawing(true);
            setDrawStart(point);
            setCurrentRect({ x: point.x, y: point.y, width: 0, height: 0 });
            setSelectedRedaction(null);
        }
    }, [hasDocument, isProcessed, isProcessing, isFinalized, getCanvasCoordinates, currentTool, redactionBoxes, removeRedaction, setSelectedRedaction]);

    /**
     * Handle mouse move - update drawing preview and sync cursor
     */
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        // Sync cursor position for collaboration
        if (enableCollaboration && isConnected) {
            const now = Date.now();
            if (now - lastCursorSyncRef.current >= CURSOR_SYNC_THROTTLE) {
                lastCursorSyncRef.current = now;
                const point = getCanvasCoordinates(e);
                // Cursor sync is handled by the hook via custom event
                window.dispatchEvent(new CustomEvent('canvas:cursor-move', {
                    detail: { x: point.x, y: point.y },
                }));
            }
        }

        // Update drawing preview
        if (!isDrawing || !drawStart) return;

        const point = getCanvasCoordinates(e);

        const x = Math.min(drawStart.x, point.x);
        const y = Math.min(drawStart.y, point.y);
        const width = Math.abs(point.x - drawStart.x);
        const height = Math.abs(point.y - drawStart.y);

        setCurrentRect({ x, y, width, height });
    }, [enableCollaboration, isConnected, isDrawing, drawStart, getCanvasCoordinates]);

    /**
     * Handle mouse up - finalize redaction box
     */
    const handleMouseUp = useCallback(() => {
        if (!isDrawing || !currentRect) {
            setIsDrawing(false);
            setDrawStart(null);
            setCurrentRect(null);
            return;
        }

        if (currentRect.width >= MIN_BOX_SIZE && currentRect.height >= MIN_BOX_SIZE) {
            const newBox: RedactionBox = {
                id: generateRedactionId(),
                x: Math.round(currentRect.x),
                y: Math.round(currentRect.y),
                width: Math.round(currentRect.width),
                height: Math.round(currentRect.height),
                type: 'manual',
                pageIndex: 0,
                createdAt: Date.now(),
            };

            addRedaction(newBox);
            console.log('[DocumentViewer] Created redaction:', newBox);

            // Sync to collaborators if enabled
            if (enableCollaboration && isConnected) {
                const syncedBox: SyncedRedactionBox = {
                    ...newBox,
                    userId: currentUserId || 'local',
                    timestamp: Date.now(),
                };
                window.dispatchEvent(new CustomEvent('canvas:redaction-add', {
                    detail: { box: syncedBox },
                }));
            }
        }

        setIsDrawing(false);
        setDrawStart(null);
        setCurrentRect(null);
    }, [isDrawing, currentRect, addRedaction, enableCollaboration, isConnected, currentUserId]);

    /**
     * Handle mouse leave - cancel drawing
     */
    const handleMouseLeave = useCallback(() => {
        if (isDrawing) {
            setIsDrawing(false);
            setDrawStart(null);
            setCurrentRect(null);
        }
    }, [isDrawing]);

    // ============================================
    // WASM PROCESSING - FINALIZE BUTTON
    // ============================================

    /**
     * Finalize redactions - send to WASM worker (only triggered by button click)
     */
    const handleFinalize = useCallback(async () => {
        if (!currentBuffer || !document || !wasmReady) {
            console.error('[DocumentViewer] Cannot finalize: missing buffer or WASM not ready');
            return;
        }

        if (redactionBoxes.length === 0) {
            alert('No redactions to apply. Draw redaction boxes first.');
            return;
        }

        setProcessing({ stage: 'redacting', progress: 0, message: 'Preparing redactions...' });

        try {
            console.log('[DocumentViewer] Finalizing', redactionBoxes.length, 'redactions...');

            // Convert redaction boxes to Box format for WASM
            const boxes: Box[] = redactionBoxes.map((r) => ({
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                pageIndex: r.pageIndex,
            }));

            setProcessing({ stage: 'redacting', progress: 30, message: 'Burning redactions...' });

            // Call WASM worker to apply redactions (non-blocking)
            const result = await redactMultiple(currentBuffer, boxes);

            setProcessing({ stage: 'redacting', progress: 70, message: 'Generating hash...' });

            // Get hash of redacted file for audit trail
            const redactedHash = await getHash(result.pngBuffer);

            setProcessing({ stage: 'redacting', progress: 90, message: 'Finalizing...' });

            // Update state with redacted image
            setRedactedBuffer(result.pngBuffer);
            setIsProcessed(true);
            setIsFinalized(true);

            // Update document with redacted hash
            if (doc) {
                doc.redactedHash = redactedHash;
            }

            console.log('[DocumentViewer] Finalization complete!');
            console.log('[DocumentViewer] Pixels burned:', result.redactedPixels);
            console.log('[DocumentViewer] Redacted hash:', redactedHash);

            setProcessing({ stage: 'idle', progress: 100, message: 'Finalized!' });

            // Clear processing state after a delay
            setTimeout(() => {
                setProcessing({ stage: 'idle', progress: 0, message: '' });
            }, 2000);

        } catch (error) {
            console.error('[DocumentViewer] Finalization failed:', error);
            setProcessing({
                stage: 'error',
                progress: 0,
                message: error instanceof Error ? error.message : 'Finalization failed',
            });
        }
    }, [currentBuffer, doc, wasmReady, redactionBoxes, redactMultiple, getHash, setProcessing]);

    // ============================================
    // DOWNLOAD FUNCTIONALITY
    // ============================================

    /**
     * Download the redacted document
     */
    const handleDownload = useCallback(() => {
        // Use redacted buffer if available, otherwise original
        const bufferToDownload = redactedBuffer || currentBuffer;
        if (!bufferToDownload) {
            console.error('[DocumentViewer] No buffer to download');
            return;
        }
        const isRedacted = !!redactedBuffer;

        // Create blob from buffer
        const blob = new Blob([bufferToDownload], { type: 'image/png' });
        const url = URL.createObjectURL(blob);

        // Generate filename
        const originalName = doc?.name || 'document';
        const baseName = originalName.replace(/\.[^.]+$/, '');
        const fileName = isRedacted 
            ? `${baseName}_redacted.png`
            : `${baseName}_original.png`;

        // Trigger download
        const link = window.document.createElement('a');
        link.href = url;
        link.download = fileName;
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);

        // Cleanup
        URL.revokeObjectURL(url);

        console.log('[DocumentViewer] Downloaded:', fileName);
    }, [redactedBuffer, currentBuffer, doc]);

    /**
     * Download audit report (hashes)
     */
    const handleDownloadAudit = useCallback(() => {
        if (!doc) return;

        const auditInfo = {
            fileName: doc.name,
            originalHash: doc.originalHash,
            redactedHash: doc.redactedHash,
            redactionCount: doc.redactions.length,
            processedAt: new Date().toISOString(),
            redactions: doc.redactions.map((r) => ({
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                type: r.type,
            })),
        };

        const blob = new Blob([JSON.stringify(auditInfo, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = window.document.createElement('a');
        link.href = url;
        link.download = `${doc.name.replace(/\.[^.]+$/, '')}_audit.json`;
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);

        URL.revokeObjectURL(url);
        console.log('[DocumentViewer] Audit report downloaded');
    }, [doc]);

    // ============================================
    // RESET FUNCTIONALITY
    // ============================================

    /**
     * Reset to original document (undo finalization)
     */
    const handleReset = useCallback(() => {
        if (!confirm('Reset to original document? This will clear all redactions.')) {
            return;
        }
        
        setIsProcessed(false);
        setRedactedBuffer(null);
        setIsFinalized(false);
        clearDocument();
    }, [clearDocument]);

    // ============================================
    // KEYBOARD SHORTCUTS
    // ============================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRedaction) {
                removeRedaction(selectedRedaction);
                setSelectedRedaction(null);
            }

            if (e.key === 'd' || e.key === 'D') setCurrentTool('draw');
            if (e.key === 's' || e.key === 'S') setCurrentTool('select');
            if (e.key === 'e' || e.key === 'E') setCurrentTool('erase');

            if (e.key === '+' || e.key === '=') {
                setZoom(Math.min(zoom + 0.1, 3));
            }
            if (e.key === '-') {
                setZoom(Math.max(zoom - 0.1, 0.1));
            }

            // Ctrl+Enter to finalize
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (hasDocument && !isFinalized && redactionBoxes.length > 0) {
                    handleFinalize();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedRedaction, removeRedaction, setSelectedRedaction, zoom, setZoom, hasDocument, isFinalized, redactionBoxes.length, handleFinalize]);

    // ============================================
    // TOOLBAR ACTIONS
    // ============================================

    const handleClearAll = useCallback(() => {
        if (confirm('Clear all redactions?')) {
            redactionBoxes.forEach((box) => removeRedaction(box.id));
        }
    }, [redactionBoxes, removeRedaction]);

    const handleZoomIn = useCallback(() => {
        setZoom(Math.min(zoom + 0.2, 3));
    }, [zoom, setZoom]);

    const handleZoomOut = useCallback(() => {
        setZoom(Math.max(zoom - 0.2, 0.1));
    }, [zoom, setZoom]);

    const handleFitToScreen = useCallback(() => {
        setZoom(1);
        calculateCanvasDimensions();
    }, [setZoom, calculateCanvasDimensions]);

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className={`document-viewer ${className}`}>
            {/* Toolbar */}
            <div className="viewer-toolbar">
                <div className="tool-group">
                    <button
                        className={`tool-btn ${currentTool === 'draw' ? 'active' : ''}`}
                        onClick={() => setCurrentTool('draw')}
                        title="Draw Redaction (D)"
                        disabled={!hasDocument || isFinalized || isProcessing}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                        </svg>
                        <span>Draw</span>
                    </button>
                    <button
                        className={`tool-btn ${currentTool === 'select' ? 'active' : ''}`}
                        onClick={() => setCurrentTool('select')}
                        title="Select (S)"
                        disabled={!hasDocument || isFinalized || isProcessing}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                        </svg>
                        <span>Select</span>
                    </button>
                    <button
                        className={`tool-btn ${currentTool === 'erase' ? 'active' : ''}`}
                        onClick={() => setCurrentTool('erase')}
                        title="Erase (E)"
                        disabled={!hasDocument || isFinalized || isProcessing}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" />
                            <line x1="18" y1="9" x2="12" y2="15" />
                            <line x1="12" y1="9" x2="18" y2="15" />
                        </svg>
                        <span>Erase</span>
                    </button>
                </div>

                <div className="tool-separator" />

                <div className="tool-group">
                    <button
                        className="tool-btn"
                        onClick={handleZoomOut}
                        title="Zoom Out (-)"
                        disabled={!hasDocument}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                    </button>
                    <span className="zoom-level">{Math.round(zoom * 100)}%</span>
                    <button
                        className="tool-btn"
                        onClick={handleZoomIn}
                        title="Zoom In (+)"
                        disabled={!hasDocument}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                        </svg>
                    </button>
                    <button
                        className="tool-btn"
                        onClick={handleFitToScreen}
                        title="Fit to Screen"
                        disabled={!hasDocument}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                        </svg>
                    </button>
                </div>

                <div className="tool-separator" />

                {/* Finalize & Download Buttons */}
                <div className="tool-group action-buttons">
                    {!isFinalized ? (
                        <button
                            className="tool-btn primary finalize-btn"
                            onClick={handleFinalize}
                            title="Finalize Redactions (Ctrl+Enter)"
                            disabled={!hasDocument || redactionBoxes.length === 0 || isProcessing || !wasmReady}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                            <span>Finalize</span>
                        </button>
                    ) : (
                        <button
                            className="tool-btn success"
                            onClick={handleReset}
                            title="Reset to Original"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                            <span>Reset</span>
                        </button>
                    )}

                    <button
                        className="tool-btn download"
                        onClick={handleDownload}
                        title="Download Document"
                        disabled={!hasDocument}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>{isFinalized ? 'Download' : 'Download Original'}</span>
                    </button>

                    {isFinalized && (
                        <button
                            className="tool-btn audit"
                            onClick={handleDownloadAudit}
                            title="Download Audit Report"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                            </svg>
                            <span>Audit</span>
                        </button>
                    )}
                </div>

                <div className="tool-separator" />

                <div className="tool-group">
                    <button
                        className="tool-btn danger"
                        onClick={handleClearAll}
                        title="Clear All Redactions"
                        disabled={redactionBoxes.length === 0 || isFinalized}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        <span>Clear</span>
                    </button>
                </div>

                <div className="toolbar-info">
                    {wasmReady && (
                        <span className="wasm-status ready">WASM Ready</span>
                    )}
                    {!wasmReady && (
                        <span className="wasm-status loading">Loading WASM...</span>
                    )}
                    {redactionBoxes.length > 0 && !isFinalized && (
                        <span className="redaction-count">
                            {redactionBoxes.length} redaction{redactionBoxes.length !== 1 ? 's' : ''}
                        </span>
                    )}
                    {isFinalized && (
                        <span className="finalized-badge">
                            ✓ Finalized
                        </span>
                    )}
                    {enableCollaboration && isConnected && (
                        <span className="collab-status connected">
                            {collaboration.collaborators.length + 1} users
                        </span>
                    )}
                </div>
            </div>

            {/* Canvas Container */}
            <div className="canvas-container" ref={containerRef}>
                {!hasDocument ? (
                    <div className="no-document">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <p>No document loaded</p>
                        <span>Drag and drop a file to begin</span>
                    </div>
                ) : (
                    <div
                        className="canvas-wrapper"
                        style={{
                            width: canvasSize.width,
                            height: canvasSize.height,
                        }}
                    >
                        {/* Layer 1: Image Canvas (Bottom) */}
                        <canvas
                            ref={imageCanvasRef}
                            className="image-canvas"
                            width={canvasSize.width}
                            height={canvasSize.height}
                        />

                        {/* Layer 2: Overlay Canvas (Top, Transparent) */}
                        <canvas
                            ref={overlayCanvasRef}
                            className="overlay-canvas"
                            width={canvasSize.width}
                            height={canvasSize.height}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseLeave}
                            style={{
                                cursor: isProcessing ? 'wait' :
                                        isFinalized ? 'default' :
                                        currentTool === 'draw' ? 'crosshair' :
                                        currentTool === 'erase' ? 'not-allowed' : 'default',
                            }}
                        />

                        {/* Collaborator Cursors Overlay */}
                        {enableCollaboration && (
                            <CollaboratorCursors
                                cursors={collaboration.cursors}
                                currentUserId={currentUserId}
                                scale={scale}
                            />
                        )}

                        {/* Collaborator List */}
                        {enableCollaboration && isConnected && collaboration.collaborators.length > 0 && (
                            <CollaboratorList
                                collaborators={collaboration.collaborators}
                                currentUserId={currentUserId}
                            />
                        )}
                    </div>
                )}

                {/* Loading Spinner Overlay */}
                {isProcessing && (
                    <div className="processing-overlay">
                        <div className="processing-spinner">
                            <div className="spinner-ring"></div>
                            <div className="spinner-content">
                                <span className="spinner-text">{processing.message}</span>
                                {processing.progress > 0 && (
                                    <div className="progress-bar">
                                        <div 
                                            className="progress-fill" 
                                            style={{ width: `${processing.progress}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Status Bar */}
            {hasDocument && (
                <div className="status-bar">
                    <span className="file-info">
                        {doc?.name} • {doc?.width}×{doc?.height}px
                    </span>
                    {doc?.originalHash && (
                        <span className="hash-info" title={`SHA-256: ${doc.originalHash}`}>
                            Original: {doc.originalHash.substring(0, 12)}...
                        </span>
                    )}
                    {doc?.redactedHash && (
                        <span className="hash-info redacted" title={`SHA-256: ${doc.redactedHash}`}>
                            Redacted: {doc.redactedHash.substring(0, 12)}...
                        </span>
                    )}
                    {!isFinalized && currentTool === 'draw' && (
                        <span className="hint">Click and drag to draw redaction box</span>
                    )}
                    {isFinalized && (
                        <span className="hint success">Document finalized. Click Download to save.</span>
                    )}
                </div>
            )}
        </div>
    );
};

export default DocumentViewer;
