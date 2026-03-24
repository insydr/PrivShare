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
import { DocumentViewer } from './components';
import { useWasmProcessor } from './hooks';
import { useDocumentStore } from './store/documentStore';
import type { Box } from './types';
import './styles/index.css';

function App() {
    const {
        isReady,
        loadingState,
        error: wasmError,
        moduleInfo,
        loadImage,
        redactMultiple,
        getHash,
    } = useWasmProcessor({ autoInit: true, debug: true });

    const {
        document,
        imageData,
        currentBuffer,
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
            setCurrentBuffer(await file.arrayBuffer());

            setProcessing({ stage: 'idle', progress: 100, message: 'Ready' });

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
    // EXPORT HANDLER
    // ============================================

    const handleExport = useCallback(async () => {
        if (!currentBuffer || !document) return;

        const redactions = document.redactions;
        if (redactions.length === 0) {
            alert('No redactions to apply. Draw redaction boxes first.');
            return;
        }

        setProcessing({ stage: 'redacting', progress: 50, message: 'Applying redactions...' });

        try {
            // Convert redactions to Box format
            const boxes: Box[] = redactions.map(r => ({
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                pageIndex: r.pageIndex,
            }));

            // Apply redactions via WASM
            const result = await redactMultiple(currentBuffer, boxes);
            
            // Get hash of redacted file
            const redactedHash = await getHash(result.pngBuffer);

            console.log('[App] Redactions applied:', result.redactedPixels, 'pixels burned');
            console.log('[App] Redacted hash:', redactedHash);

            // Download the redacted file
            const blob = new Blob([result.pngBuffer], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = document.name.replace(/\.[^.]+$/, '_redacted.png');
            link.click();
            URL.revokeObjectURL(url);

            setProcessing({ stage: 'idle', progress: 100, message: 'Export complete!' });

            // Update document with redacted hash
            setDocument({
                ...document,
                redactedHash,
            });

        } catch (error) {
            console.error('[App] Failed to export:', error);
            setProcessing({ 
                stage: 'error', 
                progress: 0, 
                message: error instanceof Error ? error.message : 'Failed to export' 
            });
        }
    }, [currentBuffer, document, redactMultiple, getHash, setProcessing, setDocument]);

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
                    // Document Viewer (when document loaded)
                    <div className="editor-container">
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
                                <span className="doc-hash" title={`SHA-256: ${document?.originalHash}`}>
                                    Hash: {document?.originalHash?.substring(0, 12)}...
                                </span>
                            </div>
                            
                            <button 
                                className="action-btn primary"
                                onClick={handleExport}
                                disabled={!document?.redactions?.length || processing.stage === 'redacting'}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                                {processing.stage === 'redacting' ? 'Processing...' : 'Apply & Export'}
                            </button>
                        </div>
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
