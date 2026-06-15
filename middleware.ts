import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/login", "/api/health", "/_next", "/favicon"];

export function middleware(req: NextRequest) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return NextResponse.next(); // auth disabled when no token set

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cookie = req.cookies.get("nestiq_auth")?.value;
  if (cookie === token) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
