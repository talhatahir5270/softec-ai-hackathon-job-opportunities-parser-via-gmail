import type { CategorizationItem, DemoEmail, InboxPackMode, LlmProvider } from "@/lib/api";
import type { StudentProfile } from "@/lib/profile-schema";

const STORAGE_PREFIX = "khushpush-inbox-ai-v3";
const DEFAULT_LOGIN = "demo_student";

export type StoredInboxAnalysis = {
  catById: Record<string, CategorizationItem>;
  catModelById: Record<string, string>;
  model: string | null;
  batchSuggestions: string[];
  updatedAt: number;
};

function storageKey(pack: InboxPackMode, loginId: string, provider: LlmProvider): string {
  const lid = (loginId || DEFAULT_LOGIN).trim() || DEFAULT_LOGIN;
  return `${STORAGE_PREFIX}:${pack}:${lid}:${provider}`;
}

export function loadStoredInboxAnalysis(
  pack: InboxPackMode,
  loginId: string,
  provider: LlmProvider,
): StoredInboxAnalysis | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(pack, loginId, provider));
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<StoredInboxAnalysis>;
    if (!j || typeof j.catById !== "object") return null;
    return {
      catById: j.catById as Record<string, CategorizationItem>,
      catModelById: typeof j.catModelById === "object" && j.catModelById ? j.catModelById : {},
      model: typeof j.model === "string" ? j.model : null,
      batchSuggestions: Array.isArray(j.batchSuggestions) ? j.batchSuggestions : [],
      updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Keep only analysis rows that still exist in the current inbox list. */
export function pruneStoredAnalysisToEmails(
  stored: StoredInboxAnalysis,
  emails: DemoEmail[],
): StoredInboxAnalysis {
  const ids = new Set(emails.map((e) => e.id));
  const catById: Record<string, CategorizationItem> = {};
  const catModelById: Record<string, string> = {};
  for (const id of Object.keys(stored.catById)) {
    if (!ids.has(id)) continue;
    catById[id] = stored.catById[id];
    if (stored.catModelById[id]) catModelById[id] = stored.catModelById[id];
  }
  return {
    catById,
    catModelById,
    model: stored.model,
    batchSuggestions: stored.batchSuggestions,
    updatedAt: stored.updatedAt,
  };
}

export function persistInboxAnalysis(
  pack: InboxPackMode,
  loginId: string,
  provider: LlmProvider,
  payload: StoredInboxAnalysis,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(pack, loginId, provider), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearStoredInboxAnalysis(pack: InboxPackMode, loginId: string, provider: LlmProvider): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(pack, loginId, provider));
  } catch {
    /* ignore */
  }
}

export function effectiveLoginIdForStorage(student: StudentProfile | null): string {
  return (student?.login_id?.trim() || DEFAULT_LOGIN).trim();
}
