/**
 * CryptoService
 * ==============
 * 
 * Client-side encryption service using Web Crypto API.
 * Provides AES-GCM encryption for secure file storage and transfer.
 * 
 * Features:
 * - AES-256-GCM encryption for data at rest and in transit
 * - PBKDF2 key derivation from passphrases
 * - Secure random IV/salt generation
 * - Key wrapping for secure key storage
 * - Ephemeral key generation for one-time shares
 * 
 * Security:
 * - All operations run in browser (zero-trust)
 * - Keys never leave client device
 * - No server involvement in encryption
 */

// ============================================
// TYPES
// ============================================

export interface EncryptionResult {
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
    salt: Uint8Array;
    algorithm: 'AES-GCM';
    keyLength: 256;
}

export interface DecryptionOptions {
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
    salt: Uint8Array;
    passphrase?: string;
    key?: CryptoKey;
}

export interface KeyPair {
    publicKey: CryptoKey;
    privateKey: CryptoKey;
}

export interface WrappedKey {
    wrappedKey: ArrayBuffer;
    iv: Uint8Array;
}

export interface EncryptionProgress {
    stage: 'deriving' | 'encrypting' | 'complete';
    progress: number; // 0-100
}

export type ProgressCallback = (progress: EncryptionProgress) => void;

// ============================================
// CONSTANTS
// ============================================

const AES_KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 100000; // OWASP recommended minimum
const SALT_LENGTH = 16; // 128 bits
const IV_LENGTH = 12; // 96 bits for GCM (recommended)
const TAG_LENGTH = 128; // 128 bits authentication tag

// ============================================
// CRYPTO SERVICE CLASS
// ============================================

export class CryptoService {
    private debug: boolean;

    constructor(debug: boolean = false) {
        this.debug = debug;
        
        // Verify Web Crypto API availability
        if (!window.crypto?.subtle) {
            throw new Error('Web Crypto API not available in this browser');
        }
    }

    // ============================================
    // KEY GENERATION
    // ============================================

    /**
     * Generate a new AES-256-GCM key
     */
    async generateKey(): Promise<CryptoKey> {
        this.log('Generating new AES-256-GCM key');

        const key = await window.crypto.subtle.generateKey(
            {
                name: 'AES-GCM',
                length: AES_KEY_LENGTH,
            },
            true, // extractable
            ['encrypt', 'decrypt']
        );

        this.log('Key generated successfully');
        return key;
    }

