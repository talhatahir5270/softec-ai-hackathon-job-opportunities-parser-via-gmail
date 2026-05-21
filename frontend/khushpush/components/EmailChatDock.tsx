"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getStoredGmailSessionId, postEmailChatMessage, type EmailChatTurn } from "@/lib/api";
import { loadStoredProfile } from "@/lib/profile-storage";

function hasChatScope(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(getStoredGmailSessionId() || loadStoredProfile()?.login_id);
}

export function EmailChatDock() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<EmailChatTurn[]>([
    {
      role: "assistant",
      content:
        "Ask anything about your indexed inbox — deadlines, senders, opportunities, or summaries. " +
        "Open the Inbox page once so messages can be embedded (uses a free local model; first run may download weights).",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!hasChatScope()) {
      setError("Set a profile login_id or connect Gmail first.");
      return;
    }
    setError(null);
    setBusy(true);
    setDraft("");
    const nextThread: EmailChatTurn[] = [...messages, { role: "user", content: text }];
    setMessages(nextThread);
    try {
      const reply = await postEmailChatMessage(nextThread.filter((m) => m.role !== "system"));
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages((prev) => prev.slice(0, -1));
      setDraft(text);
      setError(e instanceof Error ? e.message : "Chat request failed");
    } finally {
      setBusy(false);
    }
  }, [busy, draft, messages]);

  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-[100] flex flex-col items-start gap-2">
      {open ? (
        <div
          className="pointer-events-auto flex h-[min(28rem,calc(100dvh-7rem))] w-[min(calc(100vw-2.5rem),22rem)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          role="dialog"
          aria-label="Inbox chat"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Inbox chat</span>
            <button
              type="button"
              className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <IconClose className="size-5" />
            </button>
          </div>
          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-2 text-sm leading-relaxed"
          >
            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}-${m.content.slice(0, 24)}`}
                className={
                  m.role === "user"
                    ? "ml-6 rounded-xl bg-blue-600 px-3 py-2 text-white"
                    : "mr-4 rounded-xl bg-zinc-100 px-3 py-2 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                }
              >
                {m.content}
              </div>
            ))}
          </div>
          {error ? (
            <div className="shrink-0 border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          ) : null}
          <div className="flex shrink-0 gap-2 border-t border-zinc-200 p-2 dark:border-zinc-700">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask about your emails…"
              className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-blue-500/30 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              disabled={busy}
              aria-label="Chat message"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !draft.trim()}
              className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex size-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:ring-offset-zinc-950"
        aria-label={open ? "Close inbox chat" : "Open inbox chat"}
        aria-expanded={open}
      >
        {open ? <IconClose className="size-7" /> : <IconChat className="size-7" />}
      </button>
    </div>
  );
}

function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H8l-5 4v-4H4a2 2 0 01-2-2V6a2 2 0 012-2zm3 5h10v2H7V9zm0 4h7v2H7v-2z" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
