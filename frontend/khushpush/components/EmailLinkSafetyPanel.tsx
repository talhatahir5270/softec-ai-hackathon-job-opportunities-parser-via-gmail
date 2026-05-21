"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchLinkSafetyBatch, normalizeUrlForSafeBrowsing, type LinkSafetyResult } from "@/lib/api";

function extractUrls(body: string, max = 4): string[] {
  const re = /https?:\/\/[^\s\]<>"')]+/gi;
  const found = body.match(re) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    let u = raw.replace(/[,;.]+$/g, "");
    try {
      const parsed = new URL(u);
      u = parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
    } catch {
      continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

type Row = { url: string; key: string; loading: boolean; error?: string; data?: LinkSafetyResult };

export function EmailLinkSafetyPanel({ body, lineColor }: { body: string; lineColor: string }) {
  const urls = useMemo(() => extractUrls(body), [body]);
  const rowsSpec = useMemo(
    () =>
      urls.map((url) => {
        const key = normalizeUrlForSafeBrowsing(url);
        return { url, key: key ?? url };
      }),
    [urls],
  );
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    setRows(rowsSpec.map(({ url, key }) => ({ url, key, loading: true })));
  }, [rowsSpec]);

  const loadBatch = useCallback(async () => {
    if (urls.length === 0) return;
    setRows((prev) => prev.map((r) => ({ ...r, loading: true, error: undefined, data: undefined })));
    try {
      const map = await fetchLinkSafetyBatch(urls);
      setRows((prev) =>
        prev.map((r) => {
          const data = map[r.key] ?? map[r.url];
          if (!data) {
            return { ...r, loading: false, error: "No result returned for this URL." };
          }
          return { ...r, loading: false, data };
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lookup failed";
      setRows((prev) => prev.map((r) => ({ ...r, loading: false, error: msg })));
    }
  }, [urls]);

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  if (urls.length === 0) return null;

  return (
    <div
      className="mt-4 rounded-2xl border px-4 py-3"
      style={{ borderColor: lineColor, background: "linear-gradient(180deg, #fafbff 0%, #ffffff 100%)" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#5f6368]">
        Link safety (Google Safe Browsing)
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-[#80868b]">
        URLs are checked for malware, phishing (social engineering), and unwanted software. Results are cached on the
        server when MongoDB is configured.
      </p>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li
            key={r.url}
            className="rounded-xl border bg-white/90 px-3 py-2 text-[11px]"
            style={{ borderColor: lineColor }}
          >
            <p className="truncate font-mono text-[10px] text-[#174ea6]" title={r.url}>
              {r.url}
            </p>
            {r.loading ? <p className="mt-1 text-[#5f6368]">Checking…</p> : null}
            {r.error ? <p className="mt-1 text-red-700">{r.error}</p> : null}
            {r.data ? <SafeBrowsingSummary data={r.data} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SafeBrowsingSummary({ data }: { data: LinkSafetyResult }) {
  if (data.status === "INVALID_URL" && data.error) {
    return <p className="mt-1 text-amber-800">{data.error}</p>;
  }
  const safe = data.status === "SAFE";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[#3c4043]">
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          safe ? "bg-[#e6f4ea] text-[#137333]" : "bg-[#fce8e6] text-[#c5221f]"
        }`}
      >
        {safe ? "No known threats" : data.status}
      </span>
      {!safe && data.threat_type ? (
        <span className="text-[10px] text-[#5f6368]">
          Type: <span className="font-mono text-[#1f1f1f]">{data.threat_type}</span>
        </span>
      ) : null}
    </div>
  );
}
