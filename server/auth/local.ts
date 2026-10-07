export {
  LOCAL_PASSWORD_MAX_LENGTH,
  LOCAL_PASSWORD_MIN_LENGTH,
  hashPassword,
  normalizeEmailForAuth as normalizeEmail,
  verifyPassword,
} from "../_core/localAuth";

import type { User } from "../../drizzle/schema";

export function toPublicUser(user: User) {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...publicUser } = user;
  return publicUser;
}
