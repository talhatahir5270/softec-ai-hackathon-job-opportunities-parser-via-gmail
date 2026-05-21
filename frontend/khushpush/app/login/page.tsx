"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getGoogleOAuthStartUrl, setStoredGmailSessionId } from "@/lib/api";
import { formatNameFromEmail, loginWithEmail, setAuthSession, signupWithEmail } from "@/lib/auth";

type Mode = "login" | "signup";

function resolveNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  return raw;
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queryState] = useState(() => {
    if (typeof window === "undefined") {
      return { nextRaw: null as string | null, gmailSession: null as string | null, gmailError: null as string | null };
    }
    const sp = new URLSearchParams(window.location.search);
    return {
      nextRaw: sp.get("next"),
      gmailSession: sp.get("gmail_session"),
      gmailError: sp.get("gmail_error"),
    };
  });

  const nextPath = useMemo(() => resolveNextPath(queryState.nextRaw), [queryState.nextRaw]);
  const gmailSession = queryState.gmailSession;
  const gmailError = queryState.gmailError;

  const finishLogin = (userEmail: string, method: "gmail" | "email", redirectTo?: string) => {
    setAuthSession({ email: userEmail, method, name: formatNameFromEmail(userEmail) });
    router.replace(redirectTo ?? nextPath);
  };

  useEffect(() => {
    const sessionFromDirectQuery = gmailSession;
    const nextAsUrl = new URL(nextPath, "http://localhost");
    const sessionFromNextParam = nextAsUrl.searchParams.get("gmail_session");
    const sid = sessionFromDirectQuery ?? sessionFromNextParam;
    if (!sid) return;

    setStoredGmailSessionId(sid);
    setAuthSession({
      email: "gmail-user@connected.local",
      method: "gmail",
      name: "Gmail User",
    });
    router.replace("/inbox");
  }, [gmailSession, nextPath, router]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "login") {
      const res = loginWithEmail(email, password);
      if (!res.ok) {
        setError(res.error ?? "Unable to login.");
        return;
      }
      finishLogin(email.trim().toLowerCase(), "email");
      return;
    }
    const res = signupWithEmail(email, password);
    if (!res.ok) {
      setError(res.error ?? "Unable to sign up.");
      return;
    }
    finishLogin(email.trim().toLowerCase(), "email");
  };

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-1 flex-col bg-[#f6f8fc] px-4 py-8 sm:py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-[#e8eaed] bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-[#202124]">Welcome to KhushPush404</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#5f6368]">
            Professional opportunity intelligence for students. Sign in to access your profile workspace, Gmail inbox
            sync, and AI matching dashboard.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-[#3c4043]">
            <p>- Gmail-style inbox and explainable AI scoring.</p>
            <p>- Structured profile model for consistent recommendations.</p>
            <p>- Fast fallback mode with demo data when external services are unavailable.</p>
          </div>
        </section>

        <section className="rounded-2xl border border-[#e8eaed] bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-5 flex rounded-full border border-[#dadce0] bg-white p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold ${mode === "login" ? "bg-[#d3e3fd] text-[#001d35]" : "text-[#5f6368]"}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold ${mode === "signup" ? "bg-[#d3e3fd] text-[#001d35]" : "text-[#5f6368]"}`}
            >
              Sign up
            </button>
          </div>

          {gmailError ? (
            <p className="mb-4 rounded-lg border border-[#f5c5c3] bg-[#fce8e6] px-3 py-2 text-xs text-[#b3261e]">
              Gmail sign-in failed: {gmailError}
            </p>
          ) : null}
          {error ? (
            <p className="mb-4 rounded-lg border border-[#f5c5c3] bg-[#fce8e6] px-3 py-2 text-xs text-[#b3261e]">{error}</p>
          ) : null}

          <button
            type="button"
            onClick={() => {
              window.location.href = getGoogleOAuthStartUrl();
            }}
            className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#dadce0] bg-white px-4 py-2.5 text-sm font-semibold text-[#202124] hover:bg-[#f8f9fa]"
          >
            <span className="text-[#4285F4]">G</span>
            Continue with Gmail
          </button>

          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#e8eaed]" />
            <span className="text-xs text-[#5f6368]">or email</span>
            <div className="h-px flex-1 bg-[#e8eaed]" />
          </div>

          <form className="space-y-3" onSubmit={onSubmit}>
            <label className="block text-sm">
              <span className="font-medium text-[#202124]">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#0b57d0]"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-[#202124]">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1 w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm outline-none focus:border-[#0b57d0]"
              />
            </label>
            <button
              type="submit"
              className="mt-2 w-full rounded-lg bg-[#0b57d0] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0842a8]"
            >
              {mode === "login" ? "Login with Email" : "Create Account"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

