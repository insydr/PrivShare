/**
 * ShareModal Component for PrivShare
 * Modal for creating ephemeral document shares
 */

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import shareService, { CreateShareOptions } from '../services/ShareService';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentData: {
    name: string;
    size: number;
    hash: string;
    encryptedKey: string;
    keyIv: string;
    thumbnailBase64?: string;
  } | null;
}

type AccessMode = 'VIEW' | 'DOWNLOAD' | 'TRANSFER';

const EXPIRATION_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '24 hours', value: 1440 },
  { label: '3 days', value: 4320 },
  { label: '7 days', value: 10080 },
];

const ACCESS_COUNT_OPTIONS = [
  { label: '1 access', value: 1 },
  { label: '3 accesses', value: 3 },
  { label: '5 accesses', value: 5 },
  { label: '10 accesses', value: 10 },
  { label: 'Unlimited', value: 100 },
];

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  documentData,
}) => {
  const [accessMode, setAccessMode] = useState<AccessMode>('VIEW');
  const [expiresInMinutes, setExpiresInMinutes] = useState(60);
  const [maxAccessCount, setMaxAccessCount] = useState(1);
  const [passphrase, setPassphrase] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  if (!isOpen || !documentData) return null;

  const resetForm = () => {
    setAccessMode('VIEW');
    setExpiresInMinutes(60);
    setMaxAccessCount(1);
    setPassphrase('');
    setUsePassphrase(false);
    setError(null);
    setShareCode(null);
    setShareUrl(null);
    setCopied(false);
  };

  const handleCreateShare = async () => {
    if (!isAuthenticated) {
      setError('Please sign in to create a share');
      return;
    }

    if (usePassphrase && passphrase.length < 4) {
      setError('Passphrase must be at least 4 characters');
      return;
    }

    setLoading(true);
    setError(null);

    const options: CreateShareOptions = {
      encryptedKey: documentData.encryptedKey,
      keyIv: documentData.keyIv,
      documentName: documentData.name,
      documentSize: documentData.size,
      documentHash: documentData.hash,
      thumbnailBase64: documentData.thumbnailBase64,
      accessMode,
      maxAccessCount,
      expiresInMinutes,
      passphrase: usePassphrase ? passphrase : undefined,
    };

    const result = await shareService.createShare(options);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    if (result.share) {
      setShareCode(result.share.code);
      setShareUrl(shareService.getShareUrl(result.share.code));
    }

    setLoading(false);
  };

  const handleCopyUrl = async () => {
    if (shareUrl) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Success state - show share link
  if (shareCode && shareUrl) {
    return (
      <div className="share-modal-backdrop" onClick={handleBackdropClick}>
        <div className="share-modal success">
          <button className="share-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>

          <div className="share-success-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>

          <h2>Share Created!</h2>
          <p className="share-success-message">
            Your document is ready to share. Copy the link below:
          </p>

          <div className="share-link-container">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="share-link-input"
            />
            <button
              className={`share-copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopyUrl}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="share-code-display">
            <span className="share-code-label">Share Code:</span>
            <span className="share-code-value">{shareCode}</span>
          </div>

          <div className="share-details">
            <p><strong>Access Mode:</strong> {accessMode}</p>
            <p><strong>Expires:</strong> {EXPIRATION_OPTIONS.find(o => o.value === expiresInMinutes)?.label}</p>
            <p><strong>Max Accesses:</strong> {maxAccessCount === 100 ? 'Unlimited' : maxAccessCount}</p>
            {usePassphrase && <p><strong>Protected:</strong> Yes (passphrase required)</p>}
          </div>

          <button className="share-done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="share-modal-backdrop" onClick={handleBackdropClick}>
      <div className="share-modal">
        <button className="share-modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <div className="share-modal-header">
          <h2>Create Secure Share</h2>
          <p>Share your document with an ephemeral, encrypted link</p>
        </div>

        <div className="share-document-preview">
          <div className="share-document-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <div className="share-document-info">
            <span className="share-document-name">{documentData.name}</span>
            <span className="share-document-size">{shareService.formatFileSize(documentData.size)}</span>
          </div>
        </div>

        <div className="share-options">
          <div className="share-option-group">
            <label>Access Mode</label>
            <div className="share-option-buttons">
              {(['VIEW', 'DOWNLOAD', 'TRANSFER'] as AccessMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`share-option-btn ${accessMode === mode ? 'active' : ''}`}
                  onClick={() => setAccessMode(mode)}
                >
                  {mode === 'VIEW' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                  {mode === 'DOWNLOAD' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                  {mode === 'TRANSFER' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                  )}
                  {mode.charAt(0) + mode.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="share-option-group">
            <label>Expiration Time</label>
            <select
              value={expiresInMinutes}
              onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
              className="share-select"
            >
              {EXPIRATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="share-option-group">
            <label>Maximum Accesses</label>
            <select
              value={maxAccessCount}
              onChange={(e) => setMaxAccessCount(Number(e.target.value))}
              className="share-select"
            >
              {ACCESS_COUNT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="share-passphrase-option">
            <label className="share-checkbox-label">
              <input
                type="checkbox"
                checked={usePassphrase}
                onChange={(e) => setUsePassphrase(e.target.checked)}
              />
              <span>Protect with passphrase</span>
            </label>
            {usePassphrase && (
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                className="share-passphrase-input"
                minLength={4}
              />
            )}
          </div>
        </div>

        {error && <div className="share-error">{error}</div>}

        <div className="share-modal-actions">
          <button className="share-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="share-create-btn"
            onClick={handleCreateShare}
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Share'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
