/**
 * Authentication Routes
 * =====================
 * 
 * Mock authentication endpoints for development.
 * Replace with real auth provider in production.
 */

import { Router, Request, Response } from 'express';
import { 
    generateToken, 
    registerUser, 
    authenticateUser, 
    requireAuth,
    AuthRequest 
} from '../middleware/auth';
import logger from '../utils/logger';

const router = Router();

// ============================================
// REGISTER
// ============================================

router.post('/register', (req: Request, res: Response) => {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password || !name) {
        res.status(400).json({
            error: 'MISSING_FIELDS',
            message: 'Email, password, and name are required.',
        });
        return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        res.status(400).json({
            error: 'INVALID_EMAIL',
            message: 'Please provide a valid email address.',
        });
        return;
    }

    // Password validation
    if (password.length < 6) {
        res.status(400).json({
            error: 'WEAK_PASSWORD',
            message: 'Password must be at least 6 characters long.',
        });
        return;
    }

    // Register user
    const user = registerUser(email, password, name);

    if (!user) {
        res.status(409).json({
            error: 'USER_EXISTS',
            message: 'A user with this email already exists.',
        });
        return;
    }

    // Generate token
    const token = generateToken(user);

    res.status(201).json({
        message: 'User registered successfully',
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
        },
        token,
    });
});

// ============================================
// LOGIN
// ============================================

router.post('/login', (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({
            error: 'MISSING_FIELDS',
            message: 'Email and password are required.',
        });
        return;
    }

    const result = authenticateUser(email, password);

    if (!result) {
        res.status(401).json({
            error: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
        });
        return;
    }

    res.json({
        message: 'Login successful',
        user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
        },
        token: result.token,
    });
});

// ============================================
// VERIFY TOKEN
// ============================================

router.get('/verify', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({
        valid: true,
        user: {
            id: req.user?.id,
            email: req.user?.email,
            name: req.user?.name,
        },
    });
});

// ============================================
// LOGOUT (client-side token removal)
// ============================================

router.post('/logout', requireAuth, (req: AuthRequest, res: Response) => {
    // In a real implementation, you might blacklist the token
    // For now, we just acknowledge the logout request
    logger.info(`[Auth] User logged out: ${req.user?.id}`);

    res.json({
        message: 'Logged out successfully',
    });
});

// ============================================
// DEVELOPMENT: GET TEST TOKEN
// ============================================

if (process.env.NODE_ENV !== 'production') {
    router.get('/dev-token', (req: Request, res: Response) => {
        const testUser = {
            id: 'test-user-id',
            email: 'test@privshare.local',
            name: 'Test User',
            createdAt: new Date(),
        };

        const token = generateToken(testUser);

        res.json({
            message: 'Development test token generated',
            credentials: {
                email: 'test@privshare.local',
                password: 'test123',
            },
            token,
        });
    });
}

export default router;
