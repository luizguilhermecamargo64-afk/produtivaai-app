import { describe, expect, it } from "vitest";
import { buildToolTurns } from "./ai";

describe("AI tool prompts", () => {
  it("keeps the operation instruction in a system turn and limits user content", () => {
    const result = buildToolTurns("summarize", "conteúdo de teste", "projeto de estudos");
    expect(result[0]).toMatchObject({ role: "system" });
    expect(result[0]?.content).toContain("Resuma o conteúdo");
    expect(result[1]).toMatchObject({ role: "system", content: "Contexto do espaço de trabalho: projeto de estudos" });
    expect(result[2]).toEqual({ role: "user", content: "conteúdo de teste" });
  });

  it("falls back to a safe explanation instruction for unknown tools", () => {
    const result = buildToolTurns("unknown-tool", "texto");
    expect(result[0]?.content).toContain("Explique de modo didático");
  });
});
