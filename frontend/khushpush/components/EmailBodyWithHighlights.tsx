"use client";

import { Fragment, useMemo } from "react";

type Props = {
  body: string;
  quotes?: string[] | null;
};

/**
 * Renders email body with <mark> around each evidence quote that still exists as a substring.
 * Overlapping spans are merged so highlights stay readable.
 */
export function EmailBodyWithHighlights({ body, quotes }: Props) {
  const segments = useMemo(() => {
    const q = (quotes ?? []).map((s) => s.trim()).filter((s) => s.length >= 3 && body.includes(s));
    if (q.length === 0) {
      return [{ type: "text" as const, text: body }];
    }
    const spans = q
      .map((text) => ({ text, start: body.indexOf(text) }))
      .filter((s) => s.start >= 0)
      .sort((a, b) => a.start - b.start || b.text.length - a.text.length);

    const merged: { start: number; end: number }[] = [];
    for (const s of spans) {
      const end = s.start + s.text.length;
      const last = merged[merged.length - 1];
      if (!last || s.start >= last.end) {
        merged.push({ start: s.start, end });
      } else if (end > last.end) {
        last.end = end;
      }
    }

    const out: { type: "text" | "mark"; text: string }[] = [];
    let cursor = 0;
    for (const m of merged) {
      if (m.start > cursor) {
        out.push({ type: "text", text: body.slice(cursor, m.start) });
      }
      out.push({ type: "mark", text: body.slice(m.start, m.end) });
      cursor = m.end;
    }
    if (cursor < body.length) {
      out.push({ type: "text", text: body.slice(cursor) });
    }
    return out;
  }, [body, quotes]);

  return (
    <div className="whitespace-pre-wrap font-sans text-[14px] leading-[1.65] text-[#202124]">
      {segments.map((seg, i) =>
        seg.type === "mark" ? (
          <mark
            key={`m-${i}`}
            className="rounded-sm bg-[#fff8e1] px-0.5 text-[#202124] [text-decoration:inherit]"
          >
            {seg.text}
          </mark>
        ) : (
          <Fragment key={`t-${i}`}>{seg.text}</Fragment>
        ),
      )}
    </div>
  );
}
