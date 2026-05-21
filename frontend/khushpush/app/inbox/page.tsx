"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionChecklist } from "@/components/ActionChecklist";
import { EmailBodyWithHighlights } from "@/components/EmailBodyWithHighlights";
import { BrandLogo } from "@/components/BrandLogo";
import { EmailLinkSafetyPanel } from "@/components/EmailLinkSafetyPanel";
import { InboxScheduleHub } from "@/components/InboxScheduleHub";
import { SuggestedNextSteps } from "@/components/SuggestedNextSteps";
import type { CategorizationItem, DemoEmail, ScoringBreakdown } from "@/lib/api";
import {
  categorizeEmails,
  disconnectGmail,
  fetchUnifiedInbox,
  getApiBase,
  getGoogleOAuthStartUrl,
  getInboxPackMode,
  getStoredGmailSessionId,
  getStoredLlmProvider,
  isGoogleOAuthConfigured,
  postEmailChatReindex,
  setInboxPackMode,
  setStoredGmailSessionId,
  setStoredLlmProvider,
  type InboxPackMode,
  type LlmProvider,
} from "@/lib/api";
import { clearAuthSession, formatNameFromEmail, getAuthUser, type AuthUser } from "@/lib/auth";
import type { StudentProfile } from "@/lib/profile-schema";
import { studentProfileSchema } from "@/lib/profile-schema";
import { loadStoredProfile } from "@/lib/profile-storage";
import {
  ACTION_CHECKLIST_CHANGED_EVENT,
  checklistProgress,
  loadChecklistStore,
  type ChecklistStore,
} from "@/lib/action-checklist-storage";
import {
  effectiveLoginIdForStorage,
  loadStoredInboxAnalysis,
  persistInboxAnalysis,
  pruneStoredAnalysisToEmails,
} from "@/lib/inbox-analysis-storage";
import {
  loadPastedEmailsFromStorage,
  PASTE_EMAIL_JSON_EXAMPLE,
  PASTE_EMAIL_SEPARATOR,
  parsePastedEmails,
  savePastedEmailsToStorage,
} from "@/lib/paste-email";

const SURFACE = "#f6f8fc";
const LINE = "#e8eaed";
const ACCENT = "#0b57d0";
const TEXT = "#1f1f1f";
const MUTED = "#5f6368";

function useNarrowLayout() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}

function snippet(body: string, max = 96) {
  const t = body.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function formatCachedAtLabel(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return null;
  }
}

function parseSender(from: string) {
  const displayName = from.replace(/<[^>]+>/g, "").trim() || from;
  const avatarLetter = (displayName.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  return { displayName, avatarLetter };
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

function fitTone(label: string): { bg: string; fg: string } {
  switch (label) {
    case "strong_match":
      return { bg: "#e6f4ea", fg: "#137333" };
    case "moderate_match":
      return { bg: "#fef7e0", fg: "#b06000" };
    case "weak_match":
      return { bg: "#f1f3f4", fg: "#5f6368" };
    case "not_an_opportunity":
      return { bg: "#fce8e6", fg: "#c5221f" };
    default:
      return { bg: "#f1f3f4", fg: "#5f6368" };
  }
}

function scoringTooltip(s: ScoringBreakdown): string {
  return [
    `Deterministic final: ${(s.final_score * 100).toFixed(0)}%`,
    `Weights: ${(s.weights.profile_fit * 100).toFixed(0)}% profile + ${(s.weights.urgency * 100).toFixed(0)}% urgency + ${(s.weights.completeness * 100).toFixed(0)}% completeness`,
    `Completeness = 9 weighted signals (deadline, rationale, type, relevance, actions, eligibility, documents, URL, contact).`,
    `Sub-scores — Fit: ${(s.profile_fit_score * 100).toFixed(0)}%, Urgency: ${(s.urgency_score * 100).toFixed(0)}%, Completeness: ${(s.completeness_score * 100).toFixed(0)}%`,
    s.nearest_deadline
      ? `Nearest deadline: ${s.nearest_deadline}${s.days_until_deadline != null ? ` (${s.days_until_deadline}d)` : ""}`
      : "",
    ...s.notes.slice(0, 14),
  ]
    .filter(Boolean)
    .join("\n");
}

type ListRelevanceFilter = "all" | "opportunities" | "high_fit" | "with_deadlines" | "unscored";
type AiScopeMode = "5" | "10" | "all" | "custom";

function rowPassesRelevanceFilter(cat: CategorizationItem | null, filter: ListRelevanceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "opportunities":
      return cat?.is_opportunity === true;
    case "high_fit":
      return cat?.profile_fit_label === "strong_match" || cat?.profile_fit_label === "moderate_match";
    case "with_deadlines":
      return (cat?.deadlines?.length ?? 0) > 0;
    case "unscored":
      return cat === null;
    default:
      return true;
  }
}

function parseCustomScanRange(
  startStr: string,
  endStr: string,
  maxLen: number,
): { ok: true; start: number; end: number } | { ok: false; error: string } {
  if (maxLen === 0) {
    return { ok: false, error: "No threads in the filtered list to scan." };
  }
  const start = Number.parseInt(startStr.trim(), 10);
  const end = Number.parseInt(endStr.trim(), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: "Start and finish must be whole numbers." };
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { ok: false, error: "Start and finish must be whole numbers." };
  }
  if (start < 1 || end < 1) {
    return { ok: false, error: "Start and finish must be at least 1." };
  }
  if (start > maxLen || end > maxLen) {
    return { ok: false, error: `Use positions from 1 through ${maxLen} (current filtered list).` };
  }
  if (start > end) {
    return { ok: false, error: "Start cannot be greater than finish." };
  }
  return { ok: true, start, end };
}

