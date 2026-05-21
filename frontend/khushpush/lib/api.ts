import type { StudentProfile } from "./profile-schema";
import { loadStoredProfile } from "./profile-storage";

// Default matches `backend/dev_server.py` when `UVICORN_PORT` is unset (port 8000).
// Override with NEXT_PUBLIC_API_URL in `frontend/khushpush/.env` if your API runs elsewhere.
const DEFAULT_API = "http://127.0.0.1:8000";

export const GMAIL_SESSION_STORAGE_KEY = "khushpush_gmail_session";

/** When `"demo"`, API uses packaged Mongo-backed demo inbox + preprocessing. */
export type InboxPackMode = "live" | "demo";

const INBOX_PACK_MODE_KEY = "khushpush-inbox-pack-mode";

export function getInboxPackMode(): InboxPackMode {
  if (typeof window === "undefined") return "live";
  try {
    return window.localStorage.getItem(INBOX_PACK_MODE_KEY) === "demo" ? "demo" : "live";
  } catch {
    return "live";
  }
}

export function setInboxPackMode(mode: InboxPackMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INBOX_PACK_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function getApiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API).replace(/\/$/, "");
}

/** Same as fetch, but with a clear message when the backend is not running (connection refused, etc.). */
async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const url = `${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    return await fetch(url, init);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot reach API at ${getApiBase()} (${detail}). Start MongoDB, then in the backend folder run: ` +
        `python dev_server.py (default port 8000; set UVICORN_PORT if you use another port)`,
    );
  }
}

export type DemoEmail = {
  id: string;
  from: string;
  subject: string;
  date: string;
  body: string;
};

export type DemoInboxResponse = {
  emails: DemoEmail[];
  student: StudentProfile;
};

export type UnifiedInboxResponse = DemoInboxResponse & {
  source: "gmail" | "demo";
  gmail_connected: boolean;
  gmail_email: string | null;
  inbox_from_cache?: boolean;
  inbox_cached_at?: string | null;
  /** Server: `live` (Gmail path) vs `demo` (packaged dataset). */
  inbox_pack?: "live" | "demo";
  demo_history_id?: string | null;
};

export function getStoredGmailSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(GMAIL_SESSION_STORAGE_KEY);
}

export function setStoredGmailSessionId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) sessionStorage.setItem(GMAIL_SESSION_STORAGE_KEY, id);
  else sessionStorage.removeItem(GMAIL_SESSION_STORAGE_KEY);
}

function inboxHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  if (getInboxPackMode() === "demo") {
    h["X-Inbox-Source"] = "demo";
    return h;
  }
  const sid = getStoredGmailSessionId();
  if (sid) h["X-Gmail-Session"] = sid;
  return h;
}

function withInboxPreprocessHeaders(headers: Record<string, string>): Record<string, string> {
  if (getInboxPackMode() === "demo") return { ...headers, "X-Inbox-Source": "demo" };
  return headers;
}

