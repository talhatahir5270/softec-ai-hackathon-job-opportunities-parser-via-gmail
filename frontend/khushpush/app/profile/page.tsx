"use client";

import { useCallback, useEffect, useState } from "react";

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
import { clearStoredProfile, loadStoredProfile, saveProfile } from "@/lib/profile-storage";
import { fetchDemoInbox, saveStudentProfile } from "@/lib/api";

function toggleMember<T extends string>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

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

export default function ProfilePage() {
  const [profile, setProfile] = useState<StudentProfile>(() => loadStoredProfile() ?? defaultProfile());
  const [loaded, setLoaded] = useState(() => loadStoredProfile() !== null);
  const [errors, setErrors] = useState<string[]>([]);
  const [apiHint, setApiHint] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (loadStoredProfile()) return;
    let cancelled = false;
    (async () => {
      try {
        const { student } = await fetchDemoInbox();
        const parsed = studentProfileSchema.safeParse(student);
        if (!cancelled && parsed.success) setProfile(parsed.data);
      } catch (e) {
        if (!cancelled) {
          setApiHint(
            e instanceof Error
              ? e.message
              : "Could not load demo defaults. Is the API running?",
          );
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
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
    setErrors([]);
    try {
      await saveStudentProfile(r.data);
      setSaveMessage("Profile successfully synced and secured.");
    } catch {
      setSaveMessage("Saved locally. Background sync pending network connection.");
    }
  }, [profile]);

  const onResetPackaged = useCallback(async () => {
    setErrors([]);
    try {
      const { student } = await fetchDemoInbox();
      const parsed = studentProfileSchema.safeParse(student);
      if (parsed.success) {
        setProfile(parsed.data);
        saveProfile(parsed.data);
      } else {
        setErrors(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
      }
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Failed to load packaged profile"]);
    }
  }, []);

  const onClearLocal = useCallback(() => {
    clearStoredProfile();
    setProfile(defaultProfile());
    setErrors([]);
  }, []);

  const featureCards = [
    {
      title: "Standardized Inputs",
      body: "Enum-based fields keep profile data consistent and safer for scoring logic.",
      icon: (
        <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: "AI Opportunity Matching",
      body: "Your profile is used to classify inbox emails by opportunity type and relevance.",
      icon: (
        <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
    {
      title: "Local + Backend Sync",
      body: "Profiles are saved in-browser first, then synced to API when available.",
      icon: (
        <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
        </svg>
      ),
    },
  ];

  const renderChip = (
    label: string,
    isSelected: boolean,
    onChange: () => void
  ) => (
    <label
      key={label}
      className={`relative inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ease-in-out border ${
        isSelected
          ? "bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200 hover:bg-indigo-700"
          : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-slate-50 hover:text-slate-900"
      }`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onChange}
        className="sr-only"
      />
      {isSelected && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </label>
  );

  return (
    <div className="min-h-screen bg-slate-50 selection:bg-indigo-100 selection:text-indigo-900 font-sans">
      {/* Decorative Background Gradient */}
      <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-indigo-50/80 via-slate-50/40 to-transparent pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <BrandLogo variant="header" priority />
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
                Setup Workspace
              </span>
            </div>
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
                Student Profile
              </h1>
              <p className="mt-3 max-w-2xl text-lg text-slate-600 leading-relaxed">
                Build your structured profile once. Our explainable AI uses this footprint to rank scholarships, internships, and hackathons precisely tailored to you.
              </p>
            </div>
          </div>

          {/* Action Header Buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onResetPackaged}
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 transition-colors"
            >
              Load Defaults
            </button>
            <button
              onClick={onSave}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800 transition-all hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save Profile
            </button>
          </div>
        </div>

        {!loaded ? (
          <div className="flex min-h-[400px] items-center justify-center rounded-3xl border border-slate-200/60 bg-white/50 backdrop-blur-sm shadow-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
              <p className="text-sm font-medium text-slate-500 animate-pulse">Initializing your workspace...</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_380px] xl:gap-12">
            
            {/* Main Form Content */}
            <div className="space-y-8">
              {apiHint && (
                <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200/60">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-amber-800">Connection Notice</h3>
                      <div className="mt-1 text-sm text-amber-700">{apiHint}</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-3xl border border-slate-200/60 bg-white shadow-xl shadow-slate-200/20 overflow-hidden">
                <div className="p-8 space-y-10">
                  
                  {/* Academic Section */}
                  <section>
                    <div className="flex items-center gap-2 mb-6">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M12 14l9-5-9-5-9 5 9 5z" />
                          <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                        </svg>
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">Academic Overview</h2>
                    </div>
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Login ID</label>
                        <input
                          type="text"
                          autoComplete="username"
                          className="block w-full max-w-md rounded-xl border-0 py-3 px-4 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white font-mono"
                          placeholder="e.g. ali.cs26"
                          value={profile.login_id}
                          onChange={(e) => setProfile((p) => ({ ...p, login_id: e.target.value }))}
                        />
                        <p className="mt-1.5 text-xs text-slate-500">
                          Used to sync your profile and inbox snapshot. Letters, numbers, dot, underscore, or dash only.
                        </p>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-1">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Degree Program</label>
                        <select
                          className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                          value={profile.degree}
                          onChange={(e) => setProfile((p) => ({ ...p, degree: e.target.value as StudentProfile["degree"] }))}
                        >
                          {DEGREES.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Current Semester</label>
                        <select
                          className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                          value={profile.semester}
                          onChange={(e) => setProfile((p) => ({ ...p, semester: Number(e.target.value) as StudentProfile["semester"] }))}
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                            <option key={n} value={n}>
                              {n === 9 ? "Graduated (9)" : `Semester ${n}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">CGPA</label>
                        <input
                          type="number"
                          min={0}
                          max={4}
                          step={0.01}
                          className="block w-full rounded-xl border-0 py-3 px-4 text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                          value={profile.cgpa}
                          onChange={(e) => setProfile((p) => ({ ...p, cgpa: Number(e.target.value) }))}
                        />
                      </div>
                    </div>
                  </section>

                  <hr className="border-slate-200" />

                  {/* Skills & Interests */}
                  <section>
                    <div className="flex items-center gap-2 mb-6">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">Capabilities & Interests</h2>
                    </div>
                    <div className="space-y-8">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Technical Skills</label>
                        <div className="flex flex-wrap gap-2.5">
                          {SKILLS.map((s) => renderChip(s, profile.skills.includes(s), () => setProfile((p) => ({ ...p, skills: toggleMember(p.skills, s) }))))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Core Interests</label>
                        <div className="flex flex-wrap gap-2.5">
                          {INTERESTS.map((s) => renderChip(s, profile.interests.includes(s), () => setProfile((p) => ({ ...p, interests: toggleMember(p.interests, s) }))))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <hr className="border-slate-200" />

                  {/* Preferences Section */}
                  <section>
                    <div className="flex items-center gap-2 mb-6">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <h2 className="text-xl font-bold text-slate-900">Career Preferences</h2>
                    </div>
                    
                    <div className="space-y-8">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Preferred Opportunities</label>
                        <div className="flex flex-wrap gap-2.5">
                          {OPPORTUNITY_TYPES.map((s) => renderChip(s, profile.preferred_opportunity_types.includes(s), () => setProfile((p) => ({ ...p, preferred_opportunity_types: toggleMember(p.preferred_opportunity_types, s) }))))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-3">Location Preferences</label>
                        <div className="flex flex-wrap gap-2.5">
                          {LOCATIONS.map((s) => renderChip(s, profile.location_preference.includes(s), () => setProfile((p) => ({ ...p, location_preference: toggleMember(p.location_preference, s) }))))}
                        </div>
                      </div>

                      <div className="grid gap-6 sm:grid-cols-3 pt-2">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Financial Need</label>
                          <select
                            className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                            value={profile.financial_need}
                            onChange={(e) => setProfile((p) => ({ ...p, financial_need: e.target.value as StudentProfile["financial_need"] }))}
                          >
                            {FINANCIAL.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Availability</label>
                          <select
                            className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                            value={profile.availability}
                            onChange={(e) => setProfile((p) => ({ ...p, availability: e.target.value as StudentProfile["availability"] }))}
                          >
                            {AVAILABILITY.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">Experience Level</label>
                          <select
                            className="block w-full rounded-xl border-0 py-3 pl-4 pr-10 text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-indigo-600 sm:text-sm sm:leading-6 transition-shadow shadow-sm bg-white"
                            value={profile.experience_level}
                            onChange={(e) => setProfile((p) => ({ ...p, experience_level: e.target.value as StudentProfile["experience_level"] }))}
                          >
                            {EXPERIENCE.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
                
                {/* Form Footer / Actions */}
                <div className="bg-slate-50 px-8 py-6 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex-1">
                    {errors.length > 0 && (
                      <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
                        {errors.map((e) => <div key={e}>• {e}</div>)}
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
                  
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      onClick={onClearLocal}
                      className="text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors px-3 py-2"
                    >
                      Reset form
                    </button>
                    <button
                      onClick={onSave}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky Right Sidebar */}
            <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
              
              {/* Features Card */}
              <div className="rounded-3xl border border-slate-200/60 bg-white p-6 shadow-xl shadow-slate-200/20">
                <h2 className="text-base font-bold text-slate-900 mb-5">Platform Architecture</h2>
                <div className="space-y-4">
                  {featureCards.map((f) => (
                    <div key={f.title} className="group relative flex gap-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-colors hover:bg-slate-50">
                      <div className="mt-1 flex-shrink-0">{f.icon}</div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">{f.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Developer Payload Preview */}
              <div className="rounded-3xl bg-slate-900 shadow-2xl shadow-slate-900/20 overflow-hidden border border-slate-800">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50"></div>
                  </div>
                  <span className="text-[11px] font-medium text-slate-400 font-mono tracking-wider">payload.json</span>
                </div>
                <div className="p-4 bg-[#0f172a]">
                  <p className="mb-3 text-xs text-slate-400 font-mono">
                    POST <span className="text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">/api/v1/emails/categorize</span>
                  </p>
                  <pre className="max-h-[360px] overflow-auto text-[11px] leading-relaxed text-slate-300 font-mono scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                    <code dangerouslySetInnerHTML={{
                      __html: JSON.stringify(profile, null, 2)
                        .replace(/"(.*?)":/g, '<span class="text-indigo-300">"$1"</span>:')
                        .replace(/"(.*?)"(?=[,\n])/g, '<span class="text-emerald-300">"$1"</span>')
                        .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="text-amber-300">$1</span>')
                    }} />
                  </pre>
                </div>
              </div>
            </aside>
            
          </div>
        )}
      </div>
    </div>
  );
}