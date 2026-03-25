/**
 * Share Routes for PrivShare
 * API endpoints for ephemeral document sharing
 */

import { Router, Request, Response } from 'express';
import ShareService from '../services/ShareService';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

/**
 * POST /api/share/create
 * Create a new ephemeral share
 * Requires authentication
 */
router.post('/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      encryptedKey,
      keyIv,
      documentName,
      documentSize,
      documentHash,
      thumbnailBase64,
      accessMode = 'VIEW',
      maxAccessCount = 1,
      expiresInMinutes = 60,
      passphrase,
    } = req.body;

    // Validate required fields
    if (!encryptedKey || !keyIv || !documentName || !documentHash) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required fields: encryptedKey, keyIv, documentName, documentHash',
      });
    }

    // Validate access mode
    const validAccessModes = ['VIEW', 'DOWNLOAD', 'TRANSFER'];
    if (!validAccessModes.includes(accessMode)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid access mode. Must be one of: ${validAccessModes.join(', ')}`,
      });
    }

    // Validate expiration time (max 7 days)
    const maxExpiration = 7 * 24 * 60; // 7 days in minutes
    if (expiresInMinutes > maxExpiration) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Maximum expiration time is ${maxExpiration} minutes (7 days)`,
      });
    }

    // Create share
    const result = await ShareService.createShare({
      creatorId: req.user!.id,
      encryptedKey,
      keyIv,
      documentName,
      documentSize: documentSize || 0,
      documentHash,
      thumbnailBase64,
      accessMode,
      maxAccessCount,
      expiresInMinutes,
      passphrase,
    });

    return res.status(201).json({
      success: true,
      share: result,
    });
  } catch (error) {
    console.error('Create share error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create share',
    });
  }
});

/**
 * GET /api/share/:code/info
 * Get share information (public - no auth required)
 */
router.get('/:code/info', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid share code',
      });
    }

    const shareInfo = await ShareService.getShareInfo(code.toUpperCase());

    if (!shareInfo) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Share not found, expired, or access limit reached',
      });
    }

    return res.json({
      success: true,
      share: shareInfo,
    });
  } catch (error) {
    console.error('Get share info error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get share information',
    });
  }
});

/**
 * POST /api/share/:code/access
 * Access a share (get encrypted key)
 * Public endpoint - passphrase verification happens here
 */
router.post('/:code/access', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { passphrase } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid share code',
      });
    }

    const ipAddress = req.ip || req.connection.remoteAddress || undefined;
    const userAgent = req.headers['user-agent'] || undefined;

    const result = await ShareService.accessShare({
      code: code.toUpperCase(),
      passphrase,
      ipAddress,
      userAgent,
    });

    if (!result.success) {
      const statusCode = result.error === 'Passphrase required' ? 401 : 400;
      return res.status(statusCode).json({
        error: 'Access Denied',
        message: result.error,
        requiresPassphrase: (result as any).requiresPassphrase,
      });
    }

    return res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('Access share error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to access share',
    });
  }
});

/**
 * GET /api/share/list
 * List user's shares
 * Requires authentication
 */
router.get('/list', requireAuth, async (req: Request, res: Response) => {
  try {
    const shares = await ShareService.listUserShares(req.user!.id);

    return res.json({
      success: true,
      shares,
    });
  } catch (error) {
    console.error('List shares error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list shares',
    });
  }
});

/**
 * DELETE /api/share/:shareId/revoke
 * Revoke a share
 * Requires authentication (must be creator)
 */
router.delete('/:shareId/revoke', requireAuth, async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;

    if (!shareId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Share ID is required',
      });
    }

    const result = await ShareService.revokeShare(shareId, req.user!.id);

    if (!result.success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.error,
      });
    }

    return res.json({
      success: true,
      message: 'Share revoked successfully',
    });
  } catch (error) {
    console.error('Revoke share error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to revoke share',
    });
  }
});

/**
 * POST /api/share/cleanup
 * Clean up expired shares (admin endpoint)
 * In production, this should be called by a cron job
 */
router.post('/cleanup', async (_req: Request, res: Response) => {
  try {
    const result = await ShareService.cleanupExpiredShares();

    return res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to cleanup expired shares',
    });
  }
});

export default router;
