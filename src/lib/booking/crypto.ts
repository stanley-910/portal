import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Traveller details rest in Supabase sealed with AES-256-GCM, so a leaked table row is noise without the key in
// the server's environment. One short-lived row per rider per leg; the flow deletes them once the order exists.

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/** The 32-byte key from its base64 form. Throws on anything else, so a bad env var fails at boot, not at checkout. */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) throw new Error("BOOKING_ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32).");
  return key;
}

/** `iv.tag.ciphertext`, each base64url. */
export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

/** The plaintext, or null when the token is malformed or was sealed with another key. */
export function open(token: string, key: Buffer): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
