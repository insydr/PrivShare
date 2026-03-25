/**
 * Session Routes
 * ===============
 * 
 * API endpoints for collaboration session management.
 * Sessions are used to coordinate users for real-time collaboration.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { roomManager } from '../utils/roomManager';
import logger from '../utils/logger';

const router = Router();

// ============================================
// CREATE SESSION
// ============================================

router.post('/sessions', requireAuth, (req: AuthRequest, res: Response) => {
    const { name } = req.body;
    const userId = req.user?.id;

    if (!name) {
        res.status(400).json({
            error: 'MISSING_NAME',
            message: 'Session name is required.',
        });
        return;
    }

    if (!userId) {
        res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'User not authenticated.',
        });
        return;
    }

    // Create room
    const room = roomManager.createRoom(name, userId);

    logger.info(`[Session] Created session: ${room.id} by user: ${userId}`);

    res.status(201).json({
        sessionId: room.id,
        name: room.name,
        createdBy: room.createdBy,
        createdAt: room.createdAt.toISOString(),
        websocketUrl: `/ws?roomId=${room.id}&userId=${userId}`,
    });
});

// ============================================
// GET SESSION INFO
// ============================================

router.get('/sessions/:sessionId', requireAuth, (req: AuthRequest, res: Response) => {
    const { sessionId } = req.params;

    const roomState = roomManager.getRoomState(sessionId);

    if (!roomState) {
        res.status(404).json({
            error: 'SESSION_NOT_FOUND',
            message: 'The requested session does not exist or has expired.',
        });
        return;
    }

    res.json({
        sessionId: roomState.roomId,
        name: roomState.name,
        users: roomState.users,
        documentMetadata: roomState.documentMetadata,
        websocketUrl: `/ws?roomId=${roomState.roomId}&userId=${req.user?.id}`,
    });
});

// ============================================
// LIST ALL SESSIONS
// ============================================

router.get('/sessions', requireAuth, (_req: AuthRequest, res: Response) => {
    const rooms = roomManager.getAllRooms();

    res.json({
        sessions: rooms,
        count: rooms.length,
    });
});

// ============================================
// SET DOCUMENT METADATA
// ============================================

router.post('/sessions/:sessionId/document', requireAuth, (req: AuthRequest, res: Response) => {
    const { sessionId } = req.params;
    const { width, height, format, originalHash } = req.body;

    // Validate required fields
    if (!width || !height || !originalHash) {
        res.status(400).json({
            error: 'MISSING_FIELDS',
            message: 'width, height, and originalHash are required.',
        });
        return;
    }

    // Validate hash format (SHA-256 = 64 hex characters)
    if (!/^[a-fA-F0-9]{64}$/.test(originalHash)) {
        res.status(400).json({
            error: 'INVALID_HASH',
            message: 'originalHash must be a valid SHA-256 hash (64 hex characters).',
        });
        return;
    }

    const room = roomManager.getRoom(sessionId);

    if (!room) {
        res.status(404).json({
            error: 'SESSION_NOT_FOUND',
            message: 'The requested session does not exist.',
        });
        return;
    }

    // Set metadata (NO FILE, just metadata!)
    roomManager.setDocumentMetadata(sessionId, {
        width,
        height,
        format: format || 'unknown',
        originalHash,
    });

    logger.info(`[Session] Document metadata set for session: ${sessionId}`);

    res.json({
        message: 'Document metadata set successfully',
        sessionId,
        metadata: {
            width,
            height,
            format,
            originalHash: originalHash.substring(0, 16) + '...',
        },
        note: 'Document file is NOT stored on server. Only metadata is kept for coordination.',
    });
});

// ============================================
// GET SESSION STATS
// ============================================

router.get('/sessions/stats', requireAuth, (_req: AuthRequest, res: Response) => {
    const stats = roomManager.getStats();

    res.json({
        ...stats,
        architecture: 'zero-trust',
        fileStorage: 'DISABLED',
    });
});

// ============================================
// HEALTH CHECK (Public)
// ============================================

router.get('/health', (_req: Request, res: Response) => {
    const stats = roomManager.getStats();

    res.json({
        status: 'healthy',
        version: '1.0.0',
        architecture: 'zero-trust',
        fileUploads: 'DISABLED',
        activeRooms: stats.totalRooms,
        activeUsers: stats.totalUsers,
        timestamp: new Date().toISOString(),
    });
});

export default router;
