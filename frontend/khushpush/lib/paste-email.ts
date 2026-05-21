import type { DemoEmail } from "./api";

/** sessionStorage key for pasted emails (client-only). */
export const PASTED_EMAILS_STORAGE_KEY = "khushpush_pasted_emails";

/**
 * Paste multiple plain-text emails in one box by putting a line with only `***` between them.
 * (Also accepts a single JSON array / object, or one plain-text message.)
 */
export const PASTE_EMAIL_SEPARATOR = "***";

/** Shown in the UI so users know the exact JSON shape the API expects. */
export const PASTE_EMAIL_JSON_EXAMPLE = `[
  {
    "from": "Internships <internships@university.edu>",
    "subject": "Summer 2026 internship applications are open",
    "date": "2026-04-18",
    "body": "We invite CS students to apply for our 10-week summer program. Deadline: May 1. Apply at careers.university.edu/internships."
  },
  {
    "from": "noreply@hackathon.io",
    "subject": "You are invited: City Tech Hackathon 2026",
    "date": "2026-04-17",
    "body": "Join us April 25–26 for a 24-hour build. Prizes include internships and cloud credits. Register: hackathon.io/register"
  }
]`;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeOne(raw: Record<string, unknown>, index: number): DemoEmail | null {
  if (!isNonEmptyString(raw.from) || !isNonEmptyString(raw.subject) || !isNonEmptyString(raw.body)) {
    return null;
  }
  const id =
    isNonEmptyString(raw.id) && raw.id.trim().length <= 128
      ? raw.id.trim()
      : `custom-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  const date =
    isNonEmptyString(raw.date) ? raw.date.trim() : new Date().toISOString().slice(0, 10);
  return {
    id,
    from: raw.from.trim(),
    subject: raw.subject.trim(),
    date,
    body: raw.body.trim(),
  };
}

/** One inbox item from free-form pasted text (not JSON). */
function demoEmailFromPlainText(raw: string, index: number): DemoEmail {
  const body = raw.trim();
  const lines = body.split(/\r?\n/);
  const firstNonEmpty = lines.map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  let subject = "(Pasted message)";
  if (firstNonEmpty) {
    subject = firstNonEmpty.length <= 140 ? firstNonEmpty : `${firstNonEmpty.slice(0, 137)}…`;
  }
  const emailMatch = body.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  const from = emailMatch ? `Contact <${emailMatch[0]}>` : "Pasted text <pasted@local>";
  const id = `custom-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  const date = new Date().toISOString().slice(0, 10);
  return { id, from, subject, date, body };
}

/** Split a big paste into blocks separated by a line containing only `***` (optional spaces). */
export function splitPastedEmailBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const byLine = normalized.split(/\n\s*\*{3}\s*\n/);
  if (byLine.length > 1) {
    return byLine.map((c) => c.trim()).filter(Boolean);
  }
  if (normalized.includes("***")) {
    return normalized
      .split(/\*{3}/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return [normalized];
}

function parseJsonToEmails(parsed: unknown, startIndex: number): { ok: true; emails: DemoEmail[] } | { ok: false; error: string } {
  const rows: Record<string, unknown>[] = Array.isArray(parsed)
    ? (parsed as unknown[]).filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
    : parsed !== null && typeof parsed === "object"
      ? [parsed as Record<string, unknown>]
      : [];

  if (rows.length === 0) {
    if (typeof parsed === "string" && parsed.trim()) {
      return { ok: true, emails: [demoEmailFromPlainText(parsed, startIndex)] };
    }
    return { ok: false, error: 'JSON must be one object or an array of objects with "from", "subject", and "body".' };
  }

  const emails: DemoEmail[] = [];
  for (let i = 0; i < rows.length; i++) {
    const one = normalizeOne(rows[i], startIndex + i);
    if (!one) {
      return {
        ok: false,
        error: `Item ${i + 1} needs non-empty "from", "subject", and "body" strings.`,
      };
    }
    emails.push(one);
  }
  return { ok: true, emails };
}

function parseOneBlock(
  segment: string,
  blockIndex: number,
  globalEmailIndex: { n: number },
): { ok: true; emails: DemoEmail[] } | { ok: false; error: string } {
  const trimmed = segment.trim();
  if (!trimmed) {
    return { ok: false, error: `Block ${blockIndex + 1} is empty.` };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const r = parseJsonToEmails(parsed, globalEmailIndex.n);
    if (r.ok) {
      globalEmailIndex.n += r.emails.length;
    }
    return r;
  } catch {
    const email = demoEmailFromPlainText(trimmed, globalEmailIndex.n++);
    return { ok: true, emails: [email] };
  }
}

export function parsePastedEmails(text: string): { ok: true; emails: DemoEmail[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste some message text or JSON first (see example below)." };
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) || (parsed !== null && typeof parsed === "object")) {
      return parseJsonToEmails(parsed, 0);
    }
  } catch {
    /* treat as plain text or multi-block */
  }

  const blocks = splitPastedEmailBlocks(trimmed);
  if (blocks.length === 0) {
    return { ok: false, error: "No email blocks found after splitting." };
  }

  const out: DemoEmail[] = [];
  const globalEmailIndex = { n: 0 };
  for (let b = 0; b < blocks.length; b++) {
    const r = parseOneBlock(blocks[b], b, globalEmailIndex);
    if (!r.ok) {
      return { ok: false, error: `Part ${b + 1}: ${r.error}` };
    }
    out.push(...r.emails);
  }

  if (out.length === 0) {
    return { ok: false, error: "Could not parse any messages from this paste." };
  }
  return { ok: true, emails: out };
}

export function loadPastedEmailsFromStorage(): DemoEmail[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(PASTED_EMAILS_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: DemoEmail[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row === null || typeof row !== "object") continue;
      const one = normalizeOne(row as Record<string, unknown>, i);
      if (one) out.push(one);
    }
    return out;
  } catch {
    return [];
  }
}

export function savePastedEmailsToStorage(emails: DemoEmail[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PASTED_EMAILS_STORAGE_KEY, JSON.stringify(emails));
  } catch {
    /* ignore quota / private mode */
  }
}
