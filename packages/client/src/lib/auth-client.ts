/**
 * Auth Client for PrivShare
 * API client for authentication endpoints
 */

import { useAuthStore, User, AuthSession } from '../store/authStore';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface AuthResponse {
  success?: boolean;
  user?: User;
  session?: AuthSession;
  token?: string;
  error?: string;
  message?: string;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
}

interface LoginData {
  email: string;
  password: string;
}

class AuthClient {
  private getHeaders(token?: string): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const storedToken = token || useAuthStore.getState().token;
    if (storedToken) {
      headers['Authorization'] = `Bearer ${storedToken}`;
    }

    return headers;
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || 'Registration failed' };
      }

      if (result.token) {
        useAuthStore.getState().login(result.user, result.session || { id: 'temp', expiresAt: '' }, result.token);
      }

      return result;
    } catch (error) {
      console.error('Register error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * Login with email and password
   */
  async login(data: LoginData): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        return { error: result.message || result.error || 'Login failed' };
      }

      if (result.token && result.user) {
        useAuthStore.getState().login(
          result.user,
          result.session || { id: 'temp', expiresAt: '' },
          result.token
        );
      }

      return result;
    } catch (error) {
      console.error('Login error:', error);
      return { error: 'Network error. Please try again.' };
    }
  }

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/api/auth/sign-out`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      useAuthStore.getState().logout();
    }
  }

  /**
   * Get current user info
   */
  async getMe(): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 401) {
          useAuthStore.getState().logout();
        }
        return { error: 'Not authenticated' };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Get me error:', error);
      return { error: 'Network error' };
    }
  }

  /**
   * Verify token validity
   */
  async verifyToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: this.getHeaders(),
      });

      return response.ok;
    } catch (error) {
      console.error('Verify token error:', error);
      return false;
    }
  }

  /**
   * Get development token (only in development)
   */
  async getDevToken(): Promise<AuthResponse> {
    if (import.meta.env.PROD) {
      return { error: 'Not available in production' };
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/dev-token`);
      const result = await response.json();

      if (result.token && result.credentials) {
        useAuthStore.getState().login(
          { id: 'test-user-id', email: result.credentials.email, name: 'Test User', emailVerified: false },
          { id: 'dev-session', expiresAt: new Date(Date.now() + 86400000).toISOString() },
          result.token
        );
      }

      return result;
    } catch (error) {
      console.error('Dev token error:', error);
      return { error: 'Network error' };
    }
  }
}

export const authClient = new AuthClient();
export default authClient;
