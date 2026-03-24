/**
 * DocumentViewer Component
 * ========================
 * 
 * Dual-layer canvas system for document viewing and redaction:
 * - Layer 1 (Bottom): Renders the original image/document
 * - Layer 2 (Top): Transparent canvas for drawing redaction rectangles
 * 
 * Features:
 * - Responsive resizing with aspect ratio preservation
 * - Mouse event handlers for drawing redaction boxes
 * - Zoom and pan support
 * - Selection and manipulation of existing redactions
 */

import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
    useMemo,
} from 'react';
import type { Point, Rect, RedactionBox, RedactionTool, CanvasMouseEvent } from '../types/canvas';
import { generateRedactionId, pointInRect } from '../types/canvas';
import { useDocumentStore } from '../store/documentStore';
import './DocumentViewer.css';

// ============================================
// COMPONENT PROPS
// ============================================

interface DocumentViewerProps {
    className?: string;
}

// ============================================
// DEFAULT VALUES
// ============================================

const DEFAULT_HIGHLIGHT_COLOR = '#FFD700'; // Gold for auto-detected
const DEFAULT_MANUAL_COLOR = '#FF0000';    // Red for manual
const SELECTED_COLOR = '#00FF00';          // Green for selected
const REDACTION_OPACITY = 0.4;
const MIN_BOX_SIZE = 5; // Minimum box size in pixels

// ============================================
// DOCUMENT VIEWER COMPONENT
// ============================================

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ className = '' }) => {
    // ============================================
    // STATE FROM STORE
    // ============================================

    const {
        document,
        imageData,
        currentBuffer,
        processing,
        zoom,
        showRedactionPreview,
        selectedRedaction,
        setZoom,
        addRedaction,
        removeRedaction,
        updateRedaction,
        setSelectedRedaction,
        setPreviewBuffer,
    } = useDocumentStore();

    // ============================================
    // LOCAL STATE
    // ============================================

    const [currentTool, setCurrentTool] = useState<RedactionTool>('draw');
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawStart, setDrawStart] = useState<Point | null>(null);
    const [currentRect, setCurrentRect] = useState<Rect | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [scale, setScale] = useState(1);

    // ============================================
    // REFS
    // ============================================

    const containerRef = useRef<HTMLDivElement>(null);
    const imageCanvasRef = useRef<HTMLCanvasElement>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

    // ============================================
    // DERIVED VALUES
    // ============================================

    const redactionBoxes = useMemo(() => document?.redactions ?? [], [document?.redactions]);

    const hasDocument = imageData !== null;

    // ============================================
    // CANVAS SETUP & RESIZE
    // ============================================

    /**
     * Calculate canvas dimensions to fit container while maintaining aspect ratio
     */
    const calculateCanvasDimensions = useCallback(() => {
        if (!containerRef.current || !imageData) return;

        const container = containerRef.current;
        const containerWidth = container.clientWidth - 40; // Padding
        const containerHeight = container.clientHeight - 40;

        const imageAspect = imageData.width / imageData.height;
        const containerAspect = containerWidth / containerHeight;

        let canvasWidth: number;
        let canvasHeight: number;

        if (imageAspect > containerAspect) {
            // Image is wider than container
            canvasWidth = containerWidth;
            canvasHeight = containerWidth / imageAspect;
        } else {
            // Image is taller than container
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
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCtx.putImageData(imageData, 0, 0);

        // Draw scaled image
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);

        // Store reference for preview
        imageRef.current = new Image();
        imageRef.current.src = tempCanvas.toDataURL();

    }, [imageData, canvasSize]);

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

    }, [redactionBoxes, currentRect, isDrawing, scale, canvasSize, selectedRedaction]);

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
        if (!hasDocument) return;

        const point = getCanvasCoordinates(e);

        if (currentTool === 'select' || currentTool === 'erase') {
            // Find clicked box (reverse order to get top-most first)
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
            // Start drawing new box
            setIsDrawing(true);
            setDrawStart(point);
            setCurrentRect({ x: point.x, y: point.y, width: 0, height: 0 });
            setSelectedRedaction(null);
        }
    }, [hasDocument, getCanvasCoordinates, currentTool, redactionBoxes, removeRedaction, setSelectedRedaction]);

    /**
     * Handle mouse move - update drawing preview
     */
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !drawStart) return;

        const point = getCanvasCoordinates(e);

        // Calculate rectangle (handle negative dimensions)
        const x = Math.min(drawStart.x, point.x);
        const y = Math.min(drawStart.y, point.y);
        const width = Math.abs(point.x - drawStart.x);
        const height = Math.abs(point.y - drawStart.y);

        setCurrentRect({ x, y, width, height });
    }, [isDrawing, drawStart, getCanvasCoordinates]);

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

        // Only create box if it meets minimum size
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
        }

        setIsDrawing(false);
        setDrawStart(null);
        setCurrentRect(null);
    }, [isDrawing, currentRect, addRedaction]);

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
    // KEYBOARD SHORTCUTS
    // ============================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Delete selected redaction
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRedaction) {
                removeRedaction(selectedRedaction);
                setSelectedRedaction(null);
            }

            // Tool shortcuts
            if (e.key === 'd' || e.key === 'D') setCurrentTool('draw');
            if (e.key === 's' || e.key === 'S') setCurrentTool('select');
            if (e.key === 'e' || e.key === 'E') setCurrentTool('erase');

            // Zoom shortcuts
            if (e.key === '+' || e.key === '=') {
                setZoom(Math.min(zoom + 0.1, 3));
            }
            if (e.key === '-') {
                setZoom(Math.max(zoom - 0.1, 0.1));
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedRedaction, removeRedaction, setSelectedRedaction, zoom, setZoom]);

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
                        disabled={!hasDocument}
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
                        disabled={!hasDocument}
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
                        disabled={!hasDocument}
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

                <div className="tool-group">
                    <button
                        className="tool-btn danger"
                        onClick={handleClearAll}
                        title="Clear All Redactions"
                        disabled={redactionBoxes.length === 0}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        <span>Clear All</span>
                    </button>
                </div>

                <div className="toolbar-info">
                    {redactionBoxes.length > 0 && (
                        <span className="redaction-count">
                            {redactionBoxes.length} redaction{redactionBoxes.length !== 1 ? 's' : ''}
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
                                cursor: currentTool === 'draw' ? 'crosshair' :
                                        currentTool === 'erase' ? 'not-allowed' : 'default',
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Status Bar */}
            {hasDocument && (
                <div className="status-bar">
                    <span className="file-info">
                        {document?.name} • {document?.width}×{document?.height}px
                    </span>
                    {processing.stage !== 'idle' && (
                        <span className="processing-status">
                            {processing.message}
                        </span>
                    )}
                    {currentTool === 'draw' && (
                        <span className="hint">Click and drag to draw redaction box</span>
                    )}
                    {currentTool === 'select' && (
                        <span className="hint">Click to select, Delete to remove</span>
                    )}
                    {currentTool === 'erase' && (
                        <span className="hint">Click on redaction to remove</span>
                    )}
                </div>
            )}
        </div>
    );
};

export default DocumentViewer;
