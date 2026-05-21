"use client";

export type AuthMethod = "gmail" | "email";

export type AuthUser = {
  email: string;
  method: AuthMethod;
  name?: string;
  avatarUrl?: string;
};

type StoredUser = {
  email: string;
  password: string;
};

const AUTH_COOKIE = "khushpush_auth";
const AUTH_USER_KEY = "khushpush_auth_user";
const AUTH_USERS_KEY = "khushpush_email_users";

function setCookie(name: string, value: string, days: number) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function setAuthSession(user: AuthUser): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  setCookie(AUTH_COOKIE, "1", 7);
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_USER_KEY);
  clearCookie(AUTH_COOKIE);
}

export function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as Partial<AuthUser>;
    if (!user.email || !user.method) return null;
    const normalized: AuthUser = {
      email: String(user.email),
      method: user.method === "gmail" ? "gmail" : "email",
    };
    if (typeof user.name === "string" && user.name.trim()) {
      normalized.name = user.name.trim();
    }
    if (typeof user.avatarUrl === "string" && user.avatarUrl.trim()) {
      normalized.avatarUrl = user.avatarUrl.trim();
    }
    return normalized;
  } catch {
    return null;
  }
}

export function formatNameFromEmail(email: string): string {
  const base = email.split("@")[0] ?? "";
  const words = base
    .split(/[._-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0) return email;
  return words
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function getStoredUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(AUTH_USERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setStoredUsers(users: StoredUser[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

export function signupWithEmail(email: string, password: string): { ok: boolean; error?: string } {
  const users = getStoredUsers();
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  if (users.some((u) => u.email.toLowerCase() === normalized)) {
    return { ok: false, error: "Account already exists. Please log in." };
  }
  users.push({ email: normalized, password });
  setStoredUsers(users);
  setAuthSession({ email: normalized, method: "email" });
  return { ok: true };
}

export function loginWithEmail(email: string, password: string): { ok: boolean; error?: string } {
  const users = getStoredUsers();
  const normalized = email.trim().toLowerCase();
  const user = users.find((u) => u.email.toLowerCase() === normalized && u.password === password);
  if (!user) return { ok: false, error: "Invalid email or password." };
  setAuthSession({ email: normalized, method: "email" });
  return { ok: true };
}

