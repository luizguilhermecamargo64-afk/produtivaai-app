import { describe, expect, it } from "vitest";
import { hashPassword, normalizeEmail, toPublicUser, verifyPassword } from "./local";

describe("local authentication", () => {
  it("normalizes emails and verifies scrypt passwords", () => {
    const encoded = hashPassword("senha-segura-123");
    expect(normalizeEmail("  Pessoa@Exemplo.COM ")).toBe("pessoa@exemplo.com");
    expect(encoded.passwordHash).toHaveLength(128);
    expect(encoded.passwordSalt).toHaveLength(64);
    expect(verifyPassword("senha-segura-123", encoded.passwordHash, encoded.passwordSalt)).toBe(true);
    expect(verifyPassword("senha-errada", encoded.passwordHash, encoded.passwordSalt)).toBe(false);
  });

  it("does not expose the password hash in the authenticated user payload", () => {
    const safe = toPublicUser({ id: 1, openId: "local_test", name: "Pessoa", email: "pessoa@exemplo.com", passwordHash: "private", passwordSalt: "private", loginMethod: "email", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });
    expect(safe).not.toHaveProperty("passwordHash");
    expect(safe).not.toHaveProperty("passwordSalt");
    expect(safe.email).toBe("pessoa@exemplo.com");
  });
});
