import type { StudentProfile } from "./profile-schema";
import { studentProfileSchema } from "./profile-schema";

const KEY = "opportunity-inbox-student-profile-v1";

export function loadStoredProfile(): StudentProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const r = studentProfileSchema.safeParse(parsed);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: StudentProfile): void {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export function clearStoredProfile(): void {
  localStorage.removeItem(KEY);
}
