import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

const COOKIE_NAME = "trip-globe-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return value;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSession(user: AuthUser) {
  const payload = encode(JSON.stringify(user));
  return `${payload}.${sign(payload)}`;
}

export function readSession(value: string | undefined): AuthUser | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthUser;
    if (!user.id || !user.name || !user.email) return null;
    return user;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_MAX_AGE,
};
