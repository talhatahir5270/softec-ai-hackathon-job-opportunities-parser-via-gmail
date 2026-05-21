import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "khushpush_auth";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/robots")) return true;
  if (pathname.startsWith("/sitemap")) return true;
  if (pathname.startsWith("/khushPush_logo")) return true;
  return false;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isAuthed = req.cookies.get(AUTH_COOKIE)?.value === "1";

  if (isPublicPath(pathname)) {
    if (pathname === "/login" && isAuthed) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (!isAuthed) {
    const nextValue = `${pathname}${search}`;
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", nextValue);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};

