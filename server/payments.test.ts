import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { processMercadoPagoWebhook, verifyMercadoPagoSignature } from "./payments/mercadopago";

afterEach(() => {
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  delete process.env.MERCADOPAGO_ACCESS_TOKEN;
});

describe("Mercado Pago webhook", () => {
  it("accepts a valid HMAC signature built from id, request id and timestamp", () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";
    const dataId = "123456";
    const requestId = "request-abc";
    const ts = "1710000000";
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const signature = crypto.createHmac("sha256", "test-secret").update(manifest).digest("hex");
    const result = verifyMercadoPagoSignature({ body: { data: { id: dataId } }, headers: { "x-signature": `ts=${ts},v1=${signature}`, "x-request-id": requestId }, query: {} }, "{}");
    expect(result).toMatchObject({ valid: true, reason: "ok", dataId });
  });

  it("rejects a tampered signature without processing payment data", async () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "test-secret";
    const input = { body: { id: "event-1", data: { id: "123456" } }, headers: { "x-signature": "ts=1710000000,v1=not-valid", "x-request-id": "request-abc" }, query: {} };
    const result = await processMercadoPagoWebhook(input, JSON.stringify(input.body));
    expect(result).toEqual({ ok: false, status: 401, result: "signature_invalid" });
  });

  it("fails closed when the webhook secret is not configured", async () => {
    const input = { body: { id: "event-2", data: { id: "123456" } }, headers: {}, query: {} };
    const result = await processMercadoPagoWebhook(input, JSON.stringify(input.body));
    expect(result).toEqual({ ok: false, status: 503, result: "secret_missing" });
  });
});
