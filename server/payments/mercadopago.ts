import crypto from "node:crypto";
import * as db from "../db";

export type MercadoPagoWebhookInput = {
  body: any;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, any>;
};

function header(headers: MercadoPagoWebhookInput["headers"], name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function extractSignature(value: string | undefined) {
  const parts = new Map((value || "").split(",").map(part => part.trim().split("=", 2) as [string, string]));
  return { ts: parts.get("ts"), v1: parts.get("v1") };
}

export function verifyMercadoPagoSignature(input: MercadoPagoWebhookInput, rawBody: string) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return { valid: false, reason: "secret_missing" as const };
  const signature = extractSignature(header(input.headers, "x-signature"));
  const requestId = header(input.headers, "x-request-id") || "";
  const dataId = input.query?.["data.id"] || input.query?.data_id || input.body?.data?.id || input.body?.id || "";
  if (!signature.ts || !signature.v1 || !dataId) return { valid: false, reason: "signature_headers_missing" as const };
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${signature.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const valid = expected.length === signature.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.v1));
  return { valid, reason: valid ? "ok" as const : "signature_invalid" as const, dataId: String(dataId) };
}

async function fetchMercadoPago(path: string) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN is not configured");
  const response = await fetch(`https://api.mercadopago.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`Mercado Pago API returned ${response.status}`);
  return data;
}

function resolveIdentity(payment: any) {
  const metadata = payment?.metadata || {};
  const external = payment?.external_reference || metadata.external_reference || "";
  const userId = Number(metadata.user_id || metadata.userId || String(external).match(/user[_-]?(\d+)/i)?.[1] || 0);
  const planCode = String(metadata.plan_code || metadata.planCode || String(external).match(/plan[_-]?([A-Z]+)/i)?.[1] || "").toUpperCase();
  return { userId: Number.isInteger(userId) && userId > 0 ? userId : null, planCode: planCode === "PRO" || planCode === "BUSINESS" ? planCode : null };
}

export async function processMercadoPagoWebhook(input: MercadoPagoWebhookInput, rawBody: string) {
  const verification = verifyMercadoPagoSignature(input, rawBody);
  const eventId = String(input.body?.id || input.query?.id || input.query?.["data.id"] || crypto.createHash("sha256").update(rawBody).digest("hex"));
  const eventType = String(input.body?.type || input.body?.action || "unknown");
  if (!verification.valid) {
    return { ok: false, status: verification.reason === "secret_missing" ? 503 : 401, result: verification.reason };
  }
  const duplicate = await db.findSubscriptionEvent(eventId);
  if (duplicate) return { ok: true, status: 200, result: "duplicate" };
  const claimed = await db.claimSubscriptionEvent({ eventId, provider: "mercadopago", eventType, externalPaymentId: verification.dataId, status: "processing", planCode: null, userId: null, processingResult: "processing" });
  if (!claimed) return { ok: true, status: 200, result: "duplicate" };
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
    await db.recordSubscriptionEvent({ eventId, provider: "mercadopago", eventType, externalPaymentId: verification.dataId, status: "unknown", planCode: null, userId: null, processingResult: "credentials_missing" });
    return { ok: false, status: 503, result: "credentials_missing" };
  }
  try {
    const payment = await fetchMercadoPago(`/v1/payments/${verification.dataId}`);
    const identity = resolveIdentity(payment);
    const paymentStatus = String(payment?.status || "unknown");
    const approved = paymentStatus === "approved";
    if (!identity.userId || !identity.planCode) {
      await db.recordSubscriptionEvent({ eventId, provider: "mercadopago", eventType, externalPaymentId: verification.dataId, status: paymentStatus, planCode: identity.planCode, userId: identity.userId, processingResult: "identity_unresolved" });
      return { ok: true, status: 200, result: "identity_unresolved" };
    }
    const user = await db.getUserById(identity.userId);
    const plan = await db.getPlanByCode(identity.planCode);
    if (!user || !plan) {
      await db.recordSubscriptionEvent({ eventId, provider: "mercadopago", eventType, externalPaymentId: verification.dataId, status: paymentStatus, planCode: identity.planCode, userId: identity.userId, processingResult: "user_or_plan_not_found" });
      return { ok: true, status: 200, result: "user_or_plan_not_found" };
    }
    if (approved) {
      await db.activateSubscription(identity.userId, plan.id, String(payment.id || verification.dataId), payment?.metadata?.subscription_id);
    }
    await db.recordSubscriptionEvent({ eventId, provider: "mercadopago", eventType, externalPaymentId: verification.dataId, status: paymentStatus, planCode: identity.planCode, userId: identity.userId, processingResult: approved ? "activated" : "not_activated" });
    return { ok: true, status: 200, result: approved ? "activated" : "not_activated" };
  } catch (error) {
    console.error("[MercadoPago] webhook processing failed", error instanceof Error ? error.message : "unknown");
    await db.recordSubscriptionEvent({ eventId, provider: "mercadopago", eventType, externalPaymentId: verification.dataId, status: "error", planCode: null, userId: null, processingResult: "processing_error" });
    return { ok: false, status: 503, result: "processing_error" };
  }
}
