import { env } from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * CSRF protection via Origin/Referer header verification.
 * 
 * Applies to state-changing methods (POST, PUT, PATCH, DELETE).
 * Verifies that the request originates from an allowed origin.
 * 
 * Note: This works because:
 * - Browsers always send Origin/Referer on cross-origin requests
 * - Attackers cannot spoof these headers from a browser
 * - Combined with sameSite='lax' cookies, this provides strong CSRF protection
 */
export default function csrfProtection(req, res, next) {
    // Only check state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const origin = req.get('Origin') || req.get('Referer');

    if (!origin) {
        // No origin header — likely a server-to-server or non-browser request.
        // For APIs consumed only by browsers, you can reject these.
        // For now, allow them since the session cookie + sameSite='lax' already
        // prevents cross-origin form POSTs.
        return next();
    }

    try {
        const requestOrigin = new URL(origin).origin;
        const allowedOrigins = new Set(
            Array.isArray(env.CORS_WHITELIST) ? env.CORS_WHITELIST : [env.CORS_WHITELIST]
        );
        // Also allow the CLIENT_URL origin
        allowedOrigins.add(new URL(env.CLIENT_URL).origin);

        if (allowedOrigins.has(requestOrigin)) {
            return next();
        }
    } catch(err) {
        logger.error("")
    }

    return res.status(403).json({ error: 'Forbidden: invalid origin' });
}
