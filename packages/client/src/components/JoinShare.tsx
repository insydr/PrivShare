/**
 * JoinShare Component for PrivShare
 * Page for accessing ephemeral shares via share code
 */

import React, { useState, useEffect } from 'react';
import shareService, { ShareInfo, ShareData } from '../services/ShareService';
import './JoinShare.css';

interface JoinShareProps {
  code: string;
  onSuccess?: (data: ShareData) => void;
}

export const JoinShare: React.FC<JoinShareProps> = ({ code, onSuccess }) => {
  const [loading, setLoading] = useState(true);
  const [accessing, setAccessing] = useState(false);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphraseInput, setShowPassphraseInput] = useState(false);

  useEffect(() => {
    loadShareInfo();
  }, [code]);

  const loadShareInfo = async () => {
    setLoading(true);
    setError(null);

    const result = await shareService.getShareInfo(code);

    if (result.error) {
      setError(result.error);
    } else if (result.share) {
      setShareInfo(result.share);
      setShowPassphraseInput(result.share.requiresPassphrase);
    }

    setLoading(false);
  };

  const handleAccess = async () => {
    if (showPassphraseInput && !passphrase) {
      setError('Please enter the passphrase');
      return;
    }

    setAccessing(true);
    setError(null);

    const result = await shareService.accessShare(code, passphrase || undefined);

    if (result.error) {
      setError(result.error);
      if (result.error.includes('Passphrase required')) {
        setShowPassphraseInput(true);
      }
    } else if (result.data) {
      setShareData(result.data);
      if (onSuccess) {
        onSuccess(result.data);
      }
    }

    setAccessing(false);
  };

  // Loading state
  if (loading) {
    return (
      <div className="join-share-container">
        <div className="join-share-loading">
          <div className="join-share-spinner" />
          <p>Loading share information...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !shareInfo) {
    return (
      <div className="join-share-container">
        <div className="join-share-error-state">
          <div className="join-share-error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2>Share Not Found</h2>
          <p>{error}</p>
          <p className="join-share-help">
            This share may have expired, reached its access limit, or been revoked.
          </p>
        </div>
      </div>
    );
  }

  // Success state - share accessed
  if (shareData) {
    return (
      <div className="join-share-container">
        <div className="join-share-success">
          <div className="join-share-success-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2>Share Accessed</h2>
          <p>You now have access to this document.</p>

          <div className="join-share-document">
            <div className="join-share-document-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="join-share-document-info">
              <span className="join-share-document-name">{shareData.documentName}</span>
              <span className="join-share-document-size">
                {shareService.formatFileSize(shareData.documentSize)}
              </span>
            </div>
          </div>

          <div className="join-share-meta">
            <p><strong>Access Mode:</strong> {shareData.accessMode}</p>
            <p><strong>Expires:</strong> {new Date(shareData.expiresAt).toLocaleString()}</p>
          </div>

          <div className="join-share-encrypted-key">
            <p className="join-share-key-label">Encrypted Document Key</p>
            <code className="join-share-key-value">
              {shareData.encryptedKey.substring(0, 32)}...
            </code>
          </div>
        </div>
      </div>
    );
  }

  // Default state - show share info and access options
  return (
    <div className="join-share-container">
      <div className="join-share-card">
        <div className="join-share-header">
          <div className="join-share-lock-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2>Secure Document Share</h2>
          <p>Someone has shared a document with you</p>
        </div>

        {shareInfo && (
          <>
            <div className="join-share-preview">
              {shareInfo.thumbnailBase64 && (
                <img
                  src={`data:image/png;base64,${shareInfo.thumbnailBase64}`}
                  alt="Document preview"
                  className="join-share-thumbnail"
                />
              )}
              <div className="join-share-info">
                <h3>{shareInfo.documentName}</h3>
                <p>{shareService.formatFileSize(shareInfo.documentSize)}</p>
                <p className="join-share-expires">
                  {shareService.getTimeRemaining(shareInfo.expiresAt).text}
                </p>
              </div>
            </div>

            <div className="join-share-details">
              <div className="join-share-detail-item">
                <span className="join-share-detail-label">Access Mode</span>
                <span className="join-share-detail-value">{shareInfo.accessMode}</span>
              </div>
              <div className="join-share-detail-item">
                <span className="join-share-detail-label">Share Code</span>
                <span className="join-share-detail-value code">{code}</span>
              </div>
            </div>

            {showPassphraseInput && (
              <div className="join-share-passphrase">
                <label htmlFor="passphrase">This share is password protected</label>
                <input
                  type="password"
                  id="passphrase"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter passphrase"
                  className="join-share-passphrase-input"
                />
              </div>
            )}

            {error && <div className="join-share-error">{error}</div>}

            <button
              className="join-share-access-btn"
              onClick={handleAccess}
              disabled={accessing}
            >
              {accessing ? (
                <>
                  <span className="join-share-spinner-small" />
                  Accessing...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Access Document
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default JoinShare;
