import { NextResponse } from "next/server";

import { createSession, sessionCookie, type AuthUser } from "@/lib/auth/session";

interface GoogleUser {
  sub: string;
  name?: string;
  email?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/?auth=failed", request.url));
  }

  const callback = process.env.GOOGLE_REDIRECT_URI || new URL("/api/auth/google/callback", request.url).toString();
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callback,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/?auth=failed", request.url));

  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return NextResponse.redirect(new URL("/?auth=failed", request.url));

  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
  });
  if (!userResponse.ok) return NextResponse.redirect(new URL("/?auth=failed", request.url));

  const googleUser = await userResponse.json() as GoogleUser;
  if (!googleUser.sub || !googleUser.email) return NextResponse.redirect(new URL("/?auth=failed", request.url));
  const user: AuthUser = {
    id: googleUser.sub,
    name: googleUser.name || googleUser.email.split("@")[0],
    email: googleUser.email,
  };

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(sessionCookie.name, createSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionCookie.maxAge,
    path: "/",
  });
  return response;
}
