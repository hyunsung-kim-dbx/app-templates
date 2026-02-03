import type { Request, Response, NextFunction } from 'express';
import { getAuthSession, type AuthSession } from '@chat-template/auth';
import { checkChatAccess } from '@chat-template/core';
import { ChatSDKError } from '@chat-template/core/errors';

// Extend Express Request type to include session and OBO token
declare global {
  namespace Express {
    interface Request {
      session?: AuthSession;
      userAccessToken?: string;
      userEmail?: string;
    }
  }
}

/**
 * Middleware to authenticate requests and attach session to request object
 * Also extracts user's access token for OBO (On-Behalf-Of) operations
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const session = await getAuthSession({
      getRequestHeader: (name: string) =>
        req.headers[name.toLowerCase()] as string | null,
    });
    req.session = session || undefined;

    // Extract user's access token and email for OBO operations
    // These headers are provided by Databricks Apps when OBO is enabled
    const userAccessToken = req.headers['x-forwarded-access-token'] as string | undefined;
    const userEmail = req.headers['x-forwarded-email'] as string | undefined;

    if (userAccessToken) {
      req.userAccessToken = userAccessToken;
      req.userEmail = userEmail;
      const tokenPreview = userAccessToken.length > 20
        ? `${userAccessToken.substring(0, 10)}...${userAccessToken.substring(userAccessToken.length - 10)}`
        : '***SHORT***';
      console.log(`[Auth] User access token received for OBO operations - Token: ${tokenPreview}, Length: ${userAccessToken.length}, Email: ${userEmail}`);
    } else {
      console.log('[Auth] No X-Forwarded-Access-Token header found (not using OBO)');
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    next(error);
  }
}

/**
 * Middleware to require authentication - returns 401 if no session
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    const response = new ChatSDKError('unauthorized:chat').toResponse();
    return res.status(response.status).json(response.json);
  }
  next();
}

export async function requireChatAccess(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const id = getIdFromRequest(req);
  if (!id) {
    console.error(
      'Chat access middleware error: no chat ID provided',
      req.params,
    );
    const error = new ChatSDKError('bad_request:api');
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  const { allowed, reason } = await checkChatAccess(id, req.session?.user.id);
  if (!allowed) {
    console.error(
      'Chat access middleware error: user does not have access to chat',
      reason,
    );
    const error = new ChatSDKError('forbidden:chat', reason);
    const response = error.toResponse();
    return res.status(response.status).json(response.json);
  }
  next();
}

export const getIdFromRequest = (req: Request): string | undefined => {
  const { id } = req.params;
  if (!id) return undefined;
  return typeof id === 'string' ? id : id[0];
};