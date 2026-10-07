import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { processMercadoPagoWebhook } from "../payments/mercadopago";
import { checkDatabase } from "../db";

async function startServer() {
  const app = express();
  const server = createServer(app);
  const webhookHits = new Map<string, number[]>();

  app.post("/api/mercadopago/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const recent = (webhookHits.get(ip) || []).filter(timestamp => now - timestamp < 60_000);
    if (recent.length >= 60) return res.status(429).json({ ok: false });
    recent.push(now);
    webhookHits.set(ip, recent);
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body || {});
    let body: unknown = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return res.status(400).json({ ok: false }); }
    const result = await processMercadoPagoWebhook({ body, headers: req.headers, query: req.query }, rawBody);
    return res.status(result.status).json({ ok: result.ok, result: result.result });
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.get("/api/health", async (_req, res) => {
    const ready = await checkDatabase();
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "degraded" });
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  if (process.env.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error("Server startup failed:", error); process.exit(1); });
