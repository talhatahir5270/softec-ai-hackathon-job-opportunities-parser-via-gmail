"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import {
  AVAILABILITY,
  DEGREES,
  EXPERIENCE,
  FINANCIAL,
  INTERESTS,
  LOCATIONS,
  OPPORTUNITY_TYPES,
  SKILLS,
} from "@/lib/profile-enums";
import type { StudentProfile } from "@/lib/profile-schema";
import { studentProfileSchema } from "@/lib/profile-schema";
import { BrandLogo } from "@/components/BrandLogo";
import { loadStoredProfile, saveProfile } from "@/lib/profile-storage";
import { extractCvProfileFromPdf, saveStudentProfile } from "@/lib/api";

function toggleMember<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

const CV_PROFILE_KEYS = [
  "login_id",
  "degree",
  "semester",
  "cgpa",
  "skills",
  "interests",
  "preferred_opportunity_types",
  "location_preference",
  "financial_need",
  "availability",
  "experience_level",
] as const satisfies readonly (keyof StudentProfile)[];

const defaultProfile = (): StudentProfile => ({
  login_id: "demo_student",
  degree: "BS Computer Science",
  semester: 5,
  cgpa: 3.2,
  skills: ["Python", "React", "Machine Learning"],
  interests: ["Artificial Intelligence", "Web Development"],
  preferred_opportunity_types: ["Internship", "Hackathon"],
  location_preference: ["Pakistan", "Remote"],
  financial_need: "High",
  availability: "Summer",
  experience_level: "Intermediate",
});

function applySuggestionToProfile(
  base: StudentProfile,
  suggested: Partial<StudentProfile>,
): { next: StudentProfile; applied: (keyof StudentProfile)[] } {
  const applied: (keyof StudentProfile)[] = [];
  const next: StudentProfile = { ...base };
  for (const key of CV_PROFILE_KEYS) {
    const v = suggested[key];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (next as Record<string, unknown>)[key] = v;
    applied.push(key);
  }
  return { next, applied };
}

