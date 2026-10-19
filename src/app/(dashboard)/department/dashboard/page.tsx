import { redirect } from "next/navigation";
import { getCurrentUser, hasAnyPermission } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

export default async function DepartmentDashboardPage() {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // This route only forwards to the department queue. A receptionist holds
  // `queue.manage`, so the shared department gate lets them in and they land on
  // records they may legitimately read -- but the entry page they can reach from
  // there refuses to save. Gate on the permissions the save path requires, the
  // same pair the entry page and POST /api/department/records check, so the
  // dashboard is not a door into a workflow they cannot complete.
  const canRecordResults = await hasAnyPermission(user.id, [
    "records.manage",
    "records.manage.own_dept",
  ]);
  if (!canRecordResults) {
    redirect("/403");
  }

  redirect("/department/records");
}
