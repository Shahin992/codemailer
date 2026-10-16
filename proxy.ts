import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

// Paths that work without the dashboard login. They check their own key, secret or signed token.
const PUBLIC_PATHS = [
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
  /^\/api\/v1\//,
  /^\/api\/cron\//,
  /^\/api\/unsubscribe\//,
  /^\/u\//,
  /^\/t\//,
  /^\/offline\.html$/,
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => p.test(pathname))) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next internals and static PWA files.
  matcher: ["/((?!_next/|icons/|brand/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|robots\\.txt).*)"],
};