/** Packaged demo inbox, or Gmail when `X-Gmail-Session` is present and valid. */
export async function fetchUnifiedInbox(opts?: { refresh?: boolean }): Promise<UnifiedInboxResponse> {
  const qs = opts?.refresh ? "?refresh=true" : "";
  const r = await fetchApi(`/api/v1/inbox${qs}`, {
    headers: inboxHeaders(),
  });
  if (!r.ok) {
    throw new Error(`Failed to load inbox (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<UnifiedInboxResponse>;
}

/** Always packaged demo payload; does NOT touch live Gmail inbox route. */
export async function fetchDemoInbox(): Promise<DemoInboxResponse> {
  const r = await fetchApi(`/api/v1/demo/inbox`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) {
    throw new Error(`Failed to load demo inbox (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<DemoInboxResponse>;
}

export type LatestSnapshotResponse = {
  configured: boolean;
  has_data: boolean;
  login_id?: string | null;
  student: StudentProfile | null;
  run: { id: string; created_at?: string | null } | null;
  emails: DemoEmail[];
  items: CategorizationItem[];
  model: string | null;
  batch_suggestions?: string[];
  error?: string;
};

export async function fetchLatestSnapshot(loginId?: string): Promise<LatestSnapshotResponse> {
  const q = loginId ? `?login_id=${encodeURIComponent(loginId)}` : "";
  const r = await fetchApi(`/api/v1/db/latest-snapshot${q}`, {
    headers: { Accept: "application/json" },
  });
  if (!r.ok) {
    throw new Error(`Failed to load db snapshot (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<LatestSnapshotResponse>;
}

export async function isGoogleOAuthConfigured(): Promise<boolean> {
  try {
    const r = await fetchApi(`/auth/gmail/configured`);
    if (!r.ok) return false;
    const j = (await r.json()) as { configured?: boolean };
    return Boolean(j.configured);
  } catch {
    return false;
  }
}

export function getGoogleOAuthStartUrl(): string {
  return `${getApiBase()}/auth/google`;
}

export async function disconnectGmail(): Promise<boolean> {
  const sid = getStoredGmailSessionId();
  if (!sid) return true;
  const r = await fetchApi(`/api/v1/auth/gmail/session`, {
    method: "DELETE",
    headers: { "X-Gmail-Session": sid, Accept: "application/json" },
  });
  if (r.ok) setStoredGmailSessionId(null);
  return r.ok;
}

/** Matches backend `packaged_data` default when inbox student has no login_id. */
export const DEMO_PACK_LOGIN_ID = "demo_student";

/** Effective login for API headers when profile omits `login_id` (demo pack uses packaged default). */
export function getEffectiveLoginIdForApi(): string | null {
  const p = loadStoredProfile();
  if (p?.login_id?.trim()) return p.login_id.trim();
  if (getInboxPackMode() === "demo") return DEMO_PACK_LOGIN_ID;
  return null;
}

function emailChatAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (getInboxPackMode() === "demo") {
    const lid = getEffectiveLoginIdForApi();
    if (lid) h["X-Login-Id"] = lid;
    return h;
  }
  const sid = getStoredGmailSessionId();
  if (sid) h["X-Gmail-Session"] = sid;
  else {
    const lid = getEffectiveLoginIdForApi();
    if (lid) h["X-Login-Id"] = lid;
  }
  return h;
}

/** Re-embed current inbox emails for RAG (requires MongoDB + `fastembed` on the server). */
export async function postEmailChatReindex(emails: DemoEmail[]): Promise<{ ok: boolean; chunks?: number } | null> {
  if (typeof window === "undefined") return null;
  const auth = emailChatAuthHeaders();
  if (!auth["X-Gmail-Session"] && !auth["X-Login-Id"]) return null;
  const r = await fetchApi(`/api/v1/email-chat/reindex`, {
    method: "POST",
    headers: withInboxPreprocessHeaders({
      Accept: "application/json",
      "Content-Type": "application/json",
      ...auth,
    }),
    body: JSON.stringify({
      emails: emails.map((e) => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        date: e.date,
        body: e.body,
      })),
    }),
  });
  if (!r.ok) {
    throw new Error(`Email index failed (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<{ ok: boolean; chunks?: number }>;
}

export type EmailChatTurn = { role: "user" | "assistant" | "system"; content: string };

export async function postEmailChatMessage(messages: EmailChatTurn[]): Promise<string> {
  const auth = emailChatAuthHeaders();
  if (!auth["X-Gmail-Session"] && !auth["X-Login-Id"]) {
    throw new Error(
      getInboxPackMode() === "demo"
        ? "Demo inbox chat needs a login id header; reload the page or ensure Demo pack mode is on."
        : "Save a profile with login_id, or connect Gmail, to use inbox chat.",
    );
  }
  const r = await fetchApi(`/api/v1/email-chat/message`, {
    method: "POST",
    headers: withInboxPreprocessHeaders({
      Accept: "application/json",
      "Content-Type": "application/json",
      ...auth,
    }),
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) {
    throw new Error(`Chat failed (${r.status}): ${await r.text()}`);
  }
  const j = (await r.json()) as { reply?: string };
  if (!j.reply?.trim()) throw new Error("Empty reply from chat API.");
  return j.reply.trim();
}

/** Deterministic rubric scores (backend `ranking_engine`); mirrors `ScoringBreakdown`. */
export type ScoringBreakdown = {
  profile_fit_score: number;
  urgency_score: number;
  completeness_score: number;
  final_score: number;
  days_until_deadline?: number | null;
  nearest_deadline?: string | null;
  weights: { profile_fit: number; urgency: number; completeness: number };
  notes: string[];
};

export type CategorizationItem = {
  email_id: string;
  is_opportunity: boolean;
  opportunity_type: string;
  relevance_score: number;
  profile_fit_label: string;
  rationale: string;
  /** ISO YYYY-MM-DD dates extracted for the calendar. */
  deadlines?: string[];
  /** 1 = highest priority in the batch among opportunities; 0 = not ranked. */
  priority_rank?: number;
  /** Per-email next steps (IELTS, skills, documents). */
  action_suggestions?: string[];
  /** Extracted eligibility clauses (LLM). */
  eligibility?: string[];
  /** Named required documents (LLM). */
  required_documents?: string[];
  /** Primary application or program URL (LLM). */
  application_url?: string | null;
  /** Contact email from the message (LLM). */
  contact_email?: string | null;
  /** Verbatim substrings from the email body supporting the rationale (for highlights). */
  evidence_quotes?: string[];
  /** Team deterministic layer after LLM (profile fit + urgency + completeness). */
  scoring?: ScoringBreakdown;
};

export type CategorizeResponse = {
  items: CategorizationItem[];
  model: string;
  /** Cross-email recommendations from the last batch run. */
  batch_suggestions?: string[];
  /** Changes on every response; use to detect re-requests even when items are served from cache. */
  random?: number;
};

export type LlmProvider = "groq" | "gemini";

const LLM_PROVIDER_STORAGE = "khushpush-llm-provider";

export function getStoredLlmProvider(): LlmProvider {
  if (typeof window === "undefined") return "groq";
  try {
    const v = window.localStorage.getItem(LLM_PROVIDER_STORAGE);
    if (v === "gemini") return "gemini";
    // Migrate legacy UI values to Groq.
    if (v === "groq" || v === "grok" || v === "openai") return "groq";
  } catch {
    /* ignore */
  }
  return "groq";
}

export function setStoredLlmProvider(provider: LlmProvider): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LLM_PROVIDER_STORAGE, provider);
  } catch {
    /* ignore */
  }
}

export async function categorizeEmails(
  student: StudentProfile,
  emails: DemoEmail[],
  llmProvider: LlmProvider = "groq",
  opts?: { forceRefresh?: boolean },
): Promise<CategorizeResponse> {
  const body = {
    student,
    emails: emails.map((e) => ({
      id: e.id,
      from: e.from,
      subject: e.subject,
      date: e.date,
      body: e.body,
    })),
    llm_provider: llmProvider,
    force_refresh: Boolean(opts?.forceRefresh),
  };
  const r = await fetchApi(`/api/v1/emails/categorize`, {
    method: "POST",
    headers: withInboxPreprocessHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Categorize failed (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<CategorizeResponse>;
}

/** Match backend `sitecheck` normalization so batch response keys line up. */
export function normalizeUrlForSafeBrowsing(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length < 6 || t.length > 2048) return null;
  if (!/^https?:\/\//i.test(t)) return `https://${t.replace(/^\/*/, "")}`;
  return t;
}

export type LinkSafetyResult = {
  status: string;
  threat_type?: string | null;
  provider?: string;
  error?: string;
};

/** Google Safe Browsing v4 via backend (cached in Mongo when `MONGODB_URI` is set). */
export async function fetchLinkSafetyBatch(urls: string[]): Promise<Record<string, LinkSafetyResult>> {
  if (urls.length === 0) return {};
  const r = await fetchApi(`/api/v1/sitecheck`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!r.ok) {
    throw new Error(`Link safety failed (${r.status}): ${await r.text()}`);
  }
  const j = (await r.json()) as { results?: Record<string, LinkSafetyResult> };
  if (!j.results || typeof j.results !== "object") {
    throw new Error("Invalid link safety response.");
  }
  return j.results;
}

export type StoredStudentProfile = StudentProfile & {
  id: string;
  created_at: string;
};

export async function saveStudentProfile(student: StudentProfile): Promise<StoredStudentProfile> {
  const r = await fetchApi(`/api/v1/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(student),
  });
  if (!r.ok) {
    throw new Error(`Profile save to backend failed (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<StoredStudentProfile>;
}

export type CvExtractProfileResponse = {
  suggested: Partial<StudentProfile>;
  text_char_count: number;
  text_used_chars: number;
  text_truncated: boolean;
  text_preview: string;
  model: string;
  notes: string;
};

/** PDF only. Sends multipart form field `file`. */
export async function extractCvProfileFromPdf(file: File): Promise<CvExtractProfileResponse> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetchApi(`/api/v1/cv/extract-profile`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    throw new Error(`CV extract failed (${r.status}): ${await r.text()}`);
  }
  return r.json() as Promise<CvExtractProfileResponse>;
}
