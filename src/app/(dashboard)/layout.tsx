import React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardLayoutClient from "@/components/DashboardLayoutClient";
import { headers } from "next/headers";
import { logEvent } from "@/lib/logger";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { getTotpFactors } from "@/lib/auth/mfa";
import { hasAnyPermission, hasPermission, getCurrentUser } from "@/lib/auth/helpers";
import { timed } from "@/lib/perf/timing";
import { NavItem } from "@/components/sidebar";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Permission lists that decide whether a route prefix is reachable at all.
// The sidebar reuses these so a link is never shown to a user the route gate
// would turn away.
const ADMIN_AREA_PERMISSIONS: string[] = [
  "staff.manage",
  "roles.manage",
  "profiles.manage",
  "system_logs.read",
  "chatbot_logs.read",
  "rag_documents.manage",
];
const RECEPTION_AREA_PERMISSIONS: string[] = [
  "patients.manage",
  "documents.manage",
  "queue.manage",
];
const DEPARTMENT_AREA_PERMISSIONS: string[] = [
  "queue.manage",
  "queue.manage.own_dept",
  "records.manage",
  "records.manage.own_dept",
];
const SPECIALIST_AREA_PERMISSIONS: string[] = [
  "specialist.patients",
  "specialist.analytics",
  "specialist.records",
];

