import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDefaultLandingPath } from "@/lib/auth/helpers";
import { mustChangePassword } from "@/lib/auth/temporary-password";
import SetPasswordClient from "./SetPasswordClient";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!mustChangePassword(user)) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    redirect(profile ? await getDefaultLandingPath(user.id, profile) : "/login");
  }

  return <SetPasswordClient email={user.email ?? ""} />;
}
