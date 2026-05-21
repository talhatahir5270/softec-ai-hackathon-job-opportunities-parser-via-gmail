/** Mirrors `backend/app/models/enums.py` for Zod + form options. */

export const DEGREES = [
  "BS Computer Science",
  "BS Software Engineering",
  "BS Information Technology",
  "BS Data Science",
  "BS Artificial Intelligence",
  "BBA",
  "MBA",
  "Other",
] as const;

export const SKILLS = [
  "Python",
  "Java",
  "C++",
  "JavaScript",
  "React",
  "Node.js",
  "Machine Learning",
  "Deep Learning",
  "Data Analysis",
  "SQL",
  "UI/UX Design",
  "DevOps",
  "Cloud Computing",
  "Other",
] as const;

export const INTERESTS = [
  "Artificial Intelligence",
  "Web Development",
  "Mobile Development",
  "Data Science",
  "Cyber Security",
  "Cloud Computing",
  "Blockchain",
  "Game Development",
  "Entrepreneurship",
  "Research",
] as const;

export const OPPORTUNITY_TYPES = [
  "Internship",
  "Scholarship",
  "Hackathon",
  "Fellowship",
  "Job",
  "Freelance",
  "Exchange Program",
  "Admission",
] as const;

export const LOCATIONS = ["Pakistan", "Remote", "International"] as const;

export const FINANCIAL = ["High", "Medium", "Low", "None"] as const;

export const AVAILABILITY = ["Immediate", "Summer", "Winter", "Flexible"] as const;

export const EXPERIENCE = ["Beginner", "Intermediate", "Advanced"] as const;
