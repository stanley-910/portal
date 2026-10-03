import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readSession, sessionCookie } from "@/lib/auth/session";

export async function GET() {
  const user = readSession((await cookies()).get(sessionCookie.name)?.value);
  return NextResponse.json({ user });
}
