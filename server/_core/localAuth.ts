import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { parse as parseCookieHeader } from "cookie";
import { jwtVerify, SignJWT } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";

const SESSION_SECRET = process.env.APP_SESSION_SECRET || process.env.MANUS_JWT_SECRET;
const secretKey = new TextEncoder().encode(SESSION_SECRET || "development-only-secret-change-me");

export const LOCAL_PASSWORD_MIN_LENGTH = 8;
export const LOCAL_PASSWORD_MAX_LENGTH = 128;

export function normalizeEmailForAuth(email: string) {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string, salt?: string) {
  const passwordSalt = salt || randomBytes(32).toString("hex");
  const passwordHash = scryptSync(password, passwordSalt, 64).toString("hex");
  return { passwordHash, passwordSalt };
}

export function verifyPassword(password: string, passwordHash: string | null | undefined, passwordSalt: string | null | undefined) {
  if (!passwordHash || !passwordSalt || passwordHash.length !== 128 || passwordSalt.length !== 64) return false;
  const calculatedHash = scryptSync(password, passwordSalt, 64);
  const storedHash = Buffer.from(passwordHash, "hex");
  return storedHash.length === calculatedHash.length && timingSafeEqual(storedHash, calculatedHash);
}

export async function createLocalSession(user: User) {
  return new SignJWT({ userId: user.id, email: user.email, name: user.name || "", authType: "local" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .sign(secretKey);
}

export async function verifyLocalSession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    if (payload.authType !== "local" || typeof payload.userId !== "number" || !Number.isInteger(payload.userId) || payload.userId <= 0) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function authenticateLocalRequest(req: Request): Promise<User | null> {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const cookieToken = cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  const token = cookieToken || (typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined);
  const session = await verifyLocalSession(token);
  if (!session) return null;
  return (await db.getUserById(session.userId)) || null;
}

export function setLocalSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
}

export function clearLocalSessionCookie(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
}
