/**
 * Authentication Middleware
 * =========================
 * 
 * Mock JWT authentication for development.
 * In production, replace with actual auth provider (Auth0, Cognito, etc.)
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import logger, { logAuthEvent } from '../utils/logger';

// ============================================
// CONFIGURATION
// ============================================

const JWT_SECRET = process.env.JWT_SECRET || 'privshare-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_ISSUER = 'privshare-server';

// ============================================
// TYPES
// ============================================

export interface User {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
}

export interface JwtPayload {
    userId: string;
    email: string;
    name: string;
    iat: number;
    exp: number;
    iss: string;
}

export interface AuthRequest extends Request {
    user?: User;
    token?: string;
}

// ============================================
// MOCK USER DATABASE
// ============================================

// In production, use a real database
const mockUsers = new Map<string, { id: string; email: string; name: string; passwordHash: string }>();

// Create a default test user
const createTestUser = () => {
    const testUserId = uuidv4();
    const passwordHash = bcrypt.hashSync('test123', 10);
    mockUsers.set('test@privshare.local', {
        id: testUserId,
        email: 'test@privshare.local',
        name: 'Test User',
        passwordHash,
    });
    logger.info('[Auth] Created test user: test@privshare.local / test123');
};

createTestUser();

// ============================================
// TOKEN GENERATION
// ============================================

/**
 * Generate a JWT token for a user
 */
export const generateToken = (user: User): string => {
    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            name: user.name,
        },
        JWT_SECRET,
        {
            expiresIn: JWT_EXPIRES_IN,
            issuer: JWT_ISSUER,
        }
    );
};

/**
 * Verify and decode a JWT token
 */
export const verifyToken = (token: string): JwtPayload | null => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
        }) as JwtPayload;
        return decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            logAuthEvent('TOKEN_EXPIRED');
        } else {
            logAuthEvent('TOKEN_INVALID');
        }
        return null;
    }
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

/**
 * Middleware to require authentication
 */
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

    if (!token) {
        res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Authentication required. Include a valid Bearer token.',
            code: 'AUTH_MISSING_TOKEN',
        });
        return;
    }

    const payload = verifyToken(token);

    if (!payload) {
        res.status(401).json({
            error: 'UNAUTHORIZED',
            message: 'Invalid or expired token.',
            code: 'AUTH_INVALID_TOKEN',
        });
        return;
    }

    // Attach user to request
    req.user = {
        id: payload.userId,
        email: payload.email,
        name: payload.name,
        createdAt: new Date(payload.iat * 1000),
    };
    req.token = token;

    next();
};

/**
 * Optional authentication - continues even if no token
 */
export const optionalAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

    if (token) {
        const payload = verifyToken(token);
        if (payload) {
            req.user = {
                id: payload.userId,
                email: payload.email,
                name: payload.name,
                createdAt: new Date(payload.iat * 1000),
            };
            req.token = token;
        }
    }

    next();
};

// ============================================
// AUTH HELPERS
// ============================================

/**
 * Register a new user (mock)
 */
export const registerUser = (email: string, password: string, name: string): User | null => {
    if (mockUsers.has(email)) {
        return null; // User already exists
    }

    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);

    mockUsers.set(email, {
        id: userId,
        email,
        name,
        passwordHash,
    });

    logger.info(`[Auth] New user registered: ${email}`);

    return {
        id: userId,
        email,
        name,
        createdAt: new Date(),
    };
};

/**
 * Authenticate user with email and password
 */
export const authenticateUser = (email: string, password: string): { user: User; token: string } | null => {
    const userRecord = mockUsers.get(email);

    if (!userRecord) {
        logAuthEvent('LOGIN_FAILURE', undefined, undefined);
        return null;
    }

    const isValidPassword = bcrypt.compareSync(password, userRecord.passwordHash);

    if (!isValidPassword) {
        logAuthEvent('LOGIN_FAILURE', userRecord.id, undefined);
        return null;
    }

    const user: User = {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        createdAt: new Date(),
    };

    const token = generateToken(user);

    logAuthEvent('LOGIN_SUCCESS', user.id, undefined);

    return { user, token };
};

/**
 * Get user by ID
 */
export const getUserById = (userId: string): User | null => {
    for (const user of mockUsers.values()) {
        if (user.id === userId) {
            return {
                id: user.id,
                email: user.email,
                name: user.name,
                createdAt: new Date(),
            };
        }
    }
    return null;
};
