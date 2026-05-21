/**
 * Persists per-opportunity action-checklist tick state in localStorage.
 *
 * Key: khushpush-action-checklist-v1:<pack>:<loginId>
 * Suggestion keys use a stable hash so small text edits remap; major LLM rewrites reset ticks.
 */

import type { InboxPackMode } from "@/lib/api";

export const ACTION_CHECKLIST_CHANGED_EVENT = "khushpush-checklist-changed";

const PREFIX = "khushpush-action-checklist-v1";
const DEFAULT_LOGIN = "demo_student";

export type ChecklistItemKey = string;

export type EmailChecklistState = {
  checked: Record<ChecklistItemKey, true>;
  updatedAt: number;
};

export type ChecklistStore = {
  emails: Record<string, EmailChecklistState>;
  updatedAt: number;
};

function storageKey(pack: InboxPackMode, loginId: string): string {
  const lid = (loginId || DEFAULT_LOGIN).trim() || DEFAULT_LOGIN;
  return `${PREFIX}:${pack}:${lid}`;
}

export function hashSuggestion(text: string): ChecklistItemKey {
  let h = 5381;
  const s = text.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `s${(h >>> 0).toString(36)}`;
}

export function loadChecklistStore(pack: InboxPackMode, loginId: string): ChecklistStore {
  if (typeof window === "undefined") return { emails: {}, updatedAt: 0 };
  try {
    const raw = window.localStorage.getItem(storageKey(pack, loginId));
    if (!raw) return { emails: {}, updatedAt: 0 };
    const j = JSON.parse(raw) as Partial<ChecklistStore>;
    return {
      emails: j && typeof j.emails === "object" && j.emails ? (j.emails as ChecklistStore["emails"]) : {},
      updatedAt: typeof j?.updatedAt === "number" ? j.updatedAt : 0,
    };
  } catch {
    return { emails: {}, updatedAt: 0 };
  }
}

export function saveChecklistStore(pack: InboxPackMode, loginId: string, store: ChecklistStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(pack, loginId), JSON.stringify(store));
  } catch {
    /* private mode / quota */
  }
}

export function setItemChecked(
  store: ChecklistStore,
  emailId: string,
  itemKey: ChecklistItemKey,
  checked: boolean,
): ChecklistStore {
  const now = Date.now();
  const prev = store.emails[emailId] ?? { checked: {}, updatedAt: 0 };
  const nextChecked = { ...prev.checked };
  if (checked) nextChecked[itemKey] = true;
  else delete nextChecked[itemKey];
  return {
    emails: {
      ...store.emails,
      [emailId]: { checked: nextChecked, updatedAt: now },
    },
    updatedAt: now,
  };
}

export function isItemChecked(store: ChecklistStore, emailId: string, itemKey: ChecklistItemKey): boolean {
  return Boolean(store.emails[emailId]?.checked?.[itemKey]);
}

export function checklistProgress(
  store: ChecklistStore,
  emailId: string,
  items: string[],
): { done: number; total: number; pct: number } {
  const total = items.length;
  if (total === 0) return { done: 0, total: 0, pct: 0 };
  let done = 0;
  for (const t of items) {
    if (isItemChecked(store, emailId, hashSuggestion(t))) done++;
  }
  return { done, total, pct: done / total };
}
