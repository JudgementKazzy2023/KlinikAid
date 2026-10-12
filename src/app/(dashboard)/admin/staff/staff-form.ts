import * as z from "zod";
import type { Department } from "@/types";

export const staffFormSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").or(z.string().length(0)), // optional on edit
  roleId: z.string().uuid("Select a role"),
  department: z.enum(["laboratory", "imaging", "ultrasound", "ecg"]).nullable().optional(),
  employeeType: z.string().max(404, "Position titles must be 80 characters or fewer, up to 5 titles.").optional(),
});

export type StaffFormValues = z.infer<typeof staffFormSchema>;

export interface DbRole {
  id: string;
  name: string;
  is_system: boolean;
  base_role: string | null;
  description: string | null;
}

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  role_id: string | null;
  department: Department | null;
  employee_type: string | null;
  is_active: boolean;
  created_at: string;
}

export const MAX_TITLES = 5;
export const MAX_TITLE_LENGTH = 80;

export function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no 0/O/1/l/I
  const genChunk = (length: number) => {
    let chunk = "";
    for (let i = 0; i < length; i++) {
      chunk += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return chunk;
  };
  return `Klinik-${genChunk(4)}-${genChunk(4)}`;
}

export function parseEmployeeTitles(value: string | null | undefined) {
  return (value || "")
    .split("|")
    .map((title) => title.trim())
    .filter(Boolean);
}

export function joinEmployeeTitles(titles: string[]) {
  return titles
    .map((title) => title.trim().replace(/\|/g, ""))
    .filter(Boolean)
    .slice(0, MAX_TITLES)
    .join("|");
}

/** What a role is for, in one line. Falls back to these when the role row has no description. */
const SYSTEM_ROLE_BLURBS: Record<string, string> = {
  admin: "Full access: staff, roles, knowledge base and system logs.",
  receptionist: "Registers patients and reviews, approves or rejects submitted documents.",
  department_staff: "Works a department queue and enters test results.",
  medical_specialist: "Reads patient records and trends; keeps a private patient list.",
};

export function roleBlurb(role: DbRole): string {
  const own = role.description?.trim();
  if (own) return own;
  if (role.is_system && SYSTEM_ROLE_BLURBS[role.name]) return SYSTEM_ROLE_BLURBS[role.name];
  return "Custom role. Access follows the permissions set on the Roles page.";
}

export function roleLabel(role: DbRole): string {
  return role.is_system
    ? role.name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
    : role.name;
}
