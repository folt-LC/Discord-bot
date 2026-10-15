import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  GetBotDashboardSessionResponse,
  GetBotConnectionResponse,
  GetBotLogsResponse,
  GetManagedBotStatusResponse,
  GetBotUsageResponse,
  LoginBotDashboardBody,
  LoginBotDashboardResponse,
  LogoutBotDashboardResponse,
  StartManagedBotResponse,
  StopManagedBotResponse,
} from "@workspace/api-zod";
import { botProcessManager } from "../lib/bot-manager";

const router: IRouter = Router();
const COOKIE_NAME = "bot_dashboard_session";
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;

interface LoginAttempt {
  count: number;
  resetAt: number;
  blockedUntil: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

function getSessionSecret(): string | null {
  return process.env.SESSION_SECRET || null;
}

function createSessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function getCookieValue(request: Request, cookieName: string): string | null {
  const cookieHeader = request.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === cookieName) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function hasValidSession(request: Request): boolean {
  const secret = getSessionSecret();
  const cookieValue = getCookieValue(request, COOKIE_NAME);
  if (!secret || !cookieValue) return false;

  const [expiryValue, nonce, providedSignature, ...extra] =
    cookieValue.split(".");
  if (!expiryValue || !nonce || !providedSignature || extra.length) {
    return false;
  }

  const expiresAt = Number(expiryValue);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    expiresAt > Date.now() + SESSION_LIFETIME_MS + 60_000
  ) {
    return false;
  }

  const payload = `${expiryValue}.${nonce}`;
  const expectedSignature = createSessionSignature(payload, secret);
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function setSessionCookie(request: Request, response: Response): void {
  const secret = getSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured.");

  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${expiresAt}.${nonce}`;
  const signature = createSessionSignature(payload, secret);
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0];
  const secure =
    request.secure ||
    forwardedProtocol === "https" ||
    process.env.NODE_ENV === "production";

  response.cookie(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/api/bot-control",
    maxAge: SESSION_LIFETIME_MS,
  });
}

function clearSessionCookie(request: Request, response: Response): void {
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0];
  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure:
      request.secure ||
      forwardedProtocol === "https" ||
      process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/bot-control",
  });
}

function sameOriginOnly(
  request: Request,
  response: Response,
  next: (error?: unknown) => void,
): void {
  const origin = request.get("origin");
  if (!origin) {
    next();
    return;
  }

  const forwardedHost = request.get("x-forwarded-host")?.split(",")[0].trim();
  const expectedHost = forwardedHost || request.get("host");
  try {
    if (expectedHost && new URL(origin).host === expectedHost) {
      next();
      return;
    }
  } catch {
    // Reject malformed origins below.
  }

  response.status(403).json({ error: "Cross-origin requests are not allowed." });
}

function requireDashboardSession(
  request: Request,
  response: Response,
  next: (error?: unknown) => void,
): void {
  if (!hasValidSession(request)) {
    response.status(401).json({ error: "Dashboard authentication required." });
    return;
  }
  next();
}

function getLoginAttempt(ipAddress: string): LoginAttempt {
  const now = Date.now();
  const existing = loginAttempts.get(ipAddress);
  if (!existing || existing.resetAt <= now) {
    const freshAttempt = {
      count: 0,
      resetAt: now + LOGIN_WINDOW_MS,
      blockedUntil: 0,
    };
    loginAttempts.set(ipAddress, freshAttempt);
    return freshAttempt;
  }
  return existing;
}

function passwordsMatch(supplied: string, configured: string): boolean {
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(suppliedHash, configuredHash);
}

router.get("/bot-control/session", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json(
    GetBotDashboardSessionResponse.parse({
      authenticated: Boolean(
        process.env.BOT_DASHBOARD_PASSWORD && hasValidSession(request),
      ),
    }),
  );
});

router.post(
  "/bot-control/session",
  (request, response, next) => sameOriginOnly(request, response, next),
  (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const input = LoginBotDashboardBody.safeParse(request.body);
    if (!input.success) {
      response.status(400).json({ error: "Enter the dashboard password." });
      return;
    }

    const password = process.env.BOT_DASHBOARD_PASSWORD;
    const sessionSecret = getSessionSecret();
    if (!password || !sessionSecret) {
      response.status(503).json({
        error: "Dashboard password or session secret is not configured.",
      });
      return;
    }

    const attempt = getLoginAttempt(request.ip || "unknown");
    if (attempt.blockedUntil > Date.now()) {
      response.status(429).json({
        error: "Too many failed attempts. Try again in 15 minutes.",
      });
      return;
    }

    if (!passwordsMatch(input.data.password, password)) {
      attempt.count += 1;
      if (attempt.count >= MAX_FAILED_LOGINS) {
        attempt.blockedUntil = Date.now() + LOGIN_WINDOW_MS;
      }
      request.log.warn(
        { failedAttempts: attempt.count },
        "Bot dashboard login rejected",
      );
      response.status(401).json({ error: "Incorrect dashboard password." });
      return;
    }

    loginAttempts.delete(request.ip || "unknown");
    setSessionCookie(request, response);
    response.json(LoginBotDashboardResponse.parse({ authenticated: true }));
  },
);

router.delete(
  "/bot-control/session",
  (request, response, next) => sameOriginOnly(request, response, next),
  (request, response) => {
    clearSessionCookie(request, response);
    response.json(LogoutBotDashboardResponse.parse({ authenticated: false }));
  },
);

router.get(
  "/bot-control/status",
  requireDashboardSession,
  (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(
      GetManagedBotStatusResponse.parse(botProcessManager.getStatus()),
    );
  },
);

router.post(
  "/bot-control/start",
  (request, response, next) => sameOriginOnly(request, response, next),
  requireDashboardSession,
  async (_request, response): Promise<void> => {
    const status = await botProcessManager.start();
    response.setHeader("Cache-Control", "no-store");
    response.json(StartManagedBotResponse.parse(status));
  },
);

router.post(
  "/bot-control/stop",
  (request, response, next) => sameOriginOnly(request, response, next),
  requireDashboardSession,
  async (_request, response): Promise<void> => {
    const status = await botProcessManager.stop();
    response.setHeader("Cache-Control", "no-store");
    response.json(StopManagedBotResponse.parse(status));
  },
);

router.get(
  "/bot-control/logs",
  requireDashboardSession,
  (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(GetBotLogsResponse.parse(botProcessManager.getLogs()));
  },
);

router.get(
  "/bot-control/connection",
  requireDashboardSession,
  (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(
      GetBotConnectionResponse.parse(botProcessManager.getConnectionInfo()),
    );
  },
);

router.get(
  "/bot-control/usage",
  requireDashboardSession,
  (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(GetBotUsageResponse.parse(botProcessManager.getUsage()));
  },
);

export default router;
