"use client";

import { useMemo, useState } from "react";

import type { CategorizationItem, DemoEmail } from "@/lib/api";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type DeadlineEvent = {
  title: string;
  type: "Application" | "Interview" | "Workshop" | "Submission" | "Reminder";
  time?: string;
  relatedSubject: string;
  relatedFrom: string;
  note: string;
  /** When set, opens this inbox row directly. */
  emailId?: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function senderDisplay(from: string): string {
  return from.replace(/<[^>]+>/g, "").trim() || from;
}

function deadlineInMonth(iso: string, anchorMonth: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return y === anchorMonth.getFullYear() && mo === anchorMonth.getMonth();
}

function mapOppToEventType(opp: string): DeadlineEvent["type"] {
  const t = opp.toLowerCase();
  if (t.includes("interview")) return "Interview";
  if (t.includes("workshop") || t.includes("session") || t.includes("info night")) return "Workshop";
  if (t.includes("hackathon") || t.includes("competition")) return "Application";
  if (t.includes("scholarship") || t.includes("grant") || t.includes("fellowship")) return "Submission";
  if (t.includes("internship") || t.includes("job") || t.includes("admission") || t.includes("exchange")) {
    return "Application";
  }
  return "Reminder";
}

function buildDeadlineMapFromCategorization(
  emails: DemoEmail[],
  catById: Record<string, CategorizationItem>,
  anchorMonth: Date,
): Record<string, DeadlineEvent[]> {
  const map: Record<string, DeadlineEvent[]> = {};
  for (const email of emails) {
    const cat = catById[email.id];
    if (!cat?.is_opportunity) continue;
    const deadlines = (cat.deadlines ?? []).filter((d) => deadlineInMonth(d, anchorMonth));
    for (const iso of deadlines) {
      const subj = email.subject.trim();
      const short = subj.length > 52 ? `${subj.slice(0, 52)}…` : subj;
      const ev: DeadlineEvent = {
        title: `${cat.opportunity_type} · ${short}`,
        type: mapOppToEventType(cat.opportunity_type),
        relatedSubject: email.subject,
        relatedFrom: email.from,
        note: (cat.rationale ?? "").trim() || "From AI categorization.",
        emailId: email.id,
      };
      const list = map[iso] ?? [];
      list.push(ev);
      map[iso] = list;
    }
  }
  return map;
}

function buildPrioritiesFromCategorization(
  emails: DemoEmail[],
  catById: Record<string, CategorizationItem>,
): PriorityItem[] {
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const todayMs = today0.getTime();

  type Row = { email: DemoEmail; cat: CategorizationItem; nearestMs: number; bestIso: string | null };
  const rows: Row[] = [];
  for (const email of emails) {
    const cat = catById[email.id];
    if (!cat?.is_opportunity) continue;
    let nearestMs = Number.POSITIVE_INFINITY;
    let bestIso: string | null = null;
    for (const iso of cat.deadlines ?? []) {
      const ms = Date.parse(`${iso.trim()}T12:00:00`);
      if (!Number.isNaN(ms) && ms < nearestMs) {
        nearestMs = ms;
        bestIso = iso.trim();
      }
    }
    rows.push({
      email,
      cat,
      nearestMs: Number.isFinite(nearestMs) ? nearestMs : Number.POSITIVE_INFINITY,
      bestIso,
    });
  }

  rows.sort((a, b) => {
    const pa = a.cat.priority_rank && a.cat.priority_rank > 0 ? a.cat.priority_rank : 99;
    const pb = b.cat.priority_rank && b.cat.priority_rank > 0 ? b.cat.priority_rank : 99;
    if (pa !== pb) return pa - pb;
    if (a.nearestMs !== b.nearestMs) return a.nearestMs - b.nearestMs;
    return (b.cat.relevance_score ?? 0) - (a.cat.relevance_score ?? 0);
  });

  return rows.slice(0, 8).map((r, idx) => {
    const pr = r.cat.priority_rank && r.cat.priority_rank > 0 ? r.cat.priority_rank : null;
    const label =
      pr != null ? `Batch priority #${pr}` : (r.cat.opportunity_type || "Opportunity").slice(0, 28);
    let deadlineLabel = "No explicit date in email";
    let accent: PriorityItem["accent"] = "medium";
    if (r.bestIso) {
      const ms = Date.parse(`${r.bestIso}T12:00:00`);
      const days = Math.ceil((ms - todayMs) / 86400000);
      deadlineLabel = new Date(ms).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      if (days < 0) accent = "high";
      else if (days <= 3) accent = "urgent";
      else if (days <= 14) accent = "high";
      else accent = "medium";
    }
    return {
      id: r.email.id,
      emailId: r.email.id,
      rank: idx + 1,
      label,
      subject: r.email.subject,
      from: senderDisplay(r.email.from),
      deadlineLabel,
      accent,
    };
  });
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** Deterministic dummy deadlines around “today” for the visible month. */
function buildDeadlineMap(anchorMonth: Date): Record<string, DeadlineEvent[]> {
  const y = anchorMonth.getFullYear();
  const m = anchorMonth.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const sameMonth = today.getFullYear() === y && today.getMonth() === m;
  const todayDom = sameMonth ? today.getDate() : Math.min(12, lastDay);

  const seeds: { dom: number; events: DeadlineEvent[] }[] = [
    {
      dom: Math.max(1, todayDom),
      events: [
        {
          title: "Profile review session",
          type: "Reminder",
          time: "4:00 PM",
          relatedSubject: "Reminder: career fair prep workshop",
          relatedFrom: "Career Services <careers@campus.edu>",
          note: "Bring your résumé PDF and elevator pitch. Room B-204.",
        },
      ],
    },
    {
      dom: Math.min(lastDay, todayDom + 2),
      events: [
        {
          title: "Scholarship form deadline",
          type: "Submission",
          time: "11:59 PM",
          relatedSubject: "Merit Scholarship 2026 — final submission",
          relatedFrom: "Financial Aid <aid@university.edu>",
          note: "Submit transcripts + recommendation letter in the portal.",
        },
      ],
    },
    {
      dom: Math.min(lastDay, todayDom + 5),
      events: [
        {
          title: "Hackathon registration closes",
          type: "Application",
          time: "End of day",
          relatedSubject: "City Tech Hackathon — last call to register",
          relatedFrom: "events@hackathon.io",
          note: "Team size2–4. You can still edit roster until this date.",
        },
        {
          title: "Optional info session",
          type: "Workshop",
          time: "6:30 PM",
          relatedSubject: "Re: Hackathon — Zoom link for info night",
          relatedFrom: "events@hackathon.io",
          note: "Recording will be posted if you cannot attend live.",
        },
      ],
    },
    {
      dom: Math.min(lastDay, todayDom + 9),
      events: [
        {
          title: "Internship interview slot",
          type: "Interview",
          time: "10:15 AM",
          relatedSubject: "Your application — Software Engineering Intern",
          relatedFrom: "Talent Team <careers@bigtech.example>",
          note: "Video call; link in calendar invite. Allow 45 minutes.",
        },
      ],
    },
    {
      dom: Math.min(lastDay, todayDom + 14),
      events: [
        {
          title: "Fellowship shortlist announcement",
          type: "Reminder",
          relatedSubject: "Research Fellowship — timeline update",
          relatedFrom: "Grad Office <grad@university.edu>",
          note: "Final decisions expected within one week after this notice.",
        },
      ],
    },
  ];

  const map: Record<string, DeadlineEvent[]> = {};
  for (const { dom, events } of seeds) {
    const key = `${y}-${pad2(m + 1)}-${pad2(dom)}`;
    map[key] = events;
  }
  return map;
}

export type PriorityItem = {
  id: string;
  emailId?: string;
  rank: number;
  label: string;
  subject: string;
  from: string;
  deadlineLabel: string;
  accent: "urgent" | "high" | "medium";
};

const DUMMY_PRIORITIES: PriorityItem[] = [
  {
    id: "prio-1",
    rank: 1,
    label: "Due in 48h",
    subject: "Merit Scholarship 2026 — final submission",
    from: "Financial Aid",
    deadlineLabel: "Apr 20 · 11:59 PM",
    accent: "urgent",
  },
  {
    id: "prio-2",
    rank: 2,
    label: "Interview",
    subject: "Your application — Software Engineering Intern",
    from: "Talent Team",
    deadlineLabel: "Apr 22 · 10:15 AM",
    accent: "high",
  },
  {
    id: "prio-3",
    rank: 3,
    label: "Registration",
    subject: "City Tech Hackathon — last call to register",
    from: "events@hackathon.io",
    deadlineLabel: "Apr 24 · EOD",
    accent: "medium",
  },
  {
    id: "prio-4",
    rank: 4,
    label: "Workshop",
    subject: "Reminder: career fair prep workshop",
    from: "Career Services",
    deadlineLabel: "Today · 4:00 PM",
    accent: "medium",
  },
];

const accentStyles = {
  urgent: { bar: "#c5221f", chip: "bg-red-50 text-red-800 border-red-100" },
  high: { bar: "#b06000", chip: "bg-amber-50 text-amber-900 border-amber-100" },
  medium: { bar: "#137333", chip: "bg-emerald-50 text-emerald-900 border-emerald-100" },
};

export type InboxHubStats = {
  totalThreads: number;
  analyzed: number;
  opportunities: number;
  /** Total ISO deadline entries across scored threads (for calendar density). */
  deadlineRows: number;
};

type Props = {
  emails: DemoEmail[];
  catById: Record<string, CategorizationItem>;
  /** When true, calendar and priority strip use AI fields instead of built-in demo placeholders. */
  hasAnalysis: boolean;
  stats?: InboxHubStats | null;
  onOpenThread: (emailId: string) => void;
  lineColor: string;
  surfaceColor: string;
};

function StatChip({
  label,
  value,
  lineColor,
  accent,
}: {
  label: string;
  value: string | number;
  lineColor: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-lg border px-2 py-1.5 text-center shadow-sm"
      style={{
        borderColor: lineColor,
        background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
      }}
    >
      <p className="text-[9px] font-semibold uppercase tracking-wide text-[#80868b]">{label}</p>
      <p className="text-sm font-bold tabular-nums" style={{ color: accent ?? "#1f1f1f" }}>
        {value}
      </p>
    </div>
  );
}

export function InboxScheduleHub({
  emails,
  catById,
  hasAnalysis,
  stats,
  onOpenThread,
  lineColor,
  surfaceColor,
}: Props) {
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const deadlineMap = useMemo(() => {
    if (hasAnalysis) {
      return buildDeadlineMapFromCategorization(emails, catById, monthCursor);
    }
    return buildDeadlineMap(monthCursor);
  }, [hasAnalysis, emails, catById, monthCursor]);

  const priorities = useMemo(() => {
    if (hasAnalysis) {
      return buildPrioritiesFromCategorization(emails, catById);
    }
    return DUMMY_PRIORITIES;
  }, [hasAnalysis, emails, catById]);

  const { label, weeks } = useMemo(() => {
    const y = monthCursor.getFullYear();
    const m = monthCursor.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells: ({ key: string; dom: number } | null)[] = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ key: `${y}-${pad2(m + 1)}-${pad2(d)}`, dom: d });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const wk: ({ key: string; dom: number } | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      wk.push(cells.slice(i, i + 7));
    }
    const label = first.toLocaleString(undefined, { month: "long", year: "numeric" });
    return { label, weeks: wk };
  }, [monthCursor]);

  const todayKey = toDateKey(new Date());
  const selectedEvents = selectedDayKey ? deadlineMap[selectedDayKey] ?? [] : [];

  const tryOpenMatchingEmail = (subject: string) => {
    const hit =
      emails.find((e) => e.subject.trim() === subject.trim()) ??
      emails.find((e) => subject.includes(e.subject.slice(0, 24)) || e.subject.includes(subject.slice(0, 24)));
    if (hit) onOpenThread(hit.id);
  };

  const openFromDeadline = (ev: DeadlineEvent) => {
    if (ev.emailId) {
      onOpenThread(ev.emailId);
      return;
    }
    tryOpenMatchingEmail(ev.relatedSubject);
  };

  return (
    <div
      className="shrink-0 border-b px-3 py-2 sm:px-4 sm:py-3"
      style={{
        borderColor: lineColor,
        background: `linear-gradient(180deg, ${surfaceColor} 0%, #ffffff 55%)`,
      }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
        {/* Calendar — compact width */}
        <section
          className="relative w-full max-w-[280px] shrink-0 overflow-hidden rounded-xl border shadow-sm sm:max-w-[300px]"
          style={{
            borderColor: lineColor,
            background: "linear-gradient(145deg, #ffffff 0%, #f4f8ff 48%, #eef4ff 100%)",
            boxShadow: "0 3px 16px rgba(11, 87, 208, 0.07),0 1px 2px rgba(60,64,67,0.05)",
          }}
          aria-label="Deadline calendar"
        >
          {stats ? (
            <div
              className="grid grid-cols-2 gap-1.5 border-b p-2 sm:grid-cols-4"
              style={{ borderColor: lineColor, background: "rgba(255,255,255,0.65)" }}
            >
              <StatChip label="Threads" value={stats.totalThreads} lineColor={lineColor} />
              <StatChip label="Scored" value={stats.analyzed} lineColor={lineColor} accent="#174ea6" />
              <StatChip label="Opps" value={stats.opportunities} lineColor={lineColor} accent="#137333" />
              <StatChip label="Dates" value={stats.deadlineRows} lineColor={lineColor} accent="#b06000" />
            </div>
          ) : null}
          <div
            className="flex items-center justify-between gap-1 border-b px-2.5 py-2"
            style={{ borderColor: lineColor }}
          >
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#5f6368]">
                Deadlines
              </p>
              <h2 className="truncate text-sm font-semibold tracking-tight text-[#1f1f1f]">{label}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-0">
              <button
                type="button"
                onClick={() => setMonthCursor((d) => addMonths(d, -1))}
                className="rounded-full p-1.5 text-sm text-[#5f6368] transition hover:bg-white/80"
                aria-label="Previous month"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setMonthCursor(startOfMonth(new Date()))}
                className="rounded-full px-2 py-1 text-[10px] font-semibold text-[#0b57d0] hover:bg-white/80"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setMonthCursor((d) => addMonths(d, 1))}
                className="rounded-full p-1.5 text-sm text-[#5f6368] transition hover:bg-white/80"
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          </div>

          <div className="p-2">
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[8px] font-semibold uppercase tracking-wide text-[#80868b]">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-0.5">
                  {w.slice(0, 2)}
                </div>
              ))}
            </div>
            <div className="grid gap-0.5">
              {weeks.map((row, wi) => (
                <div key={`w-${wi}`} className="grid grid-cols-7 gap-0.5">
                  {row.map((cell, ci) => {
                    if (!cell) {
                      return <div key={`e-${wi}-${ci}`} className="aspect-square min-h-[1.6rem]" />;
                    }
                    const hasDeadline = Boolean(deadlineMap[cell.key]?.length);
                    const isToday = cell.key === todayKey;
                    const isSelected = cell.key === selectedDayKey;
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        onClick={() => setSelectedDayKey((k) => (k === cell.key ? null : cell.key))}
                        className={[
                          "relative flex aspect-square min-h-[1.6rem] flex-col items-center justify-center rounded-lg text-[11px] font-medium transition",
                          isSelected
                            ? "bg-[#0b57d0] text-white shadow-sm shadow-[#0b57d0]/20"
                            : isToday
                              ? "bg-[#e8f0fe] text-[#174ea6] ring-1 ring-[#0b57d0]/35"
                              : "bg-white/70 text-[#3c4043] hover:bg-white hover:shadow-sm",
                        ].join(" ")}
                        style={{ border: `1px solid ${isSelected ? "#0b57d0" : lineColor}` }}
                      >
                        <span>{cell.dom}</span>
                        {hasDeadline ? (
                          <span
                            className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full"
                            style={{
                              backgroundColor: isSelected ? "#fef7e0" : "#0b57d0",
                              boxShadow: isSelected ? "0 0 0 1px rgba(255,255,255,0.5)" : undefined,
                            }}
                            aria-hidden
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {selectedDayKey ? (
            <div
              className="border-t px-2.5 py-2"
              style={{ borderColor: lineColor, backgroundColor: "rgba(255,255,255,0.92)" }}
            >
              <p className="mb-1.5 text-[10px] font-semibold text-[#5f6368]">
                {new Date(selectedDayKey + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              {selectedEvents.length === 0 ? (
                <p className="text-[11px] leading-snug text-[#5f6368]">
                  {hasAnalysis
                    ? "No AI-parsed deadlines on this date. Try another day with a dot or switch month."
                    : "No demo deadlines on this date. Try another highlighted day."}
                </p>
              ) : (
                <ul className="max-h-[200px] space-y-2 overflow-y-auto">
                  {selectedEvents.map((ev, evi) => (
                    <li
                      key={`${ev.emailId ?? ev.relatedSubject}-${ev.title}-${evi}`}
                      className="rounded-lg border bg-white px-2 py-1.5"
                      style={{ borderColor: lineColor }}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-[#e8f0fe] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#174ea6]">
                          {ev.type}
                        </span>
                        {ev.time ? (
                          <span className="text-[10px] font-medium text-[#5f6368]">{ev.time}</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] font-semibold leading-tight text-[#1f1f1f]">{ev.title}</p>
                      <p className="mt-0.5 text-[10px] leading-snug text-[#5f6368]">
                        <span className="font-medium text-[#3c4043]">Email:</span> {ev.relatedSubject}
                      </p>
                      <p className="text-[10px] text-[#5f6368]">{ev.relatedFrom}</p>
                      <p className="mt-1 text-[10px] leading-relaxed text-[#3c4043]">{ev.note}</p>
                      <button
                        type="button"
                        onClick={() => openFromDeadline(ev)}
                        className="mt-1 text-[10px] font-semibold text-[#0b57d0] hover:underline"
                      >
                        Open in inbox
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="border-t px-2 py-1.5 text-center text-[10px] text-[#5f6368]" style={{ borderColor: lineColor }}>
              {hasAnalysis
                ? "Tap a dotted day to see AI-parsed deadlines for that date."
                : "Tap a dotted day for details (demo)."}
            </p>
          )}
        </section>

        {/* Priority strip */}
        <section
          className="flex w-full flex-col rounded-2xl border shadow-sm lg:w-[min(380px,34vw)] lg:shrink-0"
          style={{
            borderColor: lineColor,
            background: "linear-gradient(180deg, #ffffff 0%, #fafbff 100%)",
            boxShadow: "0 4px 20px rgba(60,64,67,0.06)",
          }}
          aria-label="Latest priority emails"
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: lineColor }}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5f6368]">
                Priority inbox
              </p>
              <h2 className="text-lg font-semibold tracking-tight text-[#1f1f1f]">Latest deadlines</h2>
            </div>
            <span className="rounded-full bg-[#e8f0fe] px-2.5 py-1 text-[10px] font-bold text-[#174ea6]">
              {hasAnalysis ? "AI" : "Demo"}
            </span>
          </div>
          <ul className="max-h-[min(340px,50vh)] flex-1 divide-y overflow-y-auto" style={{ borderColor: lineColor }}>
            {priorities.length === 0 && hasAnalysis ? (
              <li className="px-4 py-6 text-center text-[12px] leading-relaxed text-[#5f6368]">
                No opportunity rows in the last analysis, or no deadlines were parsed. Run batch AI on visible messages
                so the model can extract YYYY-MM-DD dates from the bodies.
              </li>
            ) : null}
            {priorities.map((p) => {
              const st = accentStyles[p.accent];
              return (
                <li key={p.id} className="flex gap-0">
                  <div className="w-1 shrink-0 rounded-l-lg" style={{ backgroundColor: st.bar }} aria-hidden />
                  <div className="min-w-0 flex-1 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.chip}`}
                      >
                        {p.label}
                      </span>
                      <span className="text-[10px] font-medium text-[#80868b]">#{p.rank}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-[#1f1f1f]">{p.subject}</p>
                    <p className="mt-0.5 text-xs text-[#5f6368]">{p.from}</p>
                    <p className="mt-1 text-[11px] font-medium text-[#174ea6]">{p.deadlineLabel}</p>
                    <button
                      type="button"
                      onClick={() =>
                        p.emailId ? onOpenThread(p.emailId) : tryOpenMatchingEmail(p.subject)
                      }
                      className="mt-2 text-[11px] font-semibold text-[#0b57d0] hover:underline"
                    >
                      View in inbox
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
