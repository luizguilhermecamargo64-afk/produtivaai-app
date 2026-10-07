import { TRPCError } from "@trpc/server";

const DEFAULT_MODEL = process.env.AI_MODEL || "";
const MAX_CONTEXT_MESSAGES = 24;
const REQUEST_TIMEOUT_MS = 45_000;
const recentRequests = new Map<number, number[]>();

export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };
export type AiResult = { content: string; model: string; tokensInput?: number; tokensOutput?: number };

function providerConfig() {
  const provider = process.env.AI_PROVIDER || "manus";
  const baseUrl = provider === "openai" ? (process.env.OPENAI_API_BASE || process.env.AI_API_URL) : (process.env.MANUS_API_URL || process.env.AI_API_URL);
  const apiKey = provider === "openai" ? (process.env.OPENAI_API_KEY || process.env.AI_API_KEY) : (process.env.MANUS_API_KEY || process.env.AI_API_KEY);
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  return { provider, baseUrl: baseUrl?.replace(/\/$/, ""), apiKey, model };
}

function assertRateLimit(userId: number) {
  const now = Date.now();
  const recent = (recentRequests.get(userId) || []).filter(timestamp => now - timestamp < 60_000);
  if (recent.length >= 20) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas solicitações em pouco tempo. Aguarde um minuto e tente novamente." });
  }
  recent.push(now);
  recentRequests.set(userId, recent);
}

export async function callAI(userId: number, turns: ChatTurn[], options?: { model?: string; signal?: AbortSignal; temperature?: number }) : Promise<AiResult> {
  assertRateLimit(userId);
  const { baseUrl, apiKey, model } = providerConfig();
  if (!baseUrl || !apiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A IA ainda não está configurada neste ambiente. Configure o serviço LLM para continuar." });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options?.model || model || undefined, messages: turns.slice(-MAX_CONTEXT_MESSAGES), temperature: options?.temperature ?? 0.35, stream: false }),
      signal,
    });
    const raw = await response.text();
    let payload: any = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!response.ok || payload?.error) {
      const message = payload?.error?.message || `O provedor de IA respondeu com HTTP ${response.status}.`;
      const code = response.status === 429 ? "TOO_MANY_REQUESTS" : response.status >= 500 ? "TIMEOUT" : "BAD_REQUEST";
      throw new TRPCError({ code: code as any, message });
    }
    const content = typeof payload?.choices?.[0]?.message?.content === "string" ? payload.choices[0].message.content.trim() : "";
    if (!content) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "A IA retornou uma resposta vazia. Tente novamente." });
    return {
      content,
      model: payload?.model || options?.model || model || "default",
      tokensInput: Number.isFinite(payload?.usage?.prompt_tokens) ? payload.usage.prompt_tokens : undefined,
      tokensOutput: Number.isFinite(payload?.usage?.completion_tokens) ? payload.usage.completion_tokens : undefined,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TRPCError({ code: "TIMEOUT", message: "A geração demorou demais. Sua mensagem foi mantida; tente novamente." });
    }
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Não foi possível falar com a IA agora. Tente novamente em instantes." });
  } finally {
    clearTimeout(timeout);
  }
}

const toolInstructions: Record<string, string> = {
  summarize: "Resuma o conteúdo com clareza. Preserve fatos, números e contexto; use títulos e bullets quando ajudarem.",
  analyze: "Analise o conteúdo de forma crítica, identifique pontos principais, riscos, lacunas e próximos passos.",
  explain: "Explique de modo didático, começando pelo essencial e depois aprofundando com exemplos concretos.",
  improve: "Melhore clareza, gramática, estrutura e objetividade, preservando a intenção e o tom do texto.",
  ideas: "Gere ideias práticas e variadas, organizadas por impacto e esforço, sem inventar dados externos.",
  plan: "Transforme o conteúdo em um plano executável com objetivo, etapas, dependências e próximos passos.",
  rewrite: "Reescreva o texto no tom solicitado, mantendo os fatos e entregando uma versão pronta para uso.",
  study: "Atue como tutor: explique passo a passo, faça conexões e indique como verificar o entendimento.",
  work: "Atue como parceiro de trabalho: entregue uma saída pronta, objetiva, profissional e acionável.",
};

export function buildToolTurns(tool: string, input: string, context?: string): ChatTurn[] {
  const instruction = toolInstructions[tool] || toolInstructions.explain;
  return [
    { role: "system", content: `Você é o ProdutivaAI, uma inteligência artificial de produtividade. ${instruction} Não invente fatos, fontes ou ações realizadas. Responda em português do Brasil, a menos que o usuário peça outro idioma.` },
    ...(context ? [{ role: "system" as const, content: `Contexto do espaço de trabalho: ${context.slice(0, 4000)}` }] : []),
    { role: "user", content: input.slice(0, 30_000) },
  ];
}
