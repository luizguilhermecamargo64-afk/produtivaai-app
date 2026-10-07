import type {
  CookieOptions,
  Request,
} from "express";

export function getSessionCookieOptions(
  req: Request
): CookieOptions {
  const forwardedProto =
    req.headers["x-forwarded-proto"];

  const isHttps =
    req.protocol === "https" ||
    forwardedProto === "https" ||
    (Array.isArray(forwardedProto) && forwardedProto.includes("https"));

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? "none" : "lax",
    path: "/",
  };
}
