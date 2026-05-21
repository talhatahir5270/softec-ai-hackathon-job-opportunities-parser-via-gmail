import { z } from "zod";

import {
  AVAILABILITY,
  DEGREES,
  EXPERIENCE,
  FINANCIAL,
  INTERESTS,
  LOCATIONS,
  OPPORTUNITY_TYPES,
  SKILLS,
} from "./profile-enums";

export const studentProfileSchema = z.object({
  login_id: z
    .string()
    .min(3, "Login ID must be at least 3 chars")
    .max(64, "Login ID is too long")
    .regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dot, underscore, or dash only"),
  degree: z.enum(DEGREES),
  semester: z.coerce.number().int().min(1).max(9),
  cgpa: z.coerce.number().min(0).max(4),
  skills: z.array(z.enum(SKILLS)).min(1, "Pick at least one skill"),
  interests: z.array(z.enum(INTERESTS)).min(1, "Pick at least one interest"),
  preferred_opportunity_types: z
    .array(z.enum(OPPORTUNITY_TYPES))
    .min(1, "Pick at least one opportunity type"),
  location_preference: z.array(z.enum(LOCATIONS)).min(1, "Pick at least one location"),
  financial_need: z.enum(FINANCIAL),
  availability: z.enum(AVAILABILITY),
  experience_level: z.enum(EXPERIENCE),
});

export type StudentProfile = z.infer<typeof studentProfileSchema>;
