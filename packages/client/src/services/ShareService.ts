/**
 * ShareService for PrivShare Client
 * API client for ephemeral document sharing
 */

import { useAuthStore } from '../store/authStore';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ShareInfo {
  id: string;
  code: string;
  documentName: string;
  documentSize: number;
  accessMode: string;
  expiresAt: string;
  requiresPassphrase: boolean;
  thumbnailBase64?: string;
}

export interface ShareData {
  id: string;
  documentName: string;
  documentSize: number;
  documentHash: string;
  accessMode: string;
  encryptedKey: string;
  keyIv: string;
  expiresAt: string;
}

export interface CreateShareOptions {
  encryptedKey: string;
  keyIv: string;
  documentName: string;
  documentSize: number;
  documentHash: string;
  thumbnailBase64?: string;
  accessMode?: 'VIEW' | 'DOWNLOAD' | 'TRANSFER';
  maxAccessCount?: number;
  expiresInMinutes?: number;
  passphrase?: string;
}

export interface UserShare {
  id: string;
  code: string;
  documentName: string;
  documentSize: number;
  accessMode: string;
  currentAccessCount: number;
  maxAccessCount: number;
  expiresAt: string;
  createdAt: string;
  totalAccesses: number;
}

interface ApiResponse<T> {
  success?: boolean;
  share?: T;
  shares?: T[];
  data?: T;
  error?: string;
  message?: string;
}

class ShareService {
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const token = useAuthStore.getState().token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Create a new ephemeral share
   */
  async createShare(options: CreateShareOptions): Promise<ApiResponse<{ id: string; code: string; expiresAt: string; accessMode: string }>> {
    try {
      const response = await fetch(`${API_BASE}/api/share/create`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(options),
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || 'Failed to create share' };
      }

      return result;
    } catch (error) {
      console.error('Create share error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * Get share info by code
   */
  async getShareInfo(code: string): Promise<ApiResponse<ShareInfo>> {
    try {
      const response = await fetch(`${API_BASE}/api/share/${code}/info`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || 'Share not found' };
      }

      return result;
    } catch (error) {
      console.error('Get share info error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * Access a share and get the encrypted key
   */
  async accessShare(code: string, passphrase?: string): Promise<ApiResponse<ShareData>> {
    try {
      const response = await fetch(`${API_BASE}/api/share/${code}/access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ passphrase }),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          error: result.message || result.error || 'Failed to access share',
        };
      }

      return result;
    } catch (error) {
      console.error('Access share error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * List user's shares
   */
  async listShares(): Promise<ApiResponse<UserShare[]>> {
    try {
      const response = await fetch(`${API_BASE}/api/share/list`, {
        headers: this.getHeaders(),
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || 'Failed to list shares' };
      }

      return result;
    } catch (error) {
      console.error('List shares error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * Revoke a share
   */
  async revokeShare(shareId: string): Promise<ApiResponse<null>> {
    try {
      const response = await fetch(`${API_BASE}/api/share/${shareId}/revoke`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || 'Failed to revoke share' };
      }

      return result;
    } catch (error) {
      console.error('Revoke share error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * Generate a share URL from code
   */
  getShareUrl(code: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/join/${code}`;
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Calculate time remaining until expiration
   */
  getTimeRemaining(expiresAt: string): { minutes: number; hours: number; days: number; text: string } {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();

    if (diffMs <= 0) {
      return { minutes: 0, hours: 0, days: 0, text: 'Expired' };
    }

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let text = '';
    if (days > 0) {
      text = `${days} day${days > 1 ? 's' : ''} remaining`;
    } else if (hours > 0) {
      text = `${hours} hour${hours > 1 ? 's' : ''} remaining`;
    } else {
      text = `${minutes} minute${minutes > 1 ? 's' : ''} remaining`;
    }

    return { minutes, hours, days, text };
  }
}

export const shareService = new ShareService();
export default shareService;
