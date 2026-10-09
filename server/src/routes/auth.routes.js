import express from "express";
import passport from "passport";
import authMiddleware from "../middleware/auth.middleware.js";
import { env } from "../config/env.js";
import { authLimiter } from "../middleware/rateLimiter.middleware.js";
import { YT_SCOPES } from "../config/constants.js";

const router = express.Router();

// ─── Google OAuth login ─────────────────────────────────────────────────────
router
  .route("/google")
  .get(authLimiter, passport.authenticate('google', {
      scope: YT_SCOPES,
      accessType: 'offline',
      prompt: 'consent',
  }));

// ─── Google OAuth callback ──────────────────────────────────────────────────
router
  .route("/google/callback")
  .get(
      passport.authenticate('google', {
          failureRedirect: `${env.CLIENT_URL}/?error=oauth`
      }),
      (req, res, next) => {
          // Regenerate session after login to prevent session fixation attacks
          const user = req.user;
          req.session.regenerate((err) => {
              if (err) return next(err);
              // Re-attach the user to the regenerated session
              req.session.passport = { user: user._id.toString() };
              req.session.save((err) => {
                  if (err) return next(err);
                  res.redirect(`${env.CLIENT_URL}/dashboard`);
              });
          });
      }
  );

// ─── Get current user ───────────────────────────────────────────────────────
router.route("/user").get(authMiddleware, (req, res) => {
    res.json({ data: req.user });
});

// ─── Logout ─────────────────────────────────────────────────────────────────
router.route("/logout").post(authMiddleware, (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);

        req.session.destroy((err) => {
            if (err) return next(err);

            res.clearCookie('sid', {
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                secure: env.NODE_ENV === 'production',
            });
            res.json({ message: 'Logged Out Successfully' });
        });
    });
});

export default router;