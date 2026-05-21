"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/BrandLogo";
import { clearAuthSession, formatNameFromEmail, getAuthUser, type AuthUser } from "@/lib/auth";

const LINE = "#e8eaed";
const SURFACE = "#f6f8fc";
const TEXT = "#202124";
const MUTED = "#5f6368";

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function initialsFromUser(user: AuthUser | null): string {
  const source = user?.name?.trim() || user?.email || "";
  const parts = source
    .split(/[ @._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function AppNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const items = [
    { href: "/", label: "Home" },
    { href: "/profile", label: "Profile" },
    { href: "/cv", label: "CV import" },
    { href: "/inbox", label: "Inbox" },
  ];

  const isLogin = pathname === "/login" || pathname.startsWith("/login/");
  const pageLabel = isLogin
    ? "Sign in"
    : pathname === "/"
      ? "Landing"
      : pathname === "/profile"
        ? "Student Profile"
        : pathname === "/cv"
          ? "CV → profile"
          : "Workspace";

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    setAuthUser(getAuthUser());
  }, []);

  useEffect(() => {
    const onStorage = () => setAuthUser(getAuthUser());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const userDisplayName = authUser?.name || (authUser?.email ? formatNameFromEmail(authUser.email) : null);
  const userSubtext = authUser?.email ?? null;
  const userInitials = initialsFromUser(authUser);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <header
      className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur-md"
      style={{ borderColor: LINE }}
    >
      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[100] bg-black/30"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            id="app-nav-drawer"
            className="fixed inset-y-0 left-0 z-[101] flex w-[min(280px,88vw)] flex-col border-r bg-white shadow-xl"
            style={{ borderColor: LINE }}
            role="dialog"
            aria-modal="true"
            aria-label="Site navigation"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-3" style={{ borderColor: LINE }}>
              <span className="text-sm font-semibold" style={{ color: TEXT }}>
                Menu
              </span>
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-sm font-medium transition hover:bg-[#f1f3f4]"
                style={{ color: MUTED }}
                onClick={() => setMenuOpen(false)}
              >
                Close
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Main">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-semibold transition hover:bg-[#f1f3f4]"
                  style={
                    pathname === item.href
                      ? { backgroundColor: "#d3e3fd", color: "#001d35" }
                      : { color: TEXT }
                  }
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="border-t p-3" style={{ borderColor: LINE, color: MUTED }}>
              {authUser ? (
                <div className="mb-3 rounded-xl border bg-[#f8f9fa] p-2.5" style={{ borderColor: LINE }}>
                  <div className="flex items-center gap-2.5">
                    {authUser.avatarUrl ? (
                      <Image
                        src={authUser.avatarUrl}
                        alt={userDisplayName ? `${userDisplayName} avatar` : "User avatar"}
                        width={36}
                        height={36}
                        className="size-9 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex size-9 items-center justify-center rounded-full bg-[#d3e3fd] text-xs font-semibold text-[#174ea6]">
                        {userInitials}
                      </div>
                    )}
                    <div className="min-w-0">
                      {userDisplayName ? <p className="truncate text-sm font-semibold text-[#202124]">{userDisplayName}</p> : null}
                      {userSubtext ? <p className="truncate text-xs text-[#5f6368]">{userSubtext}</p> : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {!isLogin ? (
                <button
                  type="button"
                  className="mb-3 w-full rounded-xl border px-4 py-2.5 text-left text-sm font-semibold text-[#5f6368] transition hover:bg-[#f1f3f4]"
                  style={{ borderColor: LINE }}
                  onClick={() => {
                    clearAuthSession();
                    setMenuOpen(false);
                    router.replace("/login");
                  }}
                >
                  Logout
                </button>
              ) : null}
              <p className="text-[11px]">
                <span className="font-medium text-[#1a73e8]">Current:</span> {pageLabel}
              </p>
            </div>
          </div>
        </>
      ) : null}

      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-3 sm:px-4">
        <div className="hidden shrink-0 items-center gap-0.5 sm:inline-flex">
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-[#5f6368] transition hover:bg-[#f1f3f4]"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="app-nav-drawer"
            onClick={() => setMenuOpen(true)}
          >
            <IconMenu />
          </button>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center rounded-full py-1 pr-2 transition hover:bg-[#f1f3f4]"
            aria-label="KhushPush404 home"
          >
            <BrandLogo variant="header" className="max-h-8" priority />
          </Link>
        </div>

        <div className="inline-flex shrink-0 items-center gap-0.5 sm:hidden">
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-[#5f6368] transition hover:bg-[#f1f3f4]"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="app-nav-drawer"
            onClick={() => setMenuOpen(true)}
          >
            <IconMenu />
          </button>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center rounded-full py-1 pr-2 transition hover:bg-[#f1f3f4]"
            aria-label="KhushPush404 home"
          >
            <BrandLogo variant="compact" className="max-h-7" />
          </Link>
        </div>

        <div
          className="mx-auto hidden max-w-xl flex-1 items-center gap-2 rounded-full border px-3 py-1.5 text-sm lg:flex"
          style={{
            borderColor: LINE,
            backgroundColor: "#eaf1fb",
            color: MUTED,
          }}
        >
          <span className="font-medium">Current:</span>
          <span>{pageLabel}</span>
        </div>

        <nav
          className="flex shrink-0 flex-wrap items-center gap-1 rounded-full border bg-white p-1"
          style={{ borderColor: LINE }}
          aria-label="Main"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition sm:text-sm"
              style={
                pathname === item.href
                  ? { backgroundColor: "#d3e3fd", color: "#001d35" }
                  : { color: TEXT }
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden rounded-full px-2 py-1 text-[11px] font-medium lg:block" style={{ color: MUTED, backgroundColor: SURFACE }}>
          KhushPush404
        </div>
        {authUser ? (
          <div className="hidden items-center gap-2 rounded-full border bg-white px-2 py-1 sm:flex" style={{ borderColor: LINE }}>
            {authUser.avatarUrl ? (
              <Image
                src={authUser.avatarUrl}
                alt={userDisplayName ? `${userDisplayName} avatar` : "User avatar"}
                width={28}
                height={28}
                className="size-7 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-full bg-[#d3e3fd] text-[11px] font-semibold text-[#174ea6]">
                {userInitials}
              </div>
            )}
            <div className="max-w-[150px] leading-tight">
              {userDisplayName ? <p className="truncate text-xs font-semibold text-[#202124]">{userDisplayName}</p> : null}
              {userSubtext ? <p className="truncate text-[11px] text-[#5f6368]">{userSubtext}</p> : null}
            </div>
          </div>
        ) : null}
        {!isLogin ? (
          <button
            type="button"
            onClick={() => {
              clearAuthSession();
              router.replace("/login");
            }}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold text-[#5f6368] transition hover:bg-[#f1f3f4]"
            style={{ borderColor: LINE }}
          >
            Logout
          </button>
        ) : null}
      </div>
    </header>
  );
}
