import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createComponentLogger } from '../lib/logger';

const logger = createComponentLogger('auth');

// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                orgId: string | null;
                roles: string[];
            };
        }
    }
}

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        res.status(401).json({ error: 'No authorization header provided' });
        return;
    }

    const token = authHeader
        .split(',')
        .map((s) => s.trim())
        .find((s) => s.startsWith('Bearer '))
        ?.split(' ')[1];

    if (!token) {
        res.status(401).json({ error: 'No bearer token found' });
        return;
    }

    try {
        const decoded = jwt.decode(token);

        if (!decoded || typeof decoded !== 'object') {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }

        // Extract userId: prefer preferred_username (Keycloak/OAuth2-Proxy user tokens),
        // fall back to sub (service-account / machine-to-machine tokens).
        const username = (decoded as any).preferred_username || (decoded as any).sub;

        if (!username) {
            res.status(401).json({ error: 'Token missing preferred_username and sub' });
            return;
        }

        const orgId: string | null =
            (decoded as any).org_id ||
            (req.headers['x-auth-request-org'] as string) ||
            null;

        const roles: string[] =
            (decoded as any).realm_access?.roles ||
            (req.headers['x-auth-request-roles'] as string || '').split(',').filter(Boolean);

        req.user = {
            id: username,
            orgId,
            roles,
        };

        next();
    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Auth middleware error');
        res.status(401).json({ error: 'Authentication failed' });
        return;
    }
};

/**
 * Middleware: require at least one of the specified roles.
 * Pass no roles to require only a valid token (any authenticated user).
 * Must be used after `authenticate` so req.user is already set.
 */
export const requireRoles = (...allowed: string[]) =>
    (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No authorization header provided' });
        }
        const roles: string[] = req.user.roles || [];
        if (allowed.length > 0 && !roles.some((r) => allowed.includes(r))) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
