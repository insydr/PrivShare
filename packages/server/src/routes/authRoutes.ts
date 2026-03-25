/**
 * Authentication Routes for PrivShare
 * Handles user registration, login, session management
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const session = req.headers.authorization?.replace('Bearer ', '');

    if (!session) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No session token provided',
      });
    }

    // Find session and user
    const sessionRecord = await prisma.session.findUnique({
      where: { token: session },
      include: { user: true },
    });

    if (!sessionRecord) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid session token',
      });
    }

    // Check if session is expired
    if (new Date() > sessionRecord.expiresAt) {
      await prisma.session.delete({ where: { id: sessionRecord.id } });
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Session expired',
      });
    }

    return res.json({
      user: {
        id: sessionRecord.user.id,
        email: sessionRecord.user.email,
        name: sessionRecord.user.name,
        image: sessionRecord.user.image,
        emailVerified: sessionRecord.user.emailVerified,
      },
      session: {
        id: sessionRecord.id,
        expiresAt: sessionRecord.expiresAt,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user information',
    });
  }
});

/**
 * POST /api/auth/sign-out
 * Sign out current user
 */
router.post('/sign-out', async (req: Request, res: Response) => {
  try {
    const session = req.headers.authorization?.replace('Bearer ', '');

    if (session) {
      // Delete session from database
      await prisma.session.deleteMany({
        where: { token: session },
      });
    }

    return res.json({
      message: 'Signed out successfully',
    });
  } catch (error) {
    console.error('Sign out error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sign out',
    });
  }
});

/**
 * GET /api/auth/session
 * Get current session info
 */
router.get('/session', async (req: Request, res: Response) => {
  try {
    const session = req.headers.authorization?.replace('Bearer ', '');

    if (!session) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No session token provided',
      });
    }

    const sessionRecord = await prisma.session.findUnique({
      where: { token: session },
      include: { user: true },
    });

    if (!sessionRecord) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid session',
      });
    }

    return res.json({
      session: {
        id: sessionRecord.id,
        expiresAt: sessionRecord.expiresAt,
        user: {
          id: sessionRecord.user.id,
          email: sessionRecord.user.email,
          name: sessionRecord.user.name,
        },
      },
    });
  } catch (error) {
    console.error('Session error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get session',
    });
  }
});

export default router;
