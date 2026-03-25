/**
 * Better-Auth Configuration for PrivShare
 * Provides persistent user authentication with Prisma database
 */

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';

// Initialize Prisma client
const prisma = new PrismaClient();

// Create better-auth instance
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'sqlite',
  }),

  // Email and password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Can be enabled later with email service
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,            // Cache for 5 minutes
    },
  },

  // Rate limiting for authentication endpoints
  rateLimit: {
    enabled: true,
    window: 60,                   // 1 minute window
    max: 10,                      // Max 10 requests per window
  },

  // User configuration
  user: {
    additionalFields: {
      emailVerified: {
        type: 'boolean',
        required: false,
        defaultValue: false,
      },
    },
  },

  // Trusted origins for CORS
  trustedOrigins: [
    'http://localhost:5173',      // Vite dev server
    'http://localhost:3000',      // Alternative dev port
    'http://localhost:3001',      // Server port
  ],
});

// Export types for client
export type Auth = typeof auth;

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