interface DashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * Shared dashboard layout containing the Sidebar and main scrollable content area.
 * Validates user authentication and account status on the server.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = await createClient();

  // 1. Retrieve session and profile.
  //
  // The session is verified from the access token's signature and the profile
  // is read once per request; the page and the auth helpers share both reads
  // (issue #165). The layout used to make its own getUser() call and its own
  // profile query on top of the ones the page made.
  const { user, profile } = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (!profile) {
    // Session exists but profile is missing
    await supabase.auth.signOut();
    redirect("/login");
  }

  // 3. Prevent inactive accounts from accessing the system
  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=account_deactivated");
  }

  // 3.5 Enforce Data Privacy Agreement gate (Republic Act 10173) for patients
  if (profile.role === "patient" && !profile.accepted_privacy_at) {
    redirect("/privacy-agreement");
  }

  // 3.7 Enforce MFA Enrollment gate for Staff roles
  const isStaff = ["admin", "receptionist", "department_staff", "medical_specialist"].includes(profile.role);
  if (isStaff) {
    let factorsData: Awaited<ReturnType<typeof supabase.auth.mfa.listFactors>>["data"];
    try {
      ({ data: factorsData } = await timed("layout.mfa.listFactors", () =>
        supabase.auth.mfa.listFactors()
      ));
    } catch (factorError) {
      // Same reasoning as the assurance check below: a session that cannot
      // describe its own factors cannot be trusted to grant access.
      console.error("MFA Gate threw listing factors:", factorError);
      await supabase.auth.signOut();
      redirect("/login?error=mfa_check_failed");
    }

    const hasVerifiedFactor = getTotpFactors(factorsData).some((f) => f.status === "verified");
    if (!hasVerifiedFactor) {
      // Staff has no verified TOTP factor, force routing to enroll page
      redirect("/mfa-enroll");
    }

    // Factor existence alone is not assurance. A verified factor proves the
    // account CAN use a second factor; only the session's assurance level
    // proves this session DID. Login returns `mfa_required` without signing
    // out, so an AAL1 session survives the prompt and reaches this layout —
    // checking `hasVerifiedFactor` alone would let a stolen password through.
    //
    // Wrapped because getAuthenticatorAssuranceLevel() reads session.user.factors
    // internally and throws outright when the stored session has no `user`
    // (GoTrueClient.js). A session this shape cannot yield a trustworthy
    // assurance level, so it must fail closed -- but as a redirect to login,
    // not as a 500 that leaves the caller on a blank page.
    let aalData: Awaited<ReturnType<typeof supabase.auth.mfa.getAuthenticatorAssuranceLevel>>["data"];
    try {
      ({ data: aalData } = await timed("layout.mfa.assuranceLevel", () =>
        supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      ));
    } catch (gateError) {
      console.error("MFA Gate threw retrieving assurance level:", gateError);
      await supabase.auth.signOut();
      redirect("/login?error=mfa_check_failed");
    }

    if (!aalData) {
      console.error("MFA Gate: assurance level unavailable; failing closed.");
      await supabase.auth.signOut();
      redirect("/login?error=mfa_check_failed");
    }

    if (aalData.currentLevel !== "aal2") {
      // Kick the still-unverified session out entirely rather than bouncing it
      // to the challenge, so the only way back in is a full sign-in.
      await supabase.auth.signOut();
      redirect("/login?error=mfa_required");
    }
  }

  // 4. Handle access denial logging and redirection (Revision B)
  const reqHeaders = await headers();
  const xPathname = reqHeaders.get("x-pathname") || "";

  if (!xPathname) {
    redirect("/403");
  }

  const isAdminRoute = xPathname.startsWith("/admin");
  const isReceptionRoute = xPathname.startsWith("/reception");
  const isDepartmentRoute = xPathname.startsWith("/department");
  const isSpecialistRoute = xPathname.startsWith("/specialist");
  const isPatientRoute = xPathname.startsWith("/patient");

  const canEnterPatientArea = profile.role === "patient";

  // The role name is only used for the sidebar's label. It is read with the
  // service role because the `roles` table is not readable by every signed-in
  // user, and its error is deliberately not fatal: failing the whole dashboard
  // because a cosmetic label could not resolve would trade a visible defect
  // for an invisible one. Logged so the gap is diagnosable rather than silent.
  //
  // The read is independent of the permission checks below, so it runs while
  // they are being resolved instead of after them: each is a round trip to the
  // database, and the dashboard waits for both (issue #165).
  const roleNamePromise = (async () => {
    if (!profile.role_id) return null;
    const adminSupabase = createAdminClient();
    const { data: assignedRole, error: roleError } = await timed("layout.roles.name", () =>
      adminSupabase
        .from("roles")
        .select("name")
        .eq("id", profile.role_id)
        .maybeSingle()
    );
    if (roleError) {
      console.error("Dashboard layout: could not resolve role name for sidebar:", roleError.message);
    }
    return assignedRole?.name || null;
  })();
  // A request that is turned away below never awaits this promise; the handler
  // keeps a failure from surfacing as an unhandled rejection.
  roleNamePromise.catch(() => {});

  // The area gates and the navigation items ask for permissions that overlap:
  // an administrator may enter the admin area precisely because it may manage
  // staff. Asking for all of them at once keeps this to one round trip
  // instead of two sequential ones, and `hasPermission` is cached per request,
  // so every permission is still checked exactly once (issue #165).
  const [
    canEnterAdminArea,
    canEnterReceptionArea,
    canEnterDepartmentArea,
    canEnterSpecialistArea,
    canManageProfiles,
    canManageStaff,
    canReadRoles,
    canManageDocuments,
    canManageQueue,
    canManagePatients,
    canManageRag,
    canReadSystemLogs,
    canAccessSpecialistPatients,
    canAccessChat,
  ] = await timed("layout.perms", () =>
    Promise.all([
      hasAnyPermission(user.id, ADMIN_AREA_PERMISSIONS),
      hasAnyPermission(user.id, RECEPTION_AREA_PERMISSIONS),
      hasAnyPermission(user.id, DEPARTMENT_AREA_PERMISSIONS),
      hasAnyPermission(user.id, SPECIALIST_AREA_PERMISSIONS),
      hasPermission(user.id, "profiles.manage"),
      hasPermission(user.id, "staff.manage"),
      hasPermission(user.id, "roles.read"),
      hasPermission(user.id, "documents.manage"),
      hasPermission(user.id, "queue.manage"),
      hasPermission(user.id, "patients.manage"),
      hasPermission(user.id, "rag_documents.manage"),
      hasPermission(user.id, "system_logs.read"),
      hasPermission(user.id, "specialist.patients"),
      hasPermission(user.id, "chat.access"),
    ])
  );

  let isRoleMismatch = false;
  if (isAdminRoute) isRoleMismatch = !canEnterAdminArea;
  if (isReceptionRoute) isRoleMismatch = !canEnterReceptionArea;
  if (isDepartmentRoute) isRoleMismatch = !canEnterDepartmentArea;
  if (isSpecialistRoute) isRoleMismatch = !canEnterSpecialistArea;
  if (isPatientRoute && !canEnterPatientArea) isRoleMismatch = true;

  if (isRoleMismatch) {
    const ipAddress = reqHeaders.get("x-forwarded-for")?.split(",")[0] || null;
    await logEvent(
      supabase,
      user.id,
      SYSTEM_EVENT_TYPES.ACCESS_DENIED,
      `Unauthorized access attempt by user ${profile.full_name} (${profile.role}) to path: ${xPathname}`,
      ipAddress,
      { attempted_path: xPathname, user_role: profile.role }
    );
    redirect("/403");
  }

  const roleName = await roleNamePromise;

  const sidebarUser = {
    id: profile.id,
    email: user.email || "",
    fullName: profile.full_name,
    role: profile.role,
    roleName,
    department: profile.department,
  };
  const navItems: NavItem[] = [];

  if (profile.role === "admin" && canManageProfiles && canEnterAdminArea) {
    navItems.push({ label: "Dashboard", href: "/admin/dashboard", icon: "LayoutDashboard" });
  }
  if (canManageStaff && canEnterAdminArea) {
    navItems.push({ label: "Staff Management", href: "/admin/staff", icon: "Users" });
  }
  if (canReadRoles && canEnterAdminArea) {
    navItems.push({ label: "Role Management", href: "/admin/roles", icon: "ShieldCheck" });
  }
  if (canManageDocuments && canManageQueue && canEnterReceptionArea) {
    navItems.push({ label: "Reception Queue", href: "/reception/queue", icon: "ClipboardList" });
  }
  if (canManagePatients && canEnterReceptionArea) {
    navItems.push({ label: "Reception Dashboard", href: "/reception/dashboard", icon: "LayoutDashboard" });
  }
  if (canEnterDepartmentArea) {
    navItems.push({ label: "Dept Records", href: "/department/records", icon: "FileSpreadsheet" });
  }
  if (canManageRag && canEnterAdminArea) {
    navItems.push({ label: "RAG Manager", href: "/admin/rag", icon: "Brain" });
  }
  if (canReadSystemLogs && canEnterAdminArea) {
    navItems.push({ label: "System Logs", href: "/admin/logs", icon: "History" });
  }
  if (canAccessSpecialistPatients && canEnterSpecialistArea) {
    navItems.push({ label: "Specialist Dashboard", href: "/specialist/dashboard", icon: "LayoutDashboard" });
    navItems.push({ label: "My Patients", href: "/specialist/patients", icon: "UserCheck" });
  }
  if (canEnterPatientArea) {
    navItems.push({ label: "Dashboard", href: "/patient/dashboard", icon: "LayoutDashboard" });
    if (canAccessChat) {
      navItems.push({ label: "AI Assistant", href: "/patient/chat", icon: "Bot" });
    }
    navItems.push({ label: "Submit Document", href: "/patient/submit", icon: "Upload" });
    navItems.push({ label: "Document Templates", href: "/patient/templates", icon: "ClipboardList" });
    navItems.push({ label: "Track Submission", href: "/patient/submissions", icon: "Search" });
    navItems.push({ label: "My Results", href: "/patient/results", icon: "FileText" });
  }
  navItems.push({ label: "My Profile", href: "/profile", icon: "User" });

  return (
    <DashboardLayoutClient user={sidebarUser} navItems={navItems}>
      {children}
    </DashboardLayoutClient>
  );
}
