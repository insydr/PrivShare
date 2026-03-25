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
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { DocumentViewer, AnalysisPanel } from './components';
import { useWasmProcessor, usePdfProcessor } from './hooks';
import { useDocumentStore } from './store/documentStore';
import { useAuthStore } from './store/authStore';
import { AuthModal } from './components/AuthModal';
import { UserMenu } from './components/UserMenu';
import { ShareModal } from './components/ShareModal';
import { JoinShare } from './components/JoinShare';

import './styles/index.css';

// Join Share Page Component
const JoinSharePage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const handleSuccess = () => {
    // After successfully accessing a share, navigate to home
    // The document data will be loaded into the store
    navigate('/');
  };

  if (!code) {
    return (
      <div className="error-page">
        <h2>Invalid Share Code</h2>
        <p>No share code provided in the URL.</p>
        <button onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  return <JoinShare code={code} onSuccess={handleSuccess} />;
};

function App() {
    const {
        isReady,
        loadingState,
        error: wasmError,
        moduleInfo,
        loadImage,
    } = useWasmProcessor({ autoInit: true, debug: true });

    const {
        loadPdf,
        renderPage,
        unloadPdf,
    } = usePdfProcessor({ renderScale: 1.5, debug: true });

    const {
        document,
        imageData,
        processing,
        finalizedDocument,
        setDocument,
        setImageData,
        setCurrentBuffer,
        setProcessing,
        setWasmReady,
        setWasmError,
        clearDocument,
        setCurrentPage,
    } = useDocumentStore();

    const { isAuthenticated } = useAuthStore();

    const [isDragOver, setIsDragOver] = useState(false);
    const [showSidebar, setShowSidebar] = useState(true);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareDocumentData, setShareDocumentData] = useState<{
        name: string;
        size: number;
        hash: string;
        encryptedKey: string;
        keyIv: string;
        thumbnailBase64?: string;
    } | null>(null);

    // Update store when WASM is ready
    useEffect(() => {
        setWasmReady(isReady);
        if (wasmError) {
            setWasmError(wasmError);
        }
    }, [isReady, wasmError, setWasmReady, setWasmError]);

    // Handle page changes for multi-page PDFs
    useEffect(() => {
        const handlePageChange = async (e: Event) => {
            const customEvent = e as CustomEvent<{ page: number }>;
            const { page } = customEvent.detail;

            if (!document?.isPdf) return;

            const { pageImageData } = useDocumentStore.getState();
            if (pageImageData.has(page)) {
                return;
            }

            console.log('[App] Rendering page', page + 1, 'on demand');
            setProcessing({ stage: 'rendering', progress: 0, message: `Rendering page ${page + 1}...` });

            const result = await renderPage(page + 1);

            if (result) {
                console.log('[App] Page', page + 1, 'rendered successfully');
            }

            setProcessing({ stage: 'idle', progress: 100, message: '' });
        };

        window.addEventListener('page:change', handlePageChange);

        return () => {
            window.removeEventListener('page:change', handlePageChange);
        };
    }, [document?.isPdf, renderPage, setProcessing]);

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

        const validImageTypes = ['image/png', 'image/jpeg', 'image/tiff', 'image/bmp', 'image/webp'];
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isValidImage = validImageTypes.includes(file.type);

        if (!isValidImage && !isPdf) {
            alert('Invalid file type. Please use PNG, JPEG, TIFF, BMP, WebP, or PDF.');
            return;
        }

        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('File too large. Maximum size is 50MB.');
            return;
        }

        setProcessing({ stage: 'loading', progress: 10, message: 'Reading file...' });

        try {
            console.log('[App] Processing file:', file.name, isPdf ? '(PDF)' : '(Image)');

            const buffer = await file.arrayBuffer();

            if (isPdf) {
                setProcessing({ stage: 'loading', progress: 20, message: 'Loading PDF document...' });

                const pdfInfo = await loadPdf(buffer);
                if (!pdfInfo) {
                    throw new Error('Failed to load PDF document');
                }

                console.log('[App] PDF loaded:', pdfInfo.pageCount, 'pages');

                setProcessing({ stage: 'rendering', progress: 50, message: 'Rendering first page...' });
                const firstPage = await renderPage(1);
                if (!firstPage) {
                    throw new Error('Failed to render first page');
                }

                const doc = {
                    id: `doc-${Date.now()}`,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    pageCount: pdfInfo.pageCount,
                    width: firstPage.width,
                    height: firstPage.height,
                    format: 'PDF',
                    pages: pdfInfo.pages.map((p, i) => ({
                        pageNumber: i + 1,
                        width: p.width,
                        height: p.height,
                        rotation: p.rotation,
                        scale: p.scale,
                    })),
                    redactions: [],
                    textRegions: [],
                    piiMatches: [],
                    originalHash: pdfInfo.fingerprint,
                    processedAt: new Date(),
                    isPdf: true,
                };

                setDocument(doc);
                setImageData(firstPage.imageData);
                setCurrentBuffer(buffer);
                setCurrentPage(0);

                setProcessing({ stage: 'idle', progress: 100, message: 'Ready' });

                console.log('[App] PDF document ready for editing');

            } else {
                setProcessing({ stage: 'processing', progress: 30, message: 'Processing with WASM...' });

                const result = await loadImage(file);

                console.log('[App] Image loaded:', result.dimensions);
                console.log('[App] Hash:', result.hash);

                const doc = {
                    id: `doc-${Date.now()}`,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    pageCount: 1,
                    width: result.dimensions.width,
                    height: result.dimensions.height,
                    format: result.info.format,
                    pages: [{
                        pageNumber: 1,
                        width: result.dimensions.width,
                        height: result.dimensions.height,
                        rotation: 0,
                        scale: 1,
                    }],
                    redactions: [],
                    textRegions: [],
                    piiMatches: [],
                    originalHash: result.hash,
                    processedAt: new Date(),
                    isPdf: false,
                };

                setDocument(doc);
                setImageData(result.imageData);
                setCurrentBuffer(buffer);

                setProcessing({ stage: 'idle', progress: 100, message: 'Ready' });

                console.log('[App] Document ready for editing');
            }

            setShowSidebar(true);

        } catch (error) {
            console.error('[App] Failed to process file:', error);
            setProcessing({
                stage: 'error',
                progress: 0,
                message: error instanceof Error ? error.message : 'Failed to process file'
            });
        }
    }, [isReady, loadImage, loadPdf, renderPage, setDocument, setImageData, setCurrentBuffer, setProcessing, setCurrentPage]);

    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleFileSelect(file);
        }
    }, [handleFileSelect]);

    const handleClearDocument = useCallback(() => {
        if (document && document.redactions.length > 0) {
            if (!confirm('This will clear the current document and all redactions. Continue?')) {
                return;
            }
        }
        clearDocument();
        unloadPdf();
    }, [document, clearDocument, unloadPdf]);

    // ============================================
    // SHARE HANDLING
    // ============================================

    const handleShare = useCallback(() => {
        if (!finalizedDocument) {
            alert('Please finalize your document first before sharing.');
            return;
        }

        if (!isAuthenticated) {
            setShowAuthModal(true);
            return;
        }

        // Prepare document data for sharing
        setShareDocumentData({
            name: finalizedDocument.name,
            size: finalizedDocument.size,
            hash: finalizedDocument.redactedHash || finalizedDocument.originalHash,
            encryptedKey: finalizedDocument.encryptedKey || '',
            keyIv: finalizedDocument.keyIv || '',
            thumbnailBase64: finalizedDocument.thumbnailBase64,
        });
        setShowShareModal(true);
    }, [finalizedDocument, isAuthenticated]);

    // ============================================
    // RENDER
    // ============================================

    const MainApp = () => (
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
                        <>
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
                            {finalizedDocument && (
                                <button
                                    className="share-header-btn"
                                    onClick={handleShare}
                                    title="Share Document"
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="18" cy="5" r="3"/>
                                        <circle cx="6" cy="12" r="3"/>
                                        <circle cx="18" cy="19" r="3"/>
                                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                                    </svg>
                                    Share
                                </button>
                            )}
                        </>
                    )}
                    <div className="auth-section">
                        <UserMenu onLoginClick={() => setShowAuthModal(true)} />
                    </div>
                </nav>
            </header>

            {/* Main Content */}
            <main className="main-content">
                {!imageData ? (
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
                            <p>PNG, JPEG, TIFF, BMP, WebP, PDF files supported</p>
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
                                accept=".png,.jpg,.jpeg,.tiff,.tif,.bmp,.webp,.pdf"
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
                    <div className={`editor-container ${showSidebar ? 'with-sidebar' : ''}`}>
                        <div className="editor-main">
                            <DocumentViewer enableCollaboration={isAuthenticated} />

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

                                {finalizedDocument && (
                                    <button
                                        className="action-btn primary"
                                        onClick={handleShare}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="18" cy="5" r="3"/>
                                            <circle cx="6" cy="12" r="3"/>
                                            <circle cx="18" cy="19" r="3"/>
                                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                                            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                                        </svg>
                                        Share Document
                                    </button>
                                )}
                            </div>
                        </div>

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

            {/* Auth Modal */}
            <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
            />

            {/* Share Modal */}
            <ShareModal
                isOpen={showShareModal}
                onClose={() => setShowShareModal(false)}
                documentData={shareDocumentData}
            />
        </div>
    );

    return (
        <Routes>
            <Route path="/" element={<MainApp />} />
            <Route path="/join/:code" element={<JoinSharePage />} />
        </Routes>
    );
}

export default App;
