import type { Request, Response, NextFunction } from "express";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;
const rateLimitStore: Record<string, { count: number; resetAt: number }> = {};

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitStore[ip];

  if (!entry || now > entry.resetAt) {
    rateLimitStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "Rate limit excedido. Tente novamente em 1 minuto." });
  }
  next();
}

export function startRateLimitPurge() {
  setInterval(() => {
    const now = Date.now();
    for (const ip of Object.keys(rateLimitStore)) {
      if (now > rateLimitStore[ip].resetAt) delete rateLimitStore[ip];
    }
  }, 5 * 60 * 1000);
}
