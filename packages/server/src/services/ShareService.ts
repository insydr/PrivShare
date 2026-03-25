/**
 * ShareService for PrivShare
 * Handles ephemeral document sharing with secure links
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hash, compare } from 'bcryptjs';

const prisma = new PrismaClient();

// Configuration
const SHARE_CODE_LENGTH = 6;
const PASSPHRASE_SALT_ROUNDS = 12;

export interface CreateShareOptions {
  creatorId: string;
  encryptedKey: string;
  keyIv: string;
  documentName: string;
  documentSize: number;
  documentHash: string;
  thumbnailBase64?: string;
  accessMode: 'VIEW' | 'DOWNLOAD' | 'TRANSFER';
  maxAccessCount: number;
  expiresInMinutes: number;
  passphrase?: string;
}

export interface ShareInfo {
  id: string;
  code: string;
  documentName: string;
  documentSize: number;
  accessMode: string;
  expiresAt: Date;
  requiresPassphrase: boolean;
  thumbnailBase64?: string;
}

export interface AccessShareOptions {
  code: string;
  passphrase?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class ShareService {
  /**
   * Generate a unique share code
   */
  private static async generateUniqueCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars: I, O, 0, 1
    let code: string;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = '';
      const bytes = randomBytes(SHARE_CODE_LENGTH);
      for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
        code += chars[bytes[i]! % chars.length];
      }
      attempts++;

      // Check if code already exists
      const existing = await prisma.ephemeralShare.findUnique({
        where: { code },
      });

      if (!existing) {
        return code;
      }
    } while (attempts < maxAttempts);

    throw new Error('Failed to generate unique share code');
  }

  /**
   * Create a new ephemeral share
   */
  static async createShare(options: CreateShareOptions) {
    const code = await this.generateUniqueCode();

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + options.expiresInMinutes * 60 * 1000);

    // Hash passphrase if provided
    let passphraseHash: string | null = null;
    if (options.passphrase) {
      passphraseHash = await hash(options.passphrase, PASSPHRASE_SALT_ROUNDS);
    }

    // Create share in database
    const share = await prisma.ephemeralShare.create({
      data: {
        code,
        creatorId: options.creatorId,
        encryptedKey: options.encryptedKey,
        keyIv: options.keyIv,
        documentName: options.documentName,
        documentSize: options.documentSize,
        documentHash: options.documentHash,
        thumbnailBase64: options.thumbnailBase64,
        accessMode: options.accessMode as 'VIEW' | 'DOWNLOAD' | 'TRANSFER',
        maxAccessCount: options.maxAccessCount,
        expiresAt,
        passphraseHash,
      },
    });

    return {
      id: share.id,
      code: share.code,
      expiresAt: share.expiresAt,
      accessMode: share.accessMode,
    };
  }

  /**
   * Get share info for access (before decryption)
   */
  static async getShareInfo(code: string): Promise<ShareInfo | null> {
    const share = await prisma.ephemeralShare.findUnique({
      where: { code },
    });

    if (!share) {
      return null;
    }

    // Check if share is expired
    if (new Date() > share.expiresAt) {
      // Clean up expired share
      await prisma.ephemeralShare.delete({ where: { id: share.id } });
      return null;
    }

    // Check if share is revoked
    if (share.revokedAt) {
      return null;
    }

    // Check if access limit reached
    if (share.currentAccessCount >= share.maxAccessCount) {
      return null;
    }

    return {
      id: share.id,
      code: share.code,
      documentName: share.documentName,
      documentSize: share.documentSize,
      accessMode: share.accessMode,
      expiresAt: share.expiresAt,
      requiresPassphrase: !!share.passphraseHash,
      thumbnailBase64: share.thumbnailBase64 || undefined,
    };
  }

  /**
   * Access a share and get the encrypted key
   */
  static async accessShare(options: AccessShareOptions) {
    const share = await prisma.ephemeralShare.findUnique({
      where: { code: options.code },
    });

    if (!share) {
      return { success: false, error: 'Share not found' };
    }

    // Check expiration
    if (new Date() > share.expiresAt) {
      await prisma.ephemeralShare.delete({ where: { id: share.id } });
      return { success: false, error: 'Share has expired' };
    }

    // Check if revoked
    if (share.revokedAt) {
      return { success: false, error: 'Share has been revoked' };
    }

    // Check access limit
    if (share.currentAccessCount >= share.maxAccessCount) {
      return { success: false, error: 'Share access limit reached' };
    }

    // Verify passphrase if required
    if (share.passphraseHash) {
      if (!options.passphrase) {
        return { success: false, error: 'Passphrase required', requiresPassphrase: true };
      }

      const validPassphrase = await compare(options.passphrase, share.passphraseHash);
      if (!validPassphrase) {
        return { success: false, error: 'Invalid passphrase' };
      }
    }

    // Record access
    await prisma.$transaction([
      // Increment access count
      prisma.ephemeralShare.update({
        where: { id: share.id },
        data: { currentAccessCount: { increment: 1 } },
      }),
      // Create access record
      prisma.shareAccess.create({
        data: {
          shareId: share.id,
          ipAddress: options.ipAddress,
          userAgent: options.userAgent,
          accessType: share.accessMode.toLowerCase(),
        },
      }),
    ]);

    // Return share data
    return {
      success: true,
      data: {
        id: share.id,
        documentName: share.documentName,
        documentSize: share.documentSize,
        documentHash: share.documentHash,
        accessMode: share.accessMode,
        encryptedKey: share.encryptedKey,
        keyIv: share.keyIv,
        expiresAt: share.expiresAt,
      },
    };
  }

  /**
   * List shares created by a user
   */
  static async listUserShares(userId: string) {
    const shares = await prisma.ephemeralShare.findMany({
      where: {
        creatorId: userId,
        expiresAt: { gt: new Date() },
        revokedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { accesses: true },
        },
      },
    });

    return shares.map((share: {
      id: string;
      code: string;
      documentName: string;
      documentSize: number;
      accessMode: string;
      currentAccessCount: number;
      maxAccessCount: number;
      expiresAt: Date;
      createdAt: Date;
      _count: { accesses: number };
    }) => ({
      id: share.id,
      code: share.code,
      documentName: share.documentName,
      documentSize: share.documentSize,
      accessMode: share.accessMode,
      currentAccessCount: share.currentAccessCount,
      maxAccessCount: share.maxAccessCount,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      totalAccesses: share._count.accesses,
    }));
  }

  /**
   * Revoke a share
   */
  static async revokeShare(shareId: string, userId: string) {
    const share = await prisma.ephemeralShare.findUnique({
      where: { id: shareId },
    });

    if (!share) {
      return { success: false, error: 'Share not found' };
    }

    if (share.creatorId !== userId) {
      return { success: false, error: 'Unauthorized' };
    }

    await prisma.ephemeralShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Clean up expired shares (should be run periodically)
   */
  static async cleanupExpiredShares() {
    const result = await prisma.ephemeralShare.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // Keep revoked for 24h
        ],
      },
    });

    return { deletedCount: result.count };
  }
}

export default ShareService;
