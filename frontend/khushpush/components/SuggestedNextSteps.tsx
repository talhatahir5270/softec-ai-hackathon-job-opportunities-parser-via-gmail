"use client";

type Props = {
  items: string[];
  lineColor: string;
};

/** Polished strip for batch-level AI recommendations (matches inbox / calendar styling). */
export function SuggestedNextSteps({ items, lineColor }: Props) {
  if (items.length === 0) return null;
  return (
    <div
      className="shrink-0 border-b px-3 py-3 sm:px-4"
      style={{
        borderColor: lineColor,
        background: "linear-gradient(135deg, #f8fbff 0%, #eef4ff 42%, #ffffff 100%)",
      }}
    >
      <div className="mx-auto max-w-6xl">
        <div
          className="overflow-hidden rounded-2xl border shadow-sm"
          style={{
            borderColor: lineColor,
            background: "linear-gradient(180deg, #ffffff 0%, #fafcff 100%)",
            boxShadow: "0 4px 24px rgba(11, 87, 208, 0.08), 0 1px 2px rgba(60,64,67,0.06)",
          }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5"
            style={{ borderColor: lineColor }}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5f6368]">
                Suggested next steps
              </p>
              <p className="text-sm font-semibold tracking-tight text-[#1f1f1f]">From your latest AI run</p>
            </div>
            <span className="rounded-full bg-[#e8f0fe] px-3 py-1 text-[10px] font-bold text-[#174ea6]">
              {items.length} tip{items.length === 1 ? "" : "s"}
            </span>
          </div>
          <ol className="divide-y" style={{ borderColor: lineColor }}>
            {items.map((text, i) => (
              <li
                key={`${i}-${text.slice(0, 48)}`}
                className="flex gap-3 px-4 py-3 sm:px-5 sm:py-3.5"
                style={{ borderColor: lineColor }}
              >
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                  style={{
                    background: "linear-gradient(145deg, #0b57d0 0%, #0842a8 100%)",
                    boxShadow: "0 1px 3px rgba(11,87,208,0.35)",
                  }}
                  aria-hidden
                >
                  {i + 1}
                </span>
                <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[#3c4043]">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
