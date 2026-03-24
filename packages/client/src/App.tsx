/**
 * PrivShare Client Application
 * 
 * Zero-Trust Document Redaction Platform
 * - All processing happens locally via WebAssembly
 * - Files never leave the client device
 * - Only metadata is shared for collaboration
 */

import { useState } from 'react';
import { useDocumentStore } from './store/documentStore';

function App() {
  const { document, isProcessing } = useDocumentStore();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileSelect = async (file: File) => {
    // File is read into browser memory only - never uploaded
    console.log('[PrivShare] File selected:', file.name);
    console.log('[PrivShare] Processing locally - file never leaves your device');
    
    // Read file as ArrayBuffer (local only)
    const arrayBuffer = await file.arrayBuffer();
    console.log('[PrivShare] File loaded into memory:', arrayBuffer.byteLength, 'bytes');
    
    // TODO: Send to WASM worker for processing
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#4F46E5"/>
            <path d="M8 16L14 22L24 10" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1>PrivShare</h1>
        </div>
        <nav className="nav">
          <span className="badge">Zero-Trust Architecture</span>
        </nav>
      </header>

      <main className="main-content">
        {!document ? (
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
              <p>PDF, PNG, JPG, or TIFF files supported</p>
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
                accept=".pdf,.png,.jpg,.jpeg,.tiff"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                style={{ display: 'none' }}
              />
              <label htmlFor="file-input" className="browse-button">
                Browse Files
              </label>
            </div>
          </div>
        ) : (
          <div className="editor">
            <div className="editor-toolbar">
              <h2>Document Editor</h2>
              {isProcessing && <span className="processing-indicator">Processing...</span>}
            </div>
            <div className="editor-canvas">
              {/* Canvas for document rendering and redaction */}
            </div>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>
          <strong>Privacy First:</strong> All document processing happens in your browser using WebAssembly.
          Your files never leave your device.
        </p>
      </footer>
    </div>
  );
}

export default App;
