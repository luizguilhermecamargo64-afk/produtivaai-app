import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { jwtVerify, SignJWT } from "jose";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { authenticateLocalRequest } from "./localAuth";

export type SessionPayload = {
  userId: number;
  name: string;
  sessionType: "local";
};

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

class SDKServer {
  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) throw new Error("MANUS_JWT_SECRET is unavailable");
    return new TextEncoder().encode(secret);
  }

  async createSessionToken(userId: number, options: { expiresInMs?: number; name?: string } = {}) {
    return this.signSession({ userId, name: options.name || "", sessionType: "local" }, options);
  }

  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    return new SignJWT({ userId: payload.userId, name: payload.name, sessionType: payload.sessionType })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setExpirationTime(expirationSeconds)
      .sign(this.getSessionSecret());
  }

  async verifySession(cookieValue: string | undefined | null): Promise<SessionPayload | null> {
    if (!cookieValue) return null;
    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), { algorithms: ["HS256"] });
      const { userId, name, sessionType } = payload as Record<string, unknown>;
      if (!isPositiveInteger(userId) || typeof name !== "string" || sessionType !== "local") return null;
      return { userId, name, sessionType };
    } catch {
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const user = await authenticateLocalRequest(req);
    if (!user) throw ForbiddenError("Invalid local session");
    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    return (await db.getUserById(user.id)) || user;
  }
}

export const sdk = new SDKServer();