export default function CvImportPage() {
  const [profile, setProfile] = useState<StudentProfile>(() => loadStoredProfile() ?? defaultProfile());
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const preExtractRef = useRef<StudentProfile>(profile);
  const [aiFields, setAiFields] = useState<Set<keyof StudentProfile>>(() => new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [lastExtract, setLastExtract] = useState<{
    text_truncated: boolean;
    text_char_count: number;
    text_used_chars: number;
    text_preview: string;
    model: string;
    notes: string;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const aiWrap = (key: keyof StudentProfile, node: ReactNode) => (
    <div
      className={
        aiFields.has(key)
          ? "rounded-2xl ring-2 ring-indigo-400/70 ring-offset-2 ring-offset-white p-1 -m-1 transition-shadow"
          : ""
      }
    >
      {node}
    </div>
  );

  const renderChip = (
    label: string,
    isSelected: boolean,
    onChange: () => void,
    ai: boolean,
  ) => (
    <label
      key={label}
      className={`relative inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out border ${
        isSelected
          ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200 hover:bg-indigo-700"
          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-slate-50 hover:text-slate-900"
      } ${ai ? "ring-2 ring-amber-300/90" : ""}`}
    >
      <input type="checkbox" checked={isSelected} onChange={onChange} className="sr-only" />
      {isSelected && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </label>
  );

  const onPickFile = useCallback(
    async (file: File | null) => {
      setExtractError(null);
      setSaveMessage(null);
      setErrors([]);
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setExtractError("Please choose a PDF file (.pdf).");
        return;
      }
      const base = profileRef.current;
      preExtractRef.current = base;
      setBusy(true);
      setLastExtract(null);
      try {
        const res = await extractCvProfileFromPdf(file);
        const { next, applied } = applySuggestionToProfile(base, res.suggested);
        setProfile(next);
        setAiFields(new Set(applied));
        setLastExtract({
          text_truncated: res.text_truncated,
          text_char_count: res.text_char_count,
          text_used_chars: res.text_used_chars,
          text_preview: res.text_preview,
          model: res.model,
          notes: res.notes,
        });
        if (applied.length === 0) {
          setExtractError(
            "The model did not return any matching profile fields. Try a text-based PDF or edit the form manually.",
          );
        }
      } catch (e) {
        setExtractError(e instanceof Error ? e.message : "CV extract failed");
        setAiFields(new Set());
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onDiscardImport = useCallback(() => {
    setProfile(preExtractRef.current);
    setAiFields(new Set());
    setLastExtract(null);
    setExtractError(null);
  }, []);

  const onSave = useCallback(async () => {
    setSaveMessage(null);
    setErrors([]);
    const r = studentProfileSchema.safeParse(profile);
    if (!r.success) {
      setErrors(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      return;
    }
    saveProfile(r.data);
    setProfile(r.data);
    setAiFields(new Set());
    try {
      await saveStudentProfile(r.data);
      setSaveMessage("Profile saved and synced.");
    } catch {
      setSaveMessage("Saved locally. Sync will retry when the API is reachable.");
    }
  }, [profile]);

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-indigo-100 selection:text-indigo-900 font-sans">
      <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-indigo-50/80 via-slate-50/40 to-transparent pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <BrandLogo variant="header" priority />
              <span className="inline-flex items-center rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-700/10">
                PDF → LLM → profile
              </span>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Import from CV</h1>
            <p className="mt-3 max-w-2xl text-lg text-slate-600 leading-relaxed">
              Upload a <strong>PDF</strong> resume. We extract text, ask the model to map it to your structured profile,
              then show the <strong>full form</strong> so you can confirm or edit every field before saving.
            </p>
            <p className="text-sm text-slate-500">
              Fields the model fills are highlighted. Your previous values are kept for anything the CV does not
              mention — use <span className="font-semibold text-slate-700">Discard import</span> to restore the form
              from just before the last upload.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Link
              href="/profile"
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            >
              Open Profile
            </Link>
            <button
              type="button"
              onClick={onDiscardImport}
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
            >
              Discard import
            </button>
            <button
              type="button"
              onClick={onSave}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800"
            >
              Save profile
            </button>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="space-y-8">
            <section className="rounded-3xl border border-slate-200/60 bg-white p-6 shadow-xl shadow-slate-200/20">
              <h2 className="text-lg font-bold text-slate-900 mb-2">1. Upload PDF</h2>
              <p className="text-sm text-slate-600 mb-4">
                Scanned image-only PDFs may yield no text. Use a text-based PDF for best results.
              </p>
              <label className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
                {busy ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
                    <span className="text-sm font-medium text-slate-600">Extracting text and calling the model…</span>
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-indigo-700">Click to choose a PDF</span>
                    <span className="text-xs text-slate-500">Max 5 MB · server-side text extraction</span>
                  </>
                )}
              </label>
              {extractError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {extractError}
                </div>
              )}
            </section>

            {lastExtract && (
              <section className="rounded-3xl border border-slate-200/60 bg-white p-6 shadow-xl shadow-slate-200/20 space-y-3">
                <h2 className="text-lg font-bold text-slate-900">2. Extraction summary</h2>
                <div className="text-sm text-slate-600 space-y-1">
                  <div>
                    Characters in PDF: <span className="font-mono font-medium text-slate-900">{lastExtract.text_char_count}</span>
                    {" · "}
                    Sent to model:{" "}
                    <span className="font-mono font-medium text-slate-900">{lastExtract.text_used_chars}</span>
                  </div>
                  <div>
                    Model: <span className="font-mono text-slate-900">{lastExtract.model}</span>
                  </div>
                  {lastExtract.text_truncated && (
                    <div className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-xs font-medium border border-amber-200">
                      Part of the PDF was not sent to the model because of length limits. Check the preview and edit
                      fields manually if needed.
                    </div>
                  )}
                  {lastExtract.notes ? (
                    <p className="text-slate-700 pt-1">
                      <span className="font-semibold text-slate-800">Model notes: </span>
                      {lastExtract.notes}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="text-sm font-semibold text-indigo-700 hover:text-indigo-900"
                >
                  {showPreview ? "Hide" : "Show"} text preview
                </button>
                {showPreview && (
                  <pre className="max-h-48 overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-200 whitespace-pre-wrap">
                    {lastExtract.text_preview}
                    {lastExtract.text_preview.length >= 500 ? "…" : ""}
                  </pre>
                )}
              </section>
            )}

            <div className="rounded-3xl border border-slate-200/60 bg-white shadow-xl shadow-slate-200/20 overflow-hidden">
              <div className="p-8 space-y-10">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-900">3. Full profile — confirm & edit</h2>
                  {aiFields.size > 0 && (
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-700/15">
                      {aiFields.size} field{aiFields.size === 1 ? "" : "s"} updated from CV
                    </span>
                  )}
                </div>

                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 14l9-5-9-5-9 5 9 5z" />
                        <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Academic</h3>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {aiWrap(
                      "login_id",
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Login ID</label>
                        <input
                          type="text"
                          autoComplete="username"
                          className="block w-full rounded-xl border-0 py-3 px-4 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white font-mono"
                          value={profile.login_id}
                          onChange={(e) => setProfile((p) => ({ ...p, login_id: e.target.value }))}
                        />
                      </div>,
                    )}
                    {aiWrap(
                      "degree",
                      <div className="sm:col-span-2 lg:col-span-1">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Degree</label>
                        <select
                          className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                          value={profile.degree}
                          onChange={(e) =>
                            setProfile((p) => ({ ...p, degree: e.target.value as StudentProfile["degree"] }))
                          }
                        >
                          {DEGREES.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>,
                    )}
                    {aiWrap(
                      "semester",
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Semester</label>
                        <select
                          className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                          value={profile.semester}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              semester: Number(e.target.value) as StudentProfile["semester"],
                            }))
                          }
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                            <option key={n} value={n}>
                              {n === 9 ? "Graduated (9)" : `Semester ${n}`}
                            </option>
                          ))}
                        </select>
                      </div>,
                    )}
                    {aiWrap(
                      "cgpa",
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">CGPA</label>
                        <input
                          type="number"
                          min={0}
                          max={4}
                          step={0.01}
                          className="block w-full rounded-xl border-0 py-3 px-4 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                          value={profile.cgpa}
                          onChange={(e) => setProfile((p) => ({ ...p, cgpa: Number(e.target.value) }))}
                        />
                      </div>,
                    )}
                  </div>
                </section>

                <hr className="border-slate-200" />

                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Skills & interests</h3>
                  </div>
                  <div className="space-y-8">
                    <div>
                      {aiWrap(
                        "skills",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-3">Skills</label>
                          <div className="flex flex-wrap gap-2.5">
                            {SKILLS.map((s) =>
                              renderChip(
                                s,
                                profile.skills.includes(s),
                                () => setProfile((p) => ({ ...p, skills: toggleMember(p.skills, s) })),
                                aiFields.has("skills"),
                              ),
                            )}
                          </div>
                        </div>,
                      )}
                    </div>
                    <div>
                      {aiWrap(
                        "interests",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-3">Interests</label>
                          <div className="flex flex-wrap gap-2.5">
                            {INTERESTS.map((s) =>
                              renderChip(
                                s,
                                profile.interests.includes(s),
                                () => setProfile((p) => ({ ...p, interests: toggleMember(p.interests, s) })),
                                aiFields.has("interests"),
                              ),
                            )}
                          </div>
                        </div>,
                      )}
                    </div>
                  </div>
                </section>

                <hr className="border-slate-200" />

                <section>
                  <div className="flex items-center gap-2 mb-6">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Preferences</h3>
                  </div>
                  <div className="space-y-8">
                    <div>
                      {aiWrap(
                        "preferred_opportunity_types",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-3">Opportunity types</label>
                          <div className="flex flex-wrap gap-2.5">
                            {OPPORTUNITY_TYPES.map((s) =>
                              renderChip(
                                s,
                                profile.preferred_opportunity_types.includes(s),
                                () =>
                                  setProfile((p) => ({
                                    ...p,
                                    preferred_opportunity_types: toggleMember(p.preferred_opportunity_types, s),
                                  })),
                                aiFields.has("preferred_opportunity_types"),
                              ),
                            )}
                          </div>
                        </div>,
                      )}
                    </div>
                    <div>
                      {aiWrap(
                        "location_preference",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-3">Locations</label>
                          <div className="flex flex-wrap gap-2.5">
                            {LOCATIONS.map((s) =>
                              renderChip(
                                s,
                                profile.location_preference.includes(s),
                                () =>
                                  setProfile((p) => ({
                                    ...p,
                                    location_preference: toggleMember(p.location_preference, s),
                                  })),
                                aiFields.has("location_preference"),
                              ),
                            )}
                          </div>
                        </div>,
                      )}
                    </div>
                    <div className="grid gap-6 sm:grid-cols-3">
                      {aiWrap(
                        "financial_need",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Financial need</label>
                          <select
                            className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                            value={profile.financial_need}
                            onChange={(e) =>
                              setProfile((p) => ({
                                ...p,
                                financial_need: e.target.value as StudentProfile["financial_need"],
                              }))
                            }
                          >
                            {FINANCIAL.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </div>,
                      )}
                      {aiWrap(
                        "availability",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Availability</label>
                          <select
                            className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                            value={profile.availability}
                            onChange={(e) =>
                              setProfile((p) => ({
                                ...p,
                                availability: e.target.value as StudentProfile["availability"],
                              }))
                            }
                          >
                            {AVAILABILITY.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </div>,
                      )}
                      {aiWrap(
                        "experience_level",
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Experience</label>
                          <select
                            className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                            value={profile.experience_level}
                            onChange={(e) =>
                              setProfile((p) => ({
                                ...p,
                                experience_level: e.target.value as StudentProfile["experience_level"],
                              }))
                            }
                          >
                            {EXPERIENCE.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </div>,
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <div className="bg-slate-50 px-8 py-6 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-4">
                <div className="flex-1 min-w-[200px]">
                  {errors.length > 0 && (
                    <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
                      {errors.map((e) => (
                        <div key={e}>• {e}</div>
                      ))}
                    </div>
                  )}
                  {saveMessage && (
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-emerald-600">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {saveMessage}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onSave}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500"
                >
                  Save profile
                </button>
              </div>
            </div>
          </div>

          <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-3xl border border-slate-200/60 bg-white p-6 shadow-xl shadow-slate-200/20">
              <h2 className="text-base font-bold text-slate-900 mb-3">How it works</h2>
              <ol className="list-decimal list-inside text-sm text-slate-600 space-y-2">
                <li>Text is extracted from your PDF on the server (no vision OCR).</li>
                <li>Groq maps that text to allowed enum values only.</li>
                <li>We merge suggestions into your current profile and highlight changes.</li>
                <li>You edit anything, then save — same storage and API as the Profile page.</li>
              </ol>
            </div>
            <div className="rounded-3xl bg-slate-900 shadow-2xl shadow-slate-900/20 overflow-hidden border border-slate-800">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
                <span className="text-[11px] font-medium text-slate-400 font-mono tracking-wider">profile.json</span>
              </div>
              <pre className="p-4 max-h-[420px] overflow-auto text-[11px] leading-relaxed text-slate-300 font-mono">
                {JSON.stringify(profile, null, 2)}
              </pre>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
