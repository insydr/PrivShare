/**
 * PrivShare Client Application
 * ============================
 *
 * Zero-Trust Document Redaction Platform
 * - All processing happens locally via WebAssembly
 * - Files never leave the client device
 * - Only metadata is shared for collaboration
 */

import { useState, useCallback, useEffect } from 'react';
import { DocumentViewer, AnalysisPanel } from './components';
import { useWasmProcessor } from './hooks';
import { useDocumentStore } from './store/documentStore';

import './styles/index.css';

function App() {
    const {
        isReady,
        loadingState,
        error: wasmError,
        moduleInfo,
        loadImage,
        // redactMultiple and getHash are used by DocumentViewer component
    } = useWasmProcessor({ autoInit: true, debug: true });

    const {
        document,
        imageData,
        processing,
        setDocument,
        setImageData,
        setCurrentBuffer,
        setProcessing,
        setWasmReady,
        setWasmError,
        clearDocument,
    } = useDocumentStore();

    const [isDragOver, setIsDragOver] = useState(false);
    const [showSidebar, setShowSidebar] = useState(true);

    // Update store when WASM is ready
    useEffect(() => {
        setWasmReady(isReady);
        if (wasmError) {
            setWasmError(wasmError);
        }
    }, [isReady, wasmError, setWasmReady, setWasmError]);

    // ============================================
    // FILE HANDLING
    // ============================================

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await handleFileSelect(files[0]);
        }
    }, []);

    const handleFileSelect = useCallback(async (file: File) => {
        if (!isReady) {
            console.error('[App] WASM not ready');
            return;
        }

        // Validate file type
        const validTypes = ['image/png', 'image/jpeg', 'image/tiff', 'image/bmp', 'image/webp'];
        if (!validTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
            alert('Invalid file type. Please use PNG, JPEG, TIFF, BMP, WebP, or PDF.');
            return;
        }

        // Validate file size (50MB max per PRD)
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('File too large. Maximum size is 50MB.');
            return;
        }

        setProcessing({ stage: 'loading', progress: 10, message: 'Reading file...' });

        try {
            console.log('[App] Processing file:', file.name);

            // Load image using WASM (runs in worker, non-blocking)
            setProcessing({ stage: 'processing', progress: 30, message: 'Processing with WASM...' });

            const result = await loadImage(file);

            console.log('[App] Image loaded:', result.dimensions);
            console.log('[App] Hash:', result.hash);

            // Create document record
            const doc = {
                id: `doc-${Date.now()}`,
                name: file.name,
                size: file.size,
                type: file.type,
                pageCount: 1,
                width: result.dimensions.width,
                height: result.dimensions.height,
                format: result.info.format,
                redactions: [],
                textRegions: [],
                piiMatches: [],
                originalHash: result.hash,
                processedAt: new Date(),
            };

            // Update store
            setDocument(doc);
            setImageData(result.imageData);

            // Store original buffer for later redaction
            const buffer = await file.arrayBuffer();
            setCurrentBuffer(buffer);

            setProcessing({ stage: 'idle', progress: 100, message: 'Ready' });

            // Show sidebar when document is loaded
            setShowSidebar(true);

            console.log('[App] Document ready for editing');
        } catch (error) {
            console.error('[App] Failed to process file:', error);
            setProcessing({
                stage: 'error',
                progress: 0,
                message: error instanceof Error ? error.message : 'Failed to process file'
            });
        }
    }, [isReady, loadImage, setDocument, setImageData, setCurrentBuffer, setProcessing]);

    // ============================================
    // FILE INPUT HANDLER
    // ============================================

    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleFileSelect(file);
        }
    }, [handleFileSelect]);

    // ============================================
    // CLEAR DOCUMENT
    // ============================================

    const handleClearDocument = useCallback(() => {
        if (document && document.redactions.length > 0) {
            if (!confirm('This will clear the current document and all redactions. Continue?')) {
                return;
            }
        }
        clearDocument();
    }, [document, clearDocument]);

    // ============================================
    // RENDER
    // ============================================

    return (
        <div className="app">
            {/* Header */}
            <header className="app-header">
                <div className="logo">
                    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                        <rect width="32" height="32" rx="8" fill="#4F46E5"/>
                        <path d="M8 16L14 22L24 10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <h1>PrivShare</h1>
                </div>
                <nav className="nav">
                    {moduleInfo && (
                        <span className="version">v{moduleInfo.version}</span>
                    )}
                    <span className={`badge ${isReady ? 'ready' : 'loading'}`}>
                        {loadingState === 'loading' && 'Loading WASM...'}
                        {loadingState === 'ready' && 'WASM Ready'}
                        {loadingState === 'error' && 'WASM Error'}
                        {loadingState === 'idle' && 'Initializing...'}
                    </span>
                    {imageData && (
                        <button
                            className="toggle-sidebar-btn"
                            onClick={() => setShowSidebar(!showSidebar)}
                            title={showSidebar ? 'Hide Analysis Panel' : 'Show Analysis Panel'}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <line x1="9" y1="3" x2="9" y2="21"/>
                            </svg>
                        </button>
                    )}
                </nav>
            </header>

            {/* Main Content */}
            <main className="main-content">
                {!imageData ? (
                    // Drop Zone (when no document)
                    <div
                        className={`drop-zone ${isDragOver ? 'active' : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        <div className="drop-zone-content">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="12" y1="18" x2="12" y2="12"/>
                                <line x1="9" y1="15" x2="15" y2="15"/>
                            </svg>
                            <h2>Drop your document here</h2>
                            <p>PNG, JPEG, TIFF, BMP, WebP files supported</p>
                            <p className="size-limit">Maximum file size: 50MB</p>

                            <div className="security-notice">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                                <span>Your file is processed locally and never uploaded to any server</span>
                            </div>

                            <input
                                type="file"
                                id="file-input"
                                accept=".png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp"
                                onChange={handleFileInputChange}
                                style={{ display: 'none' }}
                                disabled={!isReady}
                            />
                            <label htmlFor="file-input" className={`browse-button ${!isReady ? 'disabled' : ''}`}>
                                {isReady ? 'Browse Files' : 'Loading WASM...'}
                            </label>
                        </div>
                    </div>
                ) : (
                    // Document Editor (when document loaded)
                    <div className={`editor-container ${showSidebar ? 'with-sidebar' : ''}`}>
                        {/* Main Editor */}
                        <div className="editor-main">
                            <DocumentViewer />

                            {/* Action Bar */}
                            <div className="action-bar">
                                <button
                                    className="action-btn secondary"
                                    onClick={handleClearDocument}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                                    </svg>
                                    New Document
                                </button>

                                <div className="document-info">
                                    <span className="doc-name">{document?.name}</span>
                                    {document?.originalHash && (
                                        <span className="doc-hash" title={`SHA-256: ${document.originalHash}`}>
                                            Hash: {document.originalHash.substring(0, 12)}...
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Analysis Sidebar */}
                        {showSidebar && (
                            <div className="editor-sidebar">
                                <AnalysisPanel
                                    onAnalysisComplete={(result) => {
                                        console.log('[App] Analysis complete:', result.piiCount, 'PII items found');
                                    }}
                                />
                            </div>
                        )}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="app-footer">
                <p>
                    <strong>Privacy First:</strong> All document processing happens in your browser using WebAssembly.
                    Your files never leave your device.
                </p>
                {document && (
                    <p className="audit-info">
                        Original Hash: <code>{document.originalHash?.substring(0, 16)}...</code>
                        {document.redactedHash && (
                            <span> | Redacted Hash: <code>{document.redactedHash?.substring(0, 16)}...</code></span>
                        )}
                    </p>
                )}
            </footer>

            {/* Processing Overlay */}
            {processing.stage !== 'idle' && processing.stage !== 'error' && (
                <div className="processing-overlay">
                    <div className="processing-indicator">
                        <div className="spinner"></div>
                        <span>{processing.message}</span>
                        {processing.progress > 0 && (
                            <div className="progress-bar">
                                <div className="progress-fill" style={{ width: `${processing.progress}%` }}></div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
