import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected) return NextResponse.json({ ok: true }); // auth disabled

  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token || token !== expected) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const res = NextResponse.json({ ok: true, redirect: next });
  res.cookies.set("nestiq_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