    /**
     * Derive an AES key from a passphrase using PBKDF2
     */
    async deriveKeyFromPassphrase(
        passphrase: string,
        salt?: Uint8Array
    ): Promise<{ key: CryptoKey; salt: Uint8Array }> {
        this.log('Deriving key from passphrase');

        // Generate salt if not provided
        const actualSalt = salt || window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

        // Import passphrase as key material
        const passphraseKey = await window.crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(passphrase),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        // Derive AES key using PBKDF2
        const derivedKey = await window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: actualSalt,
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256',
            },
            passphraseKey,
            {
                name: 'AES-GCM',
                length: AES_KEY_LENGTH,
            },
            true, // extractable
            ['encrypt', 'decrypt']
        );

        this.log('Key derived successfully');
        return { key: derivedKey, salt: actualSalt };
    }

    /**
     * Generate an ephemeral key for one-time sharing
     */
    async generateEphemeralKey(): Promise<CryptoKey> {
        return this.generateKey();
    }

    // ============================================
    // ENCRYPTION
    // ============================================

    /**
     * Encrypt data using AES-256-GCM with a passphrase
     */
    async encryptWithPassphrase(
        data: ArrayBuffer,
        passphrase: string,
        onProgress?: ProgressCallback
    ): Promise<EncryptionResult> {
        this.log('Encrypting with passphrase');

        onProgress?.({ stage: 'deriving', progress: 20 });

        // Derive key from passphrase
        const { key, salt } = await this.deriveKeyFromPassphrase(passphrase);

        onProgress?.({ stage: 'encrypting', progress: 50 });

        // Encrypt with derived key
        const result = await this.encrypt(data, key, salt);

        onProgress?.({ stage: 'complete', progress: 100 });

        return result;
    }

    /**
     * Encrypt data using AES-256-GCM with a pre-generated key
     */
    async encrypt(
        data: ArrayBuffer,
        key: CryptoKey,
        salt?: Uint8Array
    ): Promise<EncryptionResult> {
        this.log('Encrypting data');

        // Generate random IV
        const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));

        // Use provided salt or generate new one
        const actualSalt = salt || window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

        // Encrypt
        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
                tagLength: TAG_LENGTH,
            },
            key,
            data
        );

        this.log('Encryption complete, ciphertext size:', ciphertext.byteLength);

        return {
            ciphertext,
            iv,
            salt: actualSalt,
            algorithm: 'AES-GCM',
            keyLength: AES_KEY_LENGTH,
        };
    }

    // ============================================
    // DECRYPTION
    // ============================================

    /**
     * Decrypt data using a passphrase
     */
    async decryptWithPassphrase(
        options: DecryptionOptions
    ): Promise<ArrayBuffer> {
        this.log('Decrypting with passphrase');

        if (!options.passphrase) {
            throw new Error('Passphrase required for decryption');
        }

        // Derive key from passphrase
        const { key } = await this.deriveKeyFromPassphrase(
            options.passphrase,
            options.salt
        );

        // Decrypt
        return this.decrypt({
            ciphertext: options.ciphertext,
            iv: options.iv,
            salt: options.salt,
            key,
        });
    }

    /**
     * Decrypt data using a pre-generated key
     */
    async decrypt(options: DecryptionOptions): Promise<ArrayBuffer> {
        this.log('Decrypting data');

        if (!options.key) {
            throw new Error('Key required for decryption');
        }

        const plaintext = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: options.iv,
                tagLength: TAG_LENGTH,
            },
            options.key,
            options.ciphertext
        );

        this.log('Decryption complete, plaintext size:', plaintext.byteLength);

        return plaintext;
    }

    // ============================================
    // KEY WRAPPING (for secure key storage/transfer)
    // ============================================

    /**
     * Wrap (encrypt) a key with another key
     */
    async wrapKey(
        keyToWrap: CryptoKey,
        wrappingKey: CryptoKey
    ): Promise<WrappedKey> {
        this.log('Wrapping key');

        const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));

        const wrappedKey = await window.crypto.subtle.wrapKey(
            'raw',
            keyToWrap,
            wrappingKey,
            {
                name: 'AES-GCM',
                iv: iv,
            }
        );

        this.log('Key wrapped successfully');

        return { wrappedKey, iv };
    }

    /**
     * Unwrap (decrypt) a key
     */
    async unwrapKey(
        wrappedKey: WrappedKey,
        unwrappingKey: CryptoKey
    ): Promise<CryptoKey> {
        this.log('Unwrapping key');

        const key = await window.crypto.subtle.unwrapKey(
            'raw',
            wrappedKey.wrappedKey,
            unwrappingKey,
            {
                name: 'AES-GCM',
                iv: wrappedKey.iv,
            },
            {
                name: 'AES-GCM',
                length: AES_KEY_LENGTH,
            },
            true,
            ['encrypt', 'decrypt']
        );

        this.log('Key unwrapped successfully');

        return key;
    }

    // ============================================
    // KEY EXPORT/IMPORT
    // ============================================

    /**
     * Export a key to raw bytes
     */
    async exportKey(key: CryptoKey): Promise<ArrayBuffer> {
        this.log('Exporting key');
        return window.crypto.subtle.exportKey('raw', key);
    }

    /**
     * Import a key from raw bytes
     */
    async importKey(keyData: ArrayBuffer): Promise<CryptoKey> {
        this.log('Importing key');
        
        return window.crypto.subtle.importKey(
            'raw',
            keyData,
            {
                name: 'AES-GCM',
                length: AES_KEY_LENGTH,
            },
            true, // extractable
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Export key as base64 string
     */
    async exportKeyAsBase64(key: CryptoKey): Promise<string> {
        const keyData = await this.exportKey(key);
        return this.arrayBufferToBase64(keyData);
    }

    /**
     * Import key from base64 string
     */
    async importKeyFromBase64(base64Key: string): Promise<CryptoKey> {
        const keyData = this.base64ToArrayBuffer(base64Key);
        return this.importKey(keyData);
    }

    // ============================================
    // ASYMMETRIC KEY OPERATIONS (for key exchange)
    // ============================================

    /**
     * Generate an ECDH key pair for key exchange
     */
    async generateKeyPair(): Promise<KeyPair> {
        this.log('Generating ECDH key pair');

        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-256',
            },
            true,
            ['deriveKey']
        );

        this.log('Key pair generated');

        return {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
        };
    }

    /**
     * Derive a shared secret key using ECDH
     */
    async deriveSharedKey(
        privateKey: CryptoKey,
        publicKey: CryptoKey
    ): Promise<CryptoKey> {
        this.log('Deriving shared secret key');

        const sharedKey = await window.crypto.subtle.deriveKey(
            {
                name: 'ECDH',
                public: publicKey,
            },
            privateKey,
            {
                name: 'AES-GCM',
                length: AES_KEY_LENGTH,
            },
            true,
            ['encrypt', 'decrypt']
        );

        this.log('Shared secret key derived');

        return sharedKey;
    }

    /**
     * Export public key as base64
     */
    async exportPublicKey(publicKey: CryptoKey): Promise<string> {
        const keyData = await window.crypto.subtle.exportKey('spki', publicKey);
        return this.arrayBufferToBase64(keyData);
    }

    /**
     * Import public key from base64
     */
    async importPublicKey(base64Key: string): Promise<CryptoKey> {
        const keyData = this.base64ToArrayBuffer(base64Key);
        
        return window.crypto.subtle.importKey(
            'spki',
            keyData,
            {
                name: 'ECDH',
                namedCurve: 'P-256',
            },
            true,
            []
        );
    }

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================

    /**
     * Generate a random passphrase
     */
    generateRandomPassphrase(length: number = 32): string {
        const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        const values = window.crypto.getRandomValues(new Uint8Array(length));
        
        return Array.from(values)
            .map(v => charset[v % charset.length])
            .join('');
    }

    /**
     * Calculate SHA-256 hash of data
     */
    async hash(data: ArrayBuffer): Promise<ArrayBuffer> {
        return window.crypto.subtle.digest('SHA-256', data);
    }

    /**
     * Calculate SHA-256 hash and return as hex string
     */
    async hashToHex(data: ArrayBuffer): Promise<string> {
        const hashBuffer = await this.hash(data);
        return this.arrayBufferToHex(hashBuffer);
    }

    /**
     * Verify data integrity by comparing hashes
     */
    async verifyHash(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
        const actualHash = await this.hashToHex(data);
        return actualHash === expectedHash;
    }

    // ============================================
    // SERIALIZATION HELPERS
    // ============================================

    /**
     * Serialize encryption result for storage/transfer
     */
    serializeEncryptionResult(result: EncryptionResult): string {
        return JSON.stringify({
            ciphertext: this.arrayBufferToBase64(result.ciphertext),
            iv: this.uint8ArrayToBase64(result.iv),
            salt: this.uint8ArrayToBase64(result.salt),
            algorithm: result.algorithm,
            keyLength: result.keyLength,
        });
    }

    /**
     * Deserialize encryption result
     */
    deserializeEncryptionResult(json: string): EncryptionResult {
        const obj = JSON.parse(json);
        
        return {
            ciphertext: this.base64ToArrayBuffer(obj.ciphertext),
            iv: this.base64ToUint8Array(obj.iv),
            salt: this.base64ToUint8Array(obj.salt),
            algorithm: obj.algorithm,
            keyLength: obj.keyLength,
        };
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    private uint8ArrayToBase64(arr: Uint8Array): string {
        return this.arrayBufferToBase64(arr.buffer);
    }

    private base64ToUint8Array(base64: string): Uint8Array {
        return new Uint8Array(this.base64ToArrayBuffer(base64));
    }

    private arrayBufferToHex(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    private log(message: string, ...args: unknown[]): void {
        if (this.debug) {
            console.log(`[CryptoService] ${message}`, ...args);
        }
    }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let serviceInstance: CryptoService | null = null;

export function getCryptoService(debug?: boolean): CryptoService {
    if (!serviceInstance) {
        serviceInstance = new CryptoService(debug);
    }
    return serviceInstance;
}

export function destroyCryptoService(): void {
    serviceInstance = null;
}

export default CryptoService;