function LlmEnginePick({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: LlmProvider;
  onChange: (v: LlmProvider) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const size = compact ? 16 : 18;
  const chip = (id: LlmProvider, src: string, label: string) => (
    <button
      key={id}
      type="button"
      disabled={disabled}
      aria-pressed={value === id}
      onClick={() => onChange(id)}
      className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        value === id ? "border-[#0b57d0] bg-[#e8f0fe] text-[#174ea6]" : "border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f1f3f4]"
      }`}
      aria-label={`Use ${label} for AI`}
    >
      <Image src={src} alt="" width={size} height={size} className="shrink-0 rounded" />
      {compact ? null : <span>{label}</span>}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="AI engine">
      {chip("groq", "/groq-icon.png", "Groq")}
      {chip("gemini", "/gemini-icon.png", "Gemini")}
    </div>
  );
}

function IconInbox({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStar({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      {filled ? (
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75" />
      <path d="M20 20l-4.3-4.3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconMenu({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12a9 9 0 11-3-6.7M21 3v6h-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBack({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InboxListSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 9 }).map((_, idx) => (
        <div
          key={`sk-row-${idx}`}
          className="flex gap-0 border-b"
          style={{
            borderColor: LINE,
            backgroundColor: idx % 2 === 0 ? "#fff" : "#fdfdff",
          }}
        >
          <div className="flex w-10 shrink-0 items-start justify-center pt-3">
            <div className="size-4 rounded-full bg-[#dce1e7]" />
          </div>
          <div className="flex-1 py-2.5 pr-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="h-3.5 w-28 rounded bg-[#e6eaef]" />
              <div className="h-3 w-12 rounded bg-[#edf1f5]" />
            </div>
            <div className="mb-1.5 h-3.5 w-[72%] rounded bg-[#e9edf2]" />
            <div className="h-3 w-[88%] rounded bg-[#eff2f6]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function InboxThreadSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-end border-b px-2" style={{ borderColor: LINE }}>
        <div className="h-6 w-20 rounded-full bg-[#eef1f5] animate-pulse" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div className="h-8 w-[72%] rounded bg-[#e9edf2] animate-pulse" />
        <div className="mt-5 flex items-start gap-4 border-b pb-4" style={{ borderColor: LINE }}>
          <div className="size-10 rounded-full bg-[#d7e3fd] animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-48 rounded bg-[#e6eaef] animate-pulse" />
            <div className="mt-2 h-3 w-40 rounded bg-[#edf1f5] animate-pulse" />
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <div className="h-6 w-28 rounded-full bg-[#e6f4ea] animate-pulse" />
          <div className="h-6 w-24 rounded-full bg-[#e8def8] animate-pulse" />
          <div className="h-6 w-20 rounded-full bg-[#e0f2fe] animate-pulse" />
        </div>
        <div className="mt-5 space-y-3">
          <div className="h-3.5 w-[94%] rounded bg-[#e9edf2] animate-pulse" />
          <div className="h-3.5 w-[88%] rounded bg-[#edf1f5] animate-pulse" />
          <div className="h-3.5 w-[70%] rounded bg-[#f1f4f8] animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const narrow = useNarrowLayout();
  const router = useRouter();
  const [railOpen, setRailOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const [baseEmails, setBaseEmails] = useState<DemoEmail[]>([]);
  const [pastedEmails, setPastedEmails] = useState<DemoEmail[]>([]);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteExampleOpen, setPasteExampleOpen] = useState(false);
  const [mobilePasteOpen, setMobilePasteOpen] = useState(false);

  const emails = useMemo(() => [...pastedEmails, ...baseEmails], [pastedEmails, baseEmails]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [inboxSource, setInboxSource] = useState<"gmail" | "demo">("demo");
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [gmailBanner, setGmailBanner] = useState<string | null>(null);
  const [inboxFromCache, setInboxFromCache] = useState(false);
  const [inboxCachedAt, setInboxCachedAt] = useState<string | null>(null);
  const [inboxPackMode, setInboxPackModeState] = useState<InboxPackMode>("live");

  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [catById, setCatById] = useState<Record<string, CategorizationItem>>({});
  const [catModelById, setCatModelById] = useState<Record<string, string>>({});
  const [model, setModel] = useState<string | null>(null);
  const [catLoading, setCatLoading] = useState(false);
  const [catOneLoadingId, setCatOneLoadingId] = useState<string | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [batchSuggestions, setBatchSuggestions] = useState<string[]>([]);
  const lastHydratedLoad = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [starred, setStarred] = useState<Record<string, boolean>>({});
  const [listRelevanceFilter, setListRelevanceFilter] = useState<ListRelevanceFilter>("all");
  const [aiTopFilter, setAiTopFilter] = useState<AiScopeMode>("10");
  const [scanRangeStart, setScanRangeStart] = useState("1");
  const [scanRangeEnd, setScanRangeEnd] = useState("10");
  const [llmProvider, setLlmProvider] = useState<LlmProvider>(() =>
    typeof window !== "undefined" ? getStoredLlmProvider() : "groq",
  );
  /** Per-thread AI engine preference (defaults to sidebar/mobile `llmProvider`). */
  const [emailLlmById, setEmailLlmById] = useState<Record<string, LlmProvider>>({});
  const [checklistRev, setChecklistRev] = useState(0);

  const checklistStoreForRows = useMemo((): ChecklistStore => {
    if (typeof window === "undefined") return { emails: {}, updatedAt: 0 };
    return loadChecklistStore(inboxPackMode, effectiveLoginIdForStorage(student));
  }, [student, inboxPackMode, checklistRev]);

  useEffect(() => {
    const onTick = () => setChecklistRev((n) => n + 1);
    window.addEventListener(ACTION_CHECKLIST_CHANGED_EVENT, onTick);
    return () => window.removeEventListener(ACTION_CHECKLIST_CHANGED_EVENT, onTick);
  }, []);

  useEffect(() => {
    void isGoogleOAuthConfigured().then(setOauthConfigured);
  }, []);

  useEffect(() => {
    setAuthUser(getAuthUser());
  }, []);

  useEffect(() => {
    const onStorage = () => setAuthUser(getAuthUser());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    setPastedEmails(loadPastedEmailsFromStorage());
  }, []);

  useEffect(() => {
    setInboxPackModeState(getInboxPackMode());
  }, []);

  useEffect(() => {
    lastHydratedLoad.current = false;
  }, [llmProvider, inboxPackMode]);

  const loadInbox = useCallback(async (opts?: { refresh?: boolean }) => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const sid = sp.get("gmail_session");
      const err = sp.get("gmail_error");
      if (sid) {
        setStoredGmailSessionId(sid);
        setGmailBanner(null);
      }
      if (err) {
        setGmailBanner(err.length > 200 ? `${err.slice(0, 200)}…` : err);
      }
      if (sid || err) {
        window.history.replaceState({}, "", "/inbox");
      }
    }
    setLoadingList(true);
    setLoadError(null);
    try {
      const inbox = await fetchUnifiedInbox({ refresh: Boolean(opts?.refresh) });
      setBaseEmails(inbox.emails);
      setInboxSource(inbox.source);
      setGmailEmail(inbox.gmail_email ?? null);
      setInboxFromCache(Boolean(inbox.inbox_from_cache));
      setInboxCachedAt(inbox.inbox_cached_at ?? null);
      const stored = loadStoredProfile();
      if (stored) {
        setStudent(stored);
      } else {
        const parsed = studentProfileSchema.safeParse(inbox.student);
        if (parsed.success) {
          setStudent(parsed.data);
        } else {
          setLoadError("Invalid packaged student profile.");
        }
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load inbox");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const switchInboxPack = useCallback(
    (mode: InboxPackMode) => {
      setInboxPackMode(mode);
      setInboxPackModeState(mode);
      setCatById({});
      setCatModelById({});
      setModel(null);
      setBatchSuggestions([]);
      lastHydratedLoad.current = false;
      void loadInbox();
    },
    [loadInbox],
  );

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadInbox();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadInbox]);

  /** Restore AI labels from localStorage after inbox finishes loading (same pack / login / engine). */
  useEffect(() => {
    if (loadingList) {
      lastHydratedLoad.current = false;
      return;
    }
    if (emails.length === 0 || lastHydratedLoad.current) return;
    const pack = inboxPackMode;
    const provider = getStoredLlmProvider();
    const prof = loadStoredProfile() ?? student;
    if (!prof) return;
    const loginId = effectiveLoginIdForStorage(prof);
    const raw = loadStoredInboxAnalysis(pack, loginId, provider);
    if (!raw) {
      lastHydratedLoad.current = true;
      return;
    }
    const pruned = pruneStoredAnalysisToEmails(raw, emails);
    if (Object.keys(pruned.catById).length > 0) {
      setCatById(pruned.catById);
      setCatModelById(pruned.catModelById);
      setModel(pruned.model);
      setBatchSuggestions(pruned.batchSuggestions ?? []);
    }
    lastHydratedLoad.current = true;
  }, [loadingList, emails, student, inboxPackMode]);

  /** Embed inbox (including pasted threads) for RAG chat — debounced; failures are silent. */
  useEffect(() => {
    if (loadingList || emails.length === 0) return;
    const sid = getStoredGmailSessionId();
    const stored = loadStoredProfile();
    const pack = getInboxPackMode();
    if (pack === "demo") {
      /* Demo pack always sends X-Login-Id (defaults to demo_student) so RAG can index. */
    } else if (!sid && !stored?.login_id) {
      return;
    }
    const t = window.setTimeout(() => {
      void postEmailChatReindex(emails).catch(() => {});
    }, 1400);
    return () => window.clearTimeout(t);
  }, [loadingList, emails]);

  const refreshStudentFromStorage = useCallback(() => {
    setStudent(loadStoredProfile());
  }, []);

  const onDisconnectGmail = useCallback(async () => {
    await disconnectGmail();
    setCatById({});
    setCatModelById({});
    setModel(null);
    setBatchSuggestions([]);
    lastHydratedLoad.current = false;
    setGmailBanner(null);
    await loadInbox();
  }, [loadInbox]);

  const addPastedToInbox = useCallback(() => {
    setPasteError(null);
    const result = parsePastedEmails(pasteDraft);
    if (!result.ok) {
      setPasteError(result.error);
      return;
    }
    setPastedEmails((prev) => {
      const next = [...result.emails, ...prev];
      savePastedEmailsToStorage(next);
      return next;
    });
    setPasteDraft("");
  }, [pasteDraft]);

  const clearPastedInbox = useCallback(() => {
    setPasteError(null);
    setPastedEmails([]);
    savePastedEmailsToStorage([]);
  }, []);

  const onPasteFile = useCallback((file: File | null) => {
    if (!file) return;
    setPasteError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setPasteDraft(text);
      const result = parsePastedEmails(text);
      if (!result.ok) {
        setPasteError(result.error);
        return;
      }
      setPastedEmails((prev) => {
        const next = [...result.emails, ...prev];
        savePastedEmailsToStorage(next);
        return next;
      });
      setPasteDraft("");
    };
    reader.onerror = () => setPasteError("Could not read that file.");
    reader.readAsText(file, "UTF-8");
  }, []);

  const merged = useMemo(() => {
    return emails.map((e) => ({ email: e, cat: catById[e.id] ?? null }));
  }, [emails, catById]);

  const hubStats = useMemo(() => {
    const analyzed = Object.keys(catById).length;
    const opportunities = Object.values(catById).filter((c) => c?.is_opportunity).length;
    const deadlineRows = Object.values(catById).reduce((n, c) => n + (c?.deadlines?.length ?? 0), 0);
    return {
      totalThreads: emails.length,
      analyzed,
      opportunities,
      deadlineRows,
    };
  }, [emails.length, catById]);

  const profileSummary = useMemo(() => {
    const p = loadStoredProfile() ?? student;
    const parsed = p ? studentProfileSchema.safeParse(p) : null;
    if (!parsed?.success) return { ok: false as const };
    return { ok: true as const, data: parsed.data };
  }, [student]);

  const filtered = useMemo(() => {
    const relevanceRows = merged.filter(({ cat }) => rowPassesRelevanceFilter(cat, listRelevanceFilter));
    const q = search.trim().toLowerCase();
    if (!q) return relevanceRows;
    return relevanceRows.filter(
      ({ email }) =>
        email.subject.toLowerCase().includes(q) ||
        email.from.toLowerCase().includes(q) ||
        email.body.toLowerCase().includes(q),
    );
  }, [merged, listRelevanceFilter, search]);

  const filteredEmailsOnly = useMemo(() => filtered.map((x) => x.email), [filtered]);

  const customScanRangeError = useMemo(() => {
    if (aiTopFilter !== "custom") return null;
    const r = parseCustomScanRange(scanRangeStart, scanRangeEnd, filteredEmailsOnly.length);
    return r.ok ? null : r.error;
  }, [aiTopFilter, scanRangeStart, scanRangeEnd, filteredEmailsOnly.length]);

  const emailsForAi = useMemo(() => {
    const list = filteredEmailsOnly;
    if (list.length === 0) return [];
    if (aiTopFilter === "all") return list;
    if (aiTopFilter === "5") return list.slice(0, 5);
    if (aiTopFilter === "10") return list.slice(0, 10);
    const parsed = parseCustomScanRange(scanRangeStart, scanRangeEnd, list.length);
    if (!parsed.ok) return [];
    return list.slice(parsed.start - 1, parsed.end);
  }, [filteredEmailsOnly, aiTopFilter, scanRangeStart, scanRangeEnd]);

  const runCategorize = useCallback(async () => {
    setCatError(null);
    const s = loadStoredProfile() ?? student;
    const parsed = s ? studentProfileSchema.safeParse(s) : null;
    if (!parsed?.success) {
      setCatError("Save a valid profile on the Profile page first.");
      return;
    }
    if (filteredEmailsOnly.length === 0) {
      setCatError("No threads match your search and relevance filters.");
      return;
    }
    if (aiTopFilter === "custom") {
      const parsed = parseCustomScanRange(scanRangeStart, scanRangeEnd, filteredEmailsOnly.length);
      if (!parsed.ok) {
        setCatError(parsed.error);
        return;
      }
    }
    if (emailsForAi.length === 0) {
      setCatError("No emails in this scan scope. Adjust start/finish or pick another scope.");
      return;
    }
    const batchIds = emailsForAi.map((e) => e.id);
    const hadPriorInBatch = emailsForAi.some((e) => Boolean(catById[e.id]));
    const wipedCat = { ...catById };
    const wipedModels = { ...catModelById };
    for (const id of batchIds) {
      delete wipedCat[id];
      delete wipedModels[id];
    }
    setCatById(wipedCat);
    setCatModelById(wipedModels);

    setCatLoading(true);
    try {
      const res = await categorizeEmails(parsed.data, emailsForAi, llmProvider, {
        forceRefresh: hadPriorInBatch,
      });
      const nextCat = { ...wipedCat };
      const nextModels = { ...wipedModels };
      for (const it of res.items) {
        nextCat[it.email_id] = it;
        nextModels[it.email_id] = res.model;
      }
      setCatById(nextCat);
      setCatModelById(nextModels);
      setModel(res.model);
      const sug = res.batch_suggestions ?? [];
      setBatchSuggestions(sug);
      persistInboxAnalysis(getInboxPackMode(), effectiveLoginIdForStorage(parsed.data), llmProvider, {
        catById: nextCat,
        catModelById: nextModels,
        model: res.model,
        batchSuggestions: sug,
        updatedAt: Date.now(),
      });
    } catch (e) {
      setCatError(e instanceof Error ? e.message : "Categorization failed");
    } finally {
      setCatLoading(false);
    }
  }, [
    aiTopFilter,
    catById,
    catModelById,
    emailsForAi,
    filteredEmailsOnly.length,
    llmProvider,
    scanRangeEnd,
    scanRangeStart,
    student,
  ]);

  const runCategorizeOne = useCallback(
    async (email: DemoEmail, provider: LlmProvider) => {
      setCatError(null);
      const s = loadStoredProfile() ?? student;
      const parsed = s ? studentProfileSchema.safeParse(s) : null;
      if (!parsed?.success) {
        setCatError("Save a valid profile on the Profile page first.");
        return;
      }
      const hadPrior = Boolean(catById[email.id]);
      const wipedCat = { ...catById };
      const wipedModels = { ...catModelById };
      delete wipedCat[email.id];
      delete wipedModels[email.id];
      setCatById(wipedCat);
      setCatModelById(wipedModels);

      setCatOneLoadingId(email.id);
      try {
        const res = await categorizeEmails(parsed.data, [email], provider, { forceRefresh: hadPrior });
        const it = res.items[0];
        if (!it) {
          setCatError("No categorization returned for this email.");
          return;
        }
        const nextCat = { ...wipedCat, [it.email_id]: it };
        const nextModels = { ...wipedModels, [it.email_id]: res.model };
        setCatById(nextCat);
        setCatModelById(nextModels);
        setModel(res.model);
        const sug = res.batch_suggestions ?? [];
        setBatchSuggestions(sug);
        persistInboxAnalysis(getInboxPackMode(), effectiveLoginIdForStorage(parsed.data), provider, {
          catById: nextCat,
          catModelById: nextModels,
          model: res.model,
          batchSuggestions: sug,
          updatedAt: Date.now(),
        });
      } catch (e) {
        setCatError(e instanceof Error ? e.message : "Categorization failed");
      } finally {
        setCatOneLoadingId(null);
      }
    },
    [catById, catModelById, student],
  );

  const hasAnalysis = Object.keys(catById).length > 0;
  const batchAiBusy = catLoading || catOneLoadingId !== null;

  /** Keeps list + pane in sync when the filter changes (no effect/setState cascade). */
  const resolvedId = useMemo(() => {
    if (filtered.length === 0) return null;
    if (selectedId && filtered.some((x) => x.email.id === selectedId)) return selectedId;
    return filtered[0].email.id;
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => (resolvedId ? filtered.find((x) => x.email.id === resolvedId) ?? null : null),
    [filtered, resolvedId],
  );

  const selectedSender = useMemo(
    () => (selected ? parseSender(selected.email.from) : null),
    [selected],
  );

  const emptyListMessage = useMemo(() => {
    if (merged.length === 0) return "No messages in inbox.";
    const q = search.trim();
    const rel = listRelevanceFilter !== "all";
    if (rel && q) return "No threads match your search and relevance filters.";
    if (rel) return "No threads match the relevance filter.";
    return "No messages match your search.";
  }, [merged.length, search, listRelevanceFilter]);

  const aiScopeRunLabel = useMemo(() => {
    if (aiTopFilter === "all") return "all visible";
    if (aiTopFilter === "5") return "top 5";
    if (aiTopFilter === "10") return "top 10";
    return `rows ${scanRangeStart}–${scanRangeEnd}`;
  }, [aiTopFilter, scanRangeStart, scanRangeEnd]);

  const toggleStar = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarred((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectRow = (id: string) => {
    setSelectedId(id);
    if (narrow) setMobilePane("thread");
  };

  const unreadCount = merged.length;
  const userDisplayName = authUser?.name || (authUser?.email ? formatNameFromEmail(authUser.email) : null);
  const userSubtext = authUser?.email ?? null;
  const userInitials = initialsFromUser(authUser);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col font-sans"
      style={{ backgroundColor: SURFACE, color: TEXT }}
    >
      {/* Top bar — Gmail-style */}
      <header
        className="flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4"
        style={{ borderColor: LINE, backgroundColor: "#fff" }}
      >
        <div className="hidden shrink-0 items-center gap-0.5 sm:inline-flex">
          {narrow ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-[#5f6368] transition hover:bg-[#f1f3f4]"
              aria-label={railOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={railOpen}
              aria-controls="inbox-rail"
              onClick={() => setRailOpen((o) => !o)}
            >
              <IconMenu className="size-5 shrink-0" />
            </button>
          ) : null}
          <Link
            href="/"
            className="inline-flex shrink-0 items-center rounded-full py-1 pr-2 transition hover:bg-[#f1f3f4]"
            aria-label="KhushPush404 home"
          >
            <BrandLogo variant="header" className="max-h-8" />
          </Link>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 sm:hidden">
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-[#5f6368] transition hover:bg-[#f1f3f4]"
            aria-label={railOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={railOpen}
            aria-controls="inbox-rail"
            onClick={() => setRailOpen((o) => !o)}
          >
            <IconMenu className="size-5 shrink-0" />
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
          className="hidden shrink-0 items-center gap-0.5 rounded-full border p-0.5 sm:flex"
          style={{ borderColor: LINE, backgroundColor: "#fff" }}
          role="group"
          aria-label="Inbox data source"
        >
          <button
            type="button"
            onClick={() => switchInboxPack("live")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              inboxPackMode === "live" ? "text-white shadow-sm" : "text-[#5f6368] hover:bg-[#f1f3f4]"
            }`}
            style={inboxPackMode === "live" ? { backgroundColor: ACCENT } : undefined}
          >
            Live inbox
          </button>
          <button
            type="button"
            onClick={() => switchInboxPack("demo")}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              inboxPackMode === "demo" ? "text-white shadow-sm" : "text-[#5f6368] hover:bg-[#f1f3f4]"
            }`}
            style={inboxPackMode === "demo" ? { backgroundColor: ACCENT } : undefined}
          >
            Demo pack
          </button>
        </div>

        <div
          className="mx-auto flex max-w-2xl flex-1 items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm"
          style={{
            borderColor: LINE,
            backgroundColor: "#eaf1fb",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
          }}
        >
          <IconSearch className="shrink-0 text-[#5f6368]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mail"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#5f6368]"
            aria-label="Search mail"
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <span
            className="hidden rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide sm:inline-block"
            style={{
              borderColor: LINE,
              color:
                inboxPackMode === "demo"
                  ? "#b06000"
                  : inboxSource === "gmail"
                    ? "#137333"
                    : MUTED,
              backgroundColor:
                inboxPackMode === "demo" ? "#fef7e0" : inboxSource === "gmail" ? "#e6f4ea" : "#fff",
            }}
          >
            {inboxPackMode === "demo"
              ? "Mongo demo"
              : inboxSource === "gmail"
                ? "Gmail"
                : "Demo inbox"}
          </span>
          {oauthConfigured ? (
            inboxSource === "gmail" ? (
              <button
                type="button"
                onClick={() => void onDisconnectGmail()}
                className="rounded-full border border-[#dadce0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1f1f1f] transition hover:bg-[#f1f3f4]"
              >
                Disconnect Gmail
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  window.location.href = getGoogleOAuthStartUrl();
                }}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white transition hover:opacity-95"
                style={{ backgroundColor: ACCENT }}
              >
                Connect Gmail
              </button>
            )
          ) : null}
          <button
            type="button"
            onClick={() => void loadInbox({ refresh: true })}
            className="inline-flex items-center gap-1 rounded-full border border-[#dadce0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#3c4043] transition hover:bg-[#f1f3f4]"
            title={
              inboxSource === "gmail"
                ? "Fetch the newest messages from Gmail and update your saved inbox"
                : "Reload inbox data from the server"
            }
            aria-label={inboxSource === "gmail" ? "Fetch latest from Gmail" : "Refresh inbox"}
          >
            <IconRefresh />
            <span className="hidden sm:inline">{inboxSource === "gmail" ? "Fetch latest" : "Refresh inbox"}</span>
          </button>
          {inboxSource === "gmail" && inboxFromCache ? (
            <span
              className="hidden max-w-[220px] truncate text-[10px] leading-tight text-[#5f6368] sm:inline"
              title={inboxCachedAt ?? undefined}
            >
              Saved inbox
              {formatCachedAtLabel(inboxCachedAt) ? ` · ${formatCachedAtLabel(inboxCachedAt)}` : ""}
            </span>
          ) : null}
          <span className="hidden text-[11px] text-[#5f6368] lg:inline" title="API base">
            {getApiBase().replace(/^https?:\/\//, "")}
          </span>
          {authUser ? (
            <div className="hidden items-center gap-2 rounded-full border bg-white px-2 py-1 md:flex" style={{ borderColor: LINE }}>
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
              <div className="max-w-[140px] leading-tight">
                {userDisplayName ? <p className="truncate text-xs font-semibold text-[#202124]">{userDisplayName}</p> : null}
                {userSubtext ? <p className="truncate text-[11px] text-[#5f6368]">{userSubtext}</p> : null}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              clearAuthSession();
              router.replace("/login");
            }}
            className="rounded-full border border-[#dadce0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#3c4043] transition hover:bg-[#f1f3f4]"
          >
            Logout
          </button>
        </div>
      </header>

      {gmailBanner ? (
        <div
          className="shrink-0 border-b px-4 py-2 text-center text-xs font-medium text-red-800"
          style={{ borderColor: LINE, backgroundColor: "#fce8e6" }}
        >
          {gmailBanner}
        </div>
      ) : null}
      {inboxSource === "gmail" && gmailEmail ? (
        <div
          className="shrink-0 border-b px-4 py-2 text-center text-xs font-medium text-[#137333]"
          style={{ borderColor: LINE, backgroundColor: "#e6f4ea" }}
        >
          Connected as <span className="font-semibold">{gmailEmail}</span> — showing recent messages from Gmail.
        </div>
      ) : null}

      {narrow && railOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/25 lg:hidden"
          aria-label="Close menu"
          onClick={() => setRailOpen(false)}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left rail — desktop in-flow; narrow screens slide over from the left */}
        <aside
          id="inbox-rail"
          className={[
            "flex w-[280px] shrink-0 flex-col border-r px-3 py-4",
            "max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:z-50 max-lg:overflow-y-auto max-lg:transition-transform max-lg:duration-200 max-lg:ease-out",
            narrow && !railOpen ? "max-lg:-translate-x-full" : "max-lg:translate-x-0",
            "lg:static lg:translate-x-0",
          ].join(" ")}
          style={{ borderColor: LINE, backgroundColor: SURFACE }}
        >
          <div
            className="mb-4 rounded-2xl border bg-gradient-to-b from-white to-[#f3f6ff] p-3 shadow-sm"
            style={{ borderColor: LINE }}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5f6368]">
                  AI analysis
                </p>
                <p className="text-sm font-semibold tracking-tight text-[#1f1f1f]">Opportunity scan</p>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: hasAnalysis ? "#e6f4ea" : "#e8eaed",
                  color: hasAnalysis ? "#137333" : "#5f6368",
                }}
              >
                {hasAnalysis ? `${Object.keys(catById).length} saved` : "Idle"}
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-[#5f6368]">
              {catOneLoadingId
                ? "Analyzing the open thread…"
                : catLoading
                  ? `Scoring ${emailsForAi.length} message${emailsForAi.length === 1 ? "" : "s"} (often 30–120s)…`
                  : "Score visible threads against your profile. Results stay on this device after refresh."}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={runCategorize}
                disabled={batchAiBusy || loadingList}
                className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-xs font-semibold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: `linear-gradient(145deg, ${ACCENT} 0%, #0842a8 100%)`,
                  boxShadow: "0 1px 2px rgba(60,64,67,0.25), 0 2px 8px rgba(11,87,208,0.2)",
                }}
                title={catLoading ? "Running…" : "Run or refresh AI on the selected scope"}
              >
                <span className="text-lg leading-none">{catLoading ? "…" : "✦"}</span>
                {catLoading ? "Running…" : hasAnalysis ? "Reanalyze" : "Run AI"}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[#80868b]">
              Re-running on threads you already scored clears those labels first, skips the server cache for them, and
              saves results in your browser for reloads.
            </p>

            <div className="mt-3 space-y-2">
              <div>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
                  Opportunity scan scope
                </span>
                <p className="mb-1.5 text-[10px] leading-snug text-[#80868b]">
                  Applies to the filtered thread list ({filteredEmailsOnly.length} visible).
                </p>
                <div className="flex flex-wrap gap-1" role="group" aria-label="AI batch scope">
                  {(["5", "10", "all", "custom"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={batchAiBusy}
                      aria-pressed={aiTopFilter === mode}
                      onClick={() => {
                        setAiTopFilter(mode);
                        if (mode === "custom") {
                          const n = filteredEmailsOnly.length;
                          if (n > 0) {
                            setScanRangeStart("1");
                            setScanRangeEnd(String(Math.min(10, n)));
                          }
                        }
                      }}
                      className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        aiTopFilter === mode
                          ? "border-[#0b57d0] bg-[#e8f0fe] text-[#174ea6]"
                          : "border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f1f3f4]"
                      }`}
                    >
                      {mode === "5"
                        ? "Top 5"
                        : mode === "10"
                          ? "Top 10"
                          : mode === "all"
                            ? "All"
                            : "Custom"}
                    </button>
                  ))}
                </div>
                {aiTopFilter === "custom" ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-2">
                      <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[10px] font-semibold text-[#5f6368]">Start (1-based)</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={scanRangeStart}
                          onChange={(e) => setScanRangeStart(e.target.value)}
                          disabled={batchAiBusy}
                          className="w-full rounded-lg border border-[#dadce0] bg-white px-2 py-1.5 text-xs font-medium text-[#1f1f1f] outline-none focus:border-[#0b57d0] disabled:opacity-50"
                          aria-label="Custom scan start position"
                        />
                      </label>
                      <label className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[10px] font-semibold text-[#5f6368]">Finish (1-based)</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={scanRangeEnd}
                          onChange={(e) => setScanRangeEnd(e.target.value)}
                          disabled={batchAiBusy}
                          className="w-full rounded-lg border border-[#dadce0] bg-white px-2 py-1.5 text-xs font-medium text-[#1f1f1f] outline-none focus:border-[#0b57d0] disabled:opacity-50"
                          aria-label="Custom scan finish position"
                        />
                      </label>
                    </div>
                    {customScanRangeError ? (
                      <p className="text-[10px] font-medium text-red-700">{customScanRangeError}</p>
                    ) : (
                      <p className="text-[10px] text-[#80868b]">
                        Whole numbers only; start ≤ finish; both between 1 and {filteredEmailsOnly.length || "—"}.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
              <div>
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
                  Engine
                </span>
                <LlmEnginePick
                  value={llmProvider}
                  disabled={batchAiBusy}
                  onChange={(v) => {
                    setLlmProvider(v);
                    setStoredLlmProvider(v);
                  }}
                />
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[#5f6368]">
              Keys: <span className="font-mono text-[9px]">GROQ_API_KEY</span> /{" "}
              <span className="font-mono text-[9px]">GEMINI_API_KEY</span> in API <span className="font-mono text-[9px]">.env</span>.
            </p>
            <p className="mt-2 rounded-lg bg-[#e8f0fe]/80 px-2 py-1.5 text-[10px] leading-snug text-[#174ea6]">
              <span className="font-semibold">API note:</span> “Run AI” sends your saved{" "}
              <span className="font-semibold">student profile JSON</span> with each categorize request so scores match
              your degree, skills, and goals.
            </p>
          </div>

          <div
            className="mb-4 rounded-2xl border bg-white/95 p-3 shadow-sm"
            style={{ borderColor: LINE, boxShadow: "0 2px 12px rgba(60,64,67,0.06)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5f6368]">Profile</p>
            {profileSummary.ok ? (
              <>
                <p className="mt-1 text-sm font-semibold text-[#1f1f1f]">
                  {profileSummary.data.login_id}
                </p>
                <dl className="mt-2 space-y-1 text-[11px] text-[#3c4043]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#80868b]">Degree</dt>
                    <dd className="font-medium">{profileSummary.data.degree}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#80868b]">Term / CGPA</dt>
                    <dd className="font-medium">
                      {profileSummary.data.semester} · {profileSummary.data.cgpa.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#80868b]">Skills</dt>
                    <dd className="max-w-[140px] truncate text-right font-medium" title={profileSummary.data.skills.join(", ")}>
                      {profileSummary.data.skills.slice(0, 2).join(", ")}
                      {profileSummary.data.skills.length > 2 ? "…" : ""}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="mt-1 text-[11px] leading-snug text-[#5f6368]">
                Save a valid profile so AI can score opportunities against your background.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Link
                href="/profile"
                className="block w-full rounded-lg py-2 text-center text-xs font-semibold text-white transition hover:opacity-95"
                style={{ backgroundColor: ACCENT }}
                onClick={() => setRailOpen(false)}
              >
                Open profile settings
              </Link>
              <button
                type="button"
                onClick={refreshStudentFromStorage}
                className="w-full rounded-lg border border-[#dadce0] bg-[#f8fafc] py-1.5 text-[11px] font-semibold text-[#1f1f1f] transition hover:bg-[#f1f3f4]"
              >
                Reload saved profile
              </button>
            </div>
          </div>

          <div className="mb-4 border-t px-1 pt-4" style={{ borderColor: LINE }}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[#5f6368]">
              Add your email
            </p>
            <p className="mb-2 text-xs leading-snug text-[#5f6368]">
              Paste <strong>plain text</strong>, a <span className="font-mono text-[10px]">JSON</span> array, or{" "}
              <strong>several plain-text emails</strong> separated by a line containing only{" "}
              <span className="rounded bg-[#fef7e0] px-1 font-mono text-[10px]">{PASTE_EMAIL_SEPARATOR}</span>. Upload{" "}
              <span className="font-mono text-[10px]">.txt</span> / <span className="font-mono text-[10px]">.json</span>{" "}
              works too. Each plain block uses its first line as the subject.
            </p>
            <button
              type="button"
              onClick={() => setPasteExampleOpen((o) => !o)}
              className="mb-2 w-full rounded-lg border border-[#dadce0] bg-white px-2 py-1.5 text-left text-[11px] font-semibold text-[#0b57d0] transition hover:bg-[#f1f3f4]"
            >
              {pasteExampleOpen ? "Hide example JSON" : "Show example JSON"}
            </button>
            {pasteExampleOpen ? (
              <pre
                className="mb-2 max-h-44 overflow-auto rounded-lg border border-[#dadce0] bg-[#0f172a] p-2 text-[10px] leading-relaxed text-slate-200"
                tabIndex={0}
              >
                {PASTE_EMAIL_JSON_EXAMPLE}
              </pre>
            ) : null}
            <textarea
              value={pasteDraft}
              onChange={(e) => {
                setPasteDraft(e.target.value);
                setPasteError(null);
              }}
              rows={5}
              placeholder="Paste email text or JSON…"
              className="mb-2 w-full resize-y rounded-lg border border-[#dadce0] bg-white px-2 py-1.5 text-[11px] text-[#1f1f1f] outline-none focus:border-[#0b57d0] font-sans"
              aria-label="Paste email text or JSON"
            />
            {pasteError ? (
              <p className="mb-2 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-800">{pasteError}</p>
            ) : null}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={addPastedToInbox}
                disabled={loadingList}
                className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                Add to inbox
              </button>
              <div className="flex gap-2">
                <label className="flex flex-1 cursor-pointer items-center justify-center rounded-lg border border-[#dadce0] bg-white px-2 py-2 text-center text-[11px] font-semibold text-[#1f1f1f] transition hover:bg-[#f1f3f4]">
                  <input
                    type="file"
                    accept=".json,.txt,application/json,text/plain"
                    className="sr-only"
                    onChange={(e) => onPasteFile(e.target.files?.[0] ?? null)}
                  />
                  Upload file
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPasteError(null);
                    setPasteDraft(PASTE_EMAIL_JSON_EXAMPLE);
                  }}
                  className="flex-1 rounded-lg border border-[#dadce0] bg-white px-2 py-2 text-[11px] font-semibold text-[#1f1f1f] transition hover:bg-[#f1f3f4]"
                >
                  Load example
                </button>
              </div>
              {pastedEmails.length > 0 ? (
                <button
                  type="button"
                  onClick={clearPastedInbox}
                  className="w-full rounded-lg border border-[#dadce0] bg-white py-2 text-[11px] font-semibold text-[#c5221f] transition hover:bg-[#fce8e6]"
                >
                  Clear pasted ({pastedEmails.length})
                </button>
              ) : null}
            </div>
          </div>

          <nav className="flex flex-col gap-0.5" aria-label="Folders">
            <button
              type="button"
              className="flex items-center gap-4 rounded-r-full py-2 pl-3 pr-4 text-[14px] font-medium"
              style={{
                backgroundColor: "#d3e3fd",
                color: "#001d35",
              }}
            >
              <IconInbox className="text-[#444746]" />
              <span className="flex-1 text-left">Inbox</span>
              <span className="text-xs font-medium text-[#444746]">{unreadCount}</span>
            </button>
            <div
              className="flex cursor-not-allowed items-center gap-4 rounded-r-full py-2 pl-3 pr-4 text-[14px] text-[#5f6368] opacity-60"
              title="Demo only"
            >
              <span className="w-5 text-center text-lg leading-none">★</span>
              <span>Starred</span>
            </div>
            <div
              className="flex cursor-not-allowed items-center gap-4 rounded-r-full py-2 pl-3 pr-4 text-[14px] text-[#5f6368] opacity-60"
              title="Demo only"
            >
              <span className="w-5 text-center text-lg leading-none">➤</span>
              <span>Sent</span>
            </div>
          </nav>

          <div className="mt-auto border-t pt-4 text-[11px] leading-relaxed text-[#5f6368]" style={{ borderColor: LINE }}>
            <p className="mb-2 text-[10px] leading-snug text-[#80868b]">
              Account fields live in the <span className="font-semibold text-[#3c4043]">Profile</span> card above.
            </p>
            {oauthConfigured && inboxSource === "demo" ? (
              <button
                type="button"
                onClick={() => {
                  window.location.href = getGoogleOAuthStartUrl();
                }}
                className="mt-3 w-full rounded-lg py-2 text-center text-[12px] font-semibold text-white"
                style={{ backgroundColor: ACCENT }}
              >
                Connect Gmail
              </button>
            ) : null}
            {oauthConfigured && inboxSource === "gmail" ? (
              <button
                type="button"
                onClick={() => void onDisconnectGmail()}
                className="mt-3 w-full rounded-lg border border-[#dadce0] bg-white py-2 text-center text-[12px] font-semibold text-[#1f1f1f]"
              >
                Disconnect Gmail
              </button>
            ) : null}
            <p className="mt-3">Inbox API: GET /api/v1/inbox</p>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile compose + folder strip */}
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 lg:hidden"
          style={{ borderColor: LINE, backgroundColor: SURFACE }}
        >
          <button
            type="button"
            onClick={runCategorize}
            disabled={batchAiBusy || loadingList}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg font-medium text-white shadow disabled:opacity-50"
            style={{ backgroundColor: ACCENT }}
            aria-label="Run AI categorization"
          >
            {catLoading ? "…" : "+"}
          </button>
          <div className="min-w-0 flex-1 text-xs text-[#5f6368]">
            {catOneLoadingId
              ? "Analyzing one message…"
              : catLoading
                ? `Analyzing ${aiScopeRunLabel} in list…`
                : "Run AI on the current scan scope."}
          </div>
          <select
            value={aiTopFilter}
            onChange={(e) => {
              const v = e.target.value as AiScopeMode;
              setAiTopFilter(v);
              if (v === "custom") {
                const n = filteredEmailsOnly.length;
                if (n > 0) {
                  setScanRangeStart("1");
                  setScanRangeEnd(String(Math.min(10, n)));
                }
              }
            }}
            className="shrink-0 rounded-md border border-[#dadce0] bg-white px-2 py-1 text-[11px] font-medium text-[#1f1f1f] outline-none"
            aria-label="AI scope"
          >
            <option value="5">Top 5</option>
            <option value="10">Top 10</option>
            <option value="all">All</option>
            <option value="custom">Custom…</option>
          </select>
          <div className="shrink-0">
            <LlmEnginePick
              compact
              value={llmProvider}
              disabled={batchAiBusy}
              onChange={(v) => {
                setLlmProvider(v);
                setStoredLlmProvider(v);
              }}
            />
          </div>
          <Link href="/profile" className="shrink-0 text-xs font-medium text-[#0b57d0]">
            Profile
          </Link>
          {oauthConfigured && inboxSource === "demo" ? (
            <button
              type="button"
              onClick={() => {
                window.location.href = getGoogleOAuthStartUrl();
              }}
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-white"
              style={{ backgroundColor: ACCENT }}
            >
              Gmail
            </button>
          ) : null}
          {oauthConfigured && inboxSource === "gmail" ? (
            <button
              type="button"
              onClick={() => void onDisconnectGmail()}
              className="shrink-0 rounded-md border border-[#dadce0] bg-white px-2 py-1 text-[11px] font-semibold text-[#1f1f1f]"
            >
              Leave Gmail
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMobilePasteOpen((v) => !v)}
            className="shrink-0 rounded-md border border-[#dadce0] bg-white px-2 py-1 text-[11px] font-semibold text-[#0b57d0]"
          >
            {mobilePasteOpen ? "Hide paste" : "Paste email"}
          </button>
        </div>

        {aiTopFilter === "custom" ? (
          <div
            className="flex flex-wrap items-end gap-2 border-b px-3 py-2 lg:hidden"
            style={{ borderColor: LINE, backgroundColor: "#fff" }}
          >
            <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-[#5f6368] sm:w-auto">
              Custom scan (1-based)
            </span>
            <label className="flex min-w-[5rem] flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-[#80868b]">Start</span>
              <input
                type="text"
                inputMode="numeric"
                value={scanRangeStart}
                onChange={(e) => setScanRangeStart(e.target.value)}
                disabled={batchAiBusy}
                className="rounded-md border border-[#dadce0] bg-white px-2 py-1 text-[11px] outline-none"
                aria-label="Custom scan start"
              />
            </label>
            <label className="flex min-w-[5rem] flex-1 flex-col gap-0.5">
              <span className="text-[10px] text-[#80868b]">Finish</span>
              <input
                type="text"
                inputMode="numeric"
                value={scanRangeEnd}
                onChange={(e) => setScanRangeEnd(e.target.value)}
                disabled={batchAiBusy}
                className="rounded-md border border-[#dadce0] bg-white px-2 py-1 text-[11px] outline-none"
                aria-label="Custom scan finish"
              />
            </label>
            {customScanRangeError ? (
              <p className="w-full text-[10px] font-medium text-red-700">{customScanRangeError}</p>
            ) : (
              <p className="w-full text-[10px] text-[#80868b]">
                List has {filteredEmailsOnly.length} thread{filteredEmailsOnly.length === 1 ? "" : "s"} after filters.
              </p>
            )}
          </div>
        ) : null}

        {mobilePasteOpen ? (
          <div
            className="border-b px-3 py-3 lg:hidden"
            style={{ borderColor: LINE, backgroundColor: "#fff" }}
          >
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#5f6368]">
              Add your email
            </p>
            <p className="mb-2 text-xs text-[#5f6368]">
              Plain text, JSON, or multiple blocks split with a line of{" "}
              <span className="font-mono text-[10px]">{PASTE_EMAIL_SEPARATOR}</span> — same as desktop.
            </p>
            <button
              type="button"
              onClick={() => setPasteExampleOpen((o) => !o)}
              className="mb-2 w-full rounded-lg border border-[#dadce0] bg-[#f8fafc] py-2 text-[11px] font-semibold text-[#0b57d0]"
            >
              {pasteExampleOpen ? "Hide example" : "Show example"}
            </button>
            {pasteExampleOpen ? (
              <pre className="mb-2 max-h-36 overflow-auto rounded-lg bg-[#0f172a] p-2 text-[10px] text-slate-200">
                {PASTE_EMAIL_JSON_EXAMPLE}
              </pre>
            ) : null}
            <textarea
              value={pasteDraft}
              onChange={(e) => {
                setPasteDraft(e.target.value);
                setPasteError(null);
              }}
              rows={4}
              placeholder="Paste email text or JSON…"
              className="mb-2 w-full rounded-lg border border-[#dadce0] px-2 py-1.5 text-[11px] outline-none font-sans"
            />
            {pasteError ? (
              <p className="mb-2 text-[11px] text-red-700">{pasteError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addPastedToInbox}
                className="rounded-lg px-3 py-2 text-[11px] font-semibold text-white"
                style={{ backgroundColor: ACCENT }}
              >
                Add to inbox
              </button>
              <label className="cursor-pointer rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-[11px] font-semibold">
                <input
                  type="file"
                  accept=".json,.txt,application/json,text/plain"
                  className="sr-only"
                  onChange={(e) => onPasteFile(e.target.files?.[0] ?? null)}
                />
                Upload
              </label>
              <button
                type="button"
                onClick={() => {
                  setPasteError(null);
                  setPasteDraft(PASTE_EMAIL_JSON_EXAMPLE);
                }}
                className="rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-[11px] font-semibold"
              >
                Load example
              </button>
              {pastedEmails.length > 0 ? (
                <button
                  type="button"
                  onClick={clearPastedInbox}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-800"
                >
                  Clear ({pastedEmails.length})
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          className="shrink-0 border-b px-3 py-2.5 sm:px-4"
          style={{ borderColor: LINE, backgroundColor: "#fff" }}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5f6368]">
                Relevant threads
              </p>
              <p className="mt-0.5 text-[11px] text-[#80868b]">
                Narrow the list before search and AI scans. Positions in “Custom” refer to this filtered order.
              </p>
            </div>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Filter threads by relevance"
            >
              {(
                [
                  ["all", "All"],
                  ["opportunities", "Opportunities"],
                  ["high_fit", "Strong / mod. fit"],
                  ["with_deadlines", "Has deadlines"],
                  ["unscored", "Not scored yet"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setListRelevanceFilter(id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    listRelevanceFilter === id
                      ? "text-white shadow-sm"
                      : "bg-white text-[#3c4043] hover:bg-[#f1f3f4]"
                  }`}
                  style={
                    listRelevanceFilter === id
                      ? { backgroundColor: ACCENT, borderColor: ACCENT }
                      : { borderColor: LINE }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <InboxScheduleHub
          emails={emails}
          catById={catById}
          hasAnalysis={hasAnalysis}
          stats={hubStats}
          lineColor={LINE}
          surfaceColor={SURFACE}
          onOpenThread={selectRow}
        />

        <SuggestedNextSteps items={batchSuggestions} lineColor={LINE} />

        {/* List + reading */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Thread list */}
          <section
            className={
              narrow && mobilePane === "thread"
                ? "hidden min-h-0 lg:flex"
                : "flex min-h-0 w-full min-w-0 flex-col border-b lg:w-[min(420px,40vw)] lg:max-w-[480px] lg:border-b-0 lg:border-r"
            }
            style={{ borderColor: LINE, backgroundColor: "#fff" }}
            aria-label="Message list"
          >
            <div
              className="flex h-12 shrink-0 items-center justify-between border-b px-2 sm:px-3"
              style={{ borderColor: LINE }}
            >
              <label className="inline-flex cursor-pointer items-center gap-2 px-2 text-[#5f6368]">
                <input type="checkbox" className="size-4 rounded border-[#dadce0]" disabled aria-disabled title="Demo" />
                <span className="hidden text-sm sm:inline">Select</span>
              </label>
              <span className="text-xs font-medium uppercase tracking-wide text-[#5f6368]">
                {filtered.length} conversations
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingList ? (
                <InboxListSkeleton />
              ) : loadError ? (
                <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</p>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-8 text-sm" style={{ color: MUTED }}>
                  {emptyListMessage}
                </p>
              ) : (
                filtered.map(({ email, cat }) => {
                  const active = email.id === resolvedId;
                  const { displayName: fromName } = parseSender(email.from);
                  return (
                    <button
                      key={email.id}
                      type="button"
                      onClick={() => selectRow(email.id)}
                      className="flex w-full gap-0 border-b text-left transition hover:bg-[#f2f6fc]"
                      style={{
                        borderColor: LINE,
                        backgroundColor: active ? "#e8f0fe" : "#fff",
                        boxShadow: active ? `inset 3px 0 0 ${ACCENT}` : undefined,
                      }}
                    >
                      <span
                        role="presentation"
                        className="flex w-10 shrink-0 items-start justify-center pt-3"
                        onClick={(e) => toggleStar(email.id, e)}
                      >
                        <IconStar
                          filled={!!starred[email.id]}
                          className={starred[email.id] ? "text-amber-500" : "text-[#5f6368]"}
                        />
                      </span>
                      <div className="min-w-0 flex-1 py-2.5 pr-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate text-sm ${active ? "font-semibold" : "font-medium"}`}
                            style={{ color: "#1f1f1f" }}
                          >
                            {fromName}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums" style={{ color: MUTED }}>
                            {email.date}
                          </span>
                        </div>
                        <div
                          className={`truncate text-sm ${active ? "font-medium" : "font-normal"}`}
                          style={{ color: "#1f1f1f" }}
                        >
                          {email.subject}
                        </div>
                        <div className="truncate text-[13px] leading-snug" style={{ color: MUTED }}>
                          {snippet(email.body)}
                        </div>
                        {cat ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span
                              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                              style={{
                                backgroundColor: cat.is_opportunity ? "#e6f4ea" : "#f1f3f4",
                                color: cat.is_opportunity ? "#137333" : "#5f6368",
                              }}
                            >
                              {cat.is_opportunity ? "Opportunity" : "Other"}
                            </span>
                            <span className="rounded bg-[#e8def8] px-1.5 py-0.5 text-[11px] font-medium text-[#4a4458]">
                              {cat.opportunity_type}
                            </span>
                            {(cat.eligibility?.length ?? 0) + (cat.required_documents?.length ?? 0) > 0 ||
                            cat.application_url ||
                            cat.contact_email ? (
                              <span
                                className="rounded-full border border-[#dadce0] bg-[#f1f3f4] px-2 py-0.5 text-[10px] font-semibold text-[#3c4043]"
                                title={[
                                  (cat.eligibility?.length ?? 0) > 0
                                    ? `${cat.eligibility!.length} eligibility`
                                    : "",
                                  (cat.required_documents?.length ?? 0) > 0
                                    ? `${cat.required_documents!.length} documents`
                                    : "",
                                  cat.application_url ? "link" : "",
                                  cat.contact_email ? "contact" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              >
                                Structured
                              </span>
                            ) : null}
                            {cat.scoring ? (
                              <span
                                title={scoringTooltip(cat.scoring)}
                                className="cursor-default rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900"
                              >
                                {cat.is_opportunity && (cat.priority_rank ?? 0) > 0
                                  ? `#${cat.priority_rank} · ${(cat.scoring.final_score * 100).toFixed(0)}%`
                                  : `0%`}
                              </span>
                            ) : null}
                            {cat.action_suggestions && cat.action_suggestions.length > 0 ? (() => {
                              const p = checklistProgress(
                                checklistStoreForRows,
                                email.id,
                                cat.action_suggestions!,
                              );
                              if (p.total === 0) return null;
                              return (
                                <span
                                  className="rounded-full border border-[#dadce0] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#3c4043]"
                                  title={`${p.done} of ${p.total} actions done`}
                                >
                                  ✓ {p.done}/{p.total}
                                </span>
                              );
                            })() : null}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Reading pane */}
          <section
            className={
              narrow && mobilePane === "list"
                ? "hidden min-h-0 flex-1 flex-col lg:flex"
                : "flex min-h-0 flex-1 flex-col"
            }
            style={{ backgroundColor: "#fff" }}
            aria-label="Message"
          >
            {loadingList ? (
              <InboxThreadSkeleton />
            ) : !selected ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <IconInbox className="size-12 text-[#dadce0]" />
                <p className="text-sm font-medium text-[#3c4043]">Select a message to read</p>
                <p className="max-w-xs text-xs" style={{ color: MUTED }}>
                  Choose a conversation from the list. Run AI categorization to see fit scores and rationale.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="flex h-12 shrink-0 items-center gap-1 border-b px-1 sm:px-2"
                  style={{ borderColor: LINE }}
                >
                  {narrow ? (
                    <button
                      type="button"
                      onClick={() => setMobilePane("list")}
                      className="rounded-full p-2 text-[#5f6368] hover:bg-[#f1f3f4] lg:hidden"
                      aria-label="Back to list"
                    >
                      <IconBack />
                    </button>
                  ) : null}
                  <div className="flex flex-1 justify-end gap-0.5 opacity-40">
                    <span className="rounded-full p-2 text-[#5f6368]" title="Demo">
                      ↩
                    </span>
                    <span className="rounded-full p-2 text-[#5f6368]" title="Demo">
                      ☰
                    </span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
                  <h1 className="text-[22px] font-normal leading-snug tracking-tight text-[#1f1f1f]">
                    {selected.email.subject}
                  </h1>
                  <div className="mt-4 flex flex-wrap items-start gap-4 border-b pb-4" style={{ borderColor: LINE }}>
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                      style={{ backgroundColor: "#1a73e8" }}
                      aria-hidden
                    >
                      {selectedSender?.avatarLetter}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                        <span className="font-semibold text-[#1f1f1f]">
                          {selectedSender?.displayName}
                        </span>
                        <span className="text-xs" style={{ color: MUTED }}>
                          {selected.email.date}
                        </span>
                      </div>
                      {selected.email.from.includes("<") ? (
                        <p className="mt-0.5 truncate text-xs" style={{ color: MUTED }} title={selected.email.from}>
                          {selected.email.from}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                          to me
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:flex-wrap sm:items-end" style={{ borderColor: LINE }}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#5f6368]">
                        This email — AI engine
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <LlmEnginePick
                          value={emailLlmById[selected.email.id] ?? llmProvider}
                          disabled={batchAiBusy || loadingList}
                          onChange={(v) =>
                            setEmailLlmById((prev) => ({ ...prev, [selected.email.id]: v }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            void runCategorizeOne(
                              selected.email,
                              emailLlmById[selected.email.id] ?? llmProvider,
                            )
                          }
                          disabled={batchAiBusy || loadingList}
                          className="rounded-full px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ backgroundColor: ACCENT }}
                        >
                          {catOneLoadingId === selected.email.id
                            ? "Analyzing…"
                            : selected.cat
                              ? "Reanalyze this email"
                              : "Analyze this email"}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={runCategorize}
                      disabled={batchAiBusy || loadingList}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#dadce0] bg-white px-3 py-1.5 text-xs font-semibold text-[#3c4043] transition hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <IconRefresh className="size-4" />
                      {catLoading ? "Reanalyzing…" : "All visible (batch)"}
                    </button>
                  </div>

                  {catError ? (
                    <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{catError}</p>
                  ) : null}
                  {catModelById[selected.email.id] || model ? (
                    <p className="mt-3 text-[11px]" style={{ color: MUTED }}>
                      Model (this thread):{" "}
                      <span className="font-mono text-[#3c4043]">
                        {catModelById[selected.email.id] ?? model ?? "—"}
                      </span>
                    </p>
                  ) : null}

                  {selected.cat ? (
                    <div className="mt-5 space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: selected.cat.is_opportunity ? "#e6f4ea" : "#f1f3f4",
                            color: selected.cat.is_opportunity ? "#137333" : "#5f6368",
                          }}
                        >
                          {selected.cat.is_opportunity ? "Opportunity signal" : "Not an opportunity"}
                        </span>
                        <span className="rounded-full bg-[#e8def8] px-3 py-1 text-xs font-medium text-[#4a4458]">
                          {selected.cat.opportunity_type}
                        </span>
                        <span className="rounded-full bg-[#e0f2fe] px-3 py-1 text-xs font-medium text-[#01579b]">
                          Match {(selected.cat.relevance_score * 100).toFixed(0)}%
                        </span>
                        <span
                          className="rounded-full px-3 py-1 text-xs font-medium"
                          style={{
                            backgroundColor: fitTone(selected.cat.profile_fit_label).bg,
                            color: fitTone(selected.cat.profile_fit_label).fg,
                          }}
                        >
                          {selected.cat.profile_fit_label.replace(/_/g, " ")}
                        </span>
                        {selected.cat.scoring ? (
                          <span
                            title={scoringTooltip(selected.cat.scoring)}
                            className="cursor-help rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900"
                          >
                            {selected.cat.is_opportunity && (selected.cat.priority_rank ?? 0) > 0
                              ? `Rank #${selected.cat.priority_rank} · ${(selected.cat.scoring.final_score * 100).toFixed(0)}%`
                              : `Deterministic ${(selected.cat.scoring.final_score * 100).toFixed(0)}%`}
                          </span>
                        ) : null}
                      </div>
                      {selected.cat.scoring ? (
                        <div
                          className="rounded-lg border px-3 py-2.5 text-[11px]"
                          style={{ borderColor: LINE, backgroundColor: "#f8fafc" }}
                          title={scoringTooltip(selected.cat.scoring)}
                        >
                          <span className="font-semibold uppercase tracking-wide text-[#5f6368]">
                            Deterministic breakdown
                          </span>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {(
                              [
                                ["Profile fit", selected.cat.scoring.profile_fit_score, "#1a73e8"],
                                ["Urgency", selected.cat.scoring.urgency_score, "#e37400"],
                                ["Completeness", selected.cat.scoring.completeness_score, "#137333"],
                              ] as const
                            ).map(([label, v, color]) => (
                              <div key={label}>
                                <div className="flex justify-between text-[10px] text-[#5f6368]">
                                  <span>{label}</span>
                                  <span className="font-mono tabular-nums">{(v * 100).toFixed(0)}%</span>
                                </div>
                                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[#e8eaed]">
                                  <div
                                    className="h-1.5 rounded-full transition-[width]"
                                    style={{ width: `${Math.min(100, v * 100)}%`, backgroundColor: color }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div
                        className="rounded-lg border px-4 py-3 text-sm leading-relaxed text-[#3c4043]"
                        style={{ borderColor: LINE, backgroundColor: "#f8fafc" }}
                      >
                        <span className="text-xs font-semibold uppercase tracking-wide text-[#5f6368]">
                          Assistant summary
                        </span>
                        <p className="mt-1">{selected.cat.rationale}</p>
                      </div>
                      {(selected.cat.deadlines?.length ?? 0) > 0 ? (
                        <div className="mt-3">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
                            Parsed deadlines
                          </span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {selected.cat.deadlines!.map((d) => (
                              <span
                                key={d}
                                className="rounded-full border border-amber-100 bg-[#fef7e0] px-2.5 py-0.5 text-[11px] font-semibold text-amber-950"
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {(selected.cat.eligibility?.length ?? 0) > 0 ? (
                        <div className="mt-3">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
                            Eligibility
                          </span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {selected.cat.eligibility!.map((e, i) => (
                              <span
                                key={`${i}-${e.slice(0, 32)}`}
                                className="rounded-full border border-[#cfe8cf] bg-[#e6f4ea] px-2.5 py-0.5 text-[11px] font-semibold text-[#137333]"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {(selected.cat.required_documents?.length ?? 0) > 0 ? (
                        <div className="mt-3">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
                            Required documents
                          </span>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {selected.cat.required_documents!.map((d, i) => (
                              <span
                                key={`${i}-${d.slice(0, 32)}`}
                                className="rounded-full border border-[#dadce0] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#202124]"
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {selected.cat.application_url || selected.cat.contact_email ? (
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#3c4043]">
                          {selected.cat.application_url ? (
                            <a
                              href={selected.cat.application_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="font-semibold text-[#0b57d0] underline underline-offset-2"
                            >
                              Apply / learn more ↗
                            </a>
                          ) : null}
                          {selected.cat.contact_email ? (
                            <a
                              href={`mailto:${selected.cat.contact_email}`}
                              className="font-semibold text-[#0b57d0] underline underline-offset-2"
                            >
                              {selected.cat.contact_email}
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                      {selected.cat.priority_rank && selected.cat.priority_rank > 0 ? (
                        <p className="mt-2 text-xs text-[#5f6368]">
                          Deterministic batch rank:{" "}
                          <span className="font-semibold text-[#174ea6]">{selected.cat.priority_rank}</span> (1 =
                          highest combined score in the last run — not raw LLM order)
                        </p>
                      ) : null}
                      <ActionChecklist
                        emailId={selected.email.id}
                        emailSubject={selected.email.subject}
                        emailFrom={selected.email.from}
                        loginId={effectiveLoginIdForStorage(student)}
                        items={selected.cat.action_suggestions ?? []}
                        deadlines={selected.cat.deadlines}
                      />
                    </div>
                  ) : (
                    <p className="mt-5 text-sm" style={{ color: MUTED }}>
                      Run AI categorization to see relevance, opportunity type, and fit for this thread.
                    </p>
                  )}

                  <EmailLinkSafetyPanel body={selected.email.body} lineColor={LINE} />

                  {selected.cat && (selected.cat.evidence_quotes?.length ?? 0) > 0 ? (
                    <div className="mt-6 max-w-3xl">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
                        Evidence in message
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {selected.cat.evidence_quotes!.map((q, i) => (
                          <span
                            key={`${i}-${q.slice(0, 40)}`}
                            className="max-w-full truncate rounded-full border border-amber-200 bg-[#fffbf0] px-2.5 py-0.5 text-[11px] font-medium text-amber-950"
                            title={q}
                          >
                            {q.length > 72 ? `${q.slice(0, 72)}…` : q}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <article className="mt-8 max-w-3xl text-[15px] leading-relaxed text-[#3c4043]">
                    <EmailBodyWithHighlights
                      body={selected.email.body}
                      quotes={selected.cat?.evidence_quotes}
                    />
                  </article>
                </div>
              </>
            )}
          </section>
        </div>
        </div>
      </div>
    </div>
  );
}
