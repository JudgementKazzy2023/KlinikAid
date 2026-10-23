/**
 * Supabase Edge Function: patient-document-submission
 * Runtime: Deno. Caller: the mobile app (JWT Bearer auth).
 *
 * Stage 1: form templates only (operation submit_template), plus
 * POST .../patient-document-submission/status { request_id } to look up a
 * request's outcome without resending it. Uploads stay on
 * the mobile containment until Stage 2. Contract: mobile PR #3, decisions in
 * JudgementKazzy2023/Klinikaid-Mobile-App#36.
 *
 * Requires migration_41 (public.submit_patient_template) applied first.
 *
 * Web counterpart: src/app/(dashboard)/patient/templates/actions.ts calls the
 * same database function, and both use src/lib/documents/templateChecks.ts.
 */
import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  createHandler,
  resolvedRole,
  SubmissionError,
} from "./handler.ts";

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        error_code: "METHOD_NOT_ALLOWED",
        message: "Use POST or OPTIONS.",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          Allow: "POST, OPTIONS",
        },
      },
    );
  }
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return new Response(
      JSON.stringify({
        error_code: "SERVER_ERROR",
        message: "Submission service is unavailable.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const auth = createClient(url, anonKey, options);
  const admin = createClient(url, serviceKey, options);
  return await createHandler({
    identity: {
      async authenticate(token) {
        // Remote validation, not locally decoded claims or client metadata.
        const { data, error } = await auth.auth.getUser(token);
        if (error) {
          if (
            error.status === 400 || error.status === 401 || error.status === 403
          ) return null;
          throw new SubmissionError("SERVER_ERROR");
        }
        return data.user
          ? {
            id: data.user.id,
            email_confirmed_at: data.user.email_confirmed_at,
            app_metadata: {
              must_change_password: data.user.app_metadata.must_change_password,
            },
          }
          : null;
      },
      async patientByProfile(userId) {
        const { data, error } = await admin.from("patients")
          .select(
            "id, profile_id, first_name, last_name, date_of_birth, contact_number, address",
          )
          .eq("profile_id", userId).maybeSingle();
        if (error) throw new SubmissionError("SERVER_ERROR");
        return data;
      },
      async profile(userId) {
        // Role through role_id -> roles, as app authorization resolves it, not
        // the legacy profiles.role text: that column is left stale when the
        // role is deleted (role_id set null) or has no base_role.
        const { data, error } = await admin.from("profiles")
          .select(
            "is_active, accepted_privacy_at, roles:role_id(name, is_system, base_role)",
          ).eq("id", userId)
          .maybeSingle<{
            is_active: boolean;
            accepted_privacy_at: string | null;
            roles: {
              name: string;
              is_system: boolean;
              base_role: string | null;
            } | null;
          }>();
        if (error) throw new SubmissionError("SERVER_ERROR");
        if (!data) return null;
        return {
          role: resolvedRole(data.roles),
          is_active: data.is_active,
          accepted_privacy_at: data.accepted_privacy_at,
        };
      },
    },
    store: {
      async submitTemplate(input) {
        const { data, error } = await admin.rpc("submit_patient_template", {
          p_user_id: input.user_id,
          p_request_id: input.request_id,
          p_fingerprint: input.fingerprint,
          p_patient_id: input.patient_id,
          p_file_name: input.file_name,
          p_file_path: input.file_path,
          p_metadata: input.metadata,
          p_description: input.description,
        });
        if (error || !data) throw new SubmissionError("SERVER_ERROR");
        return data;
      },
      async lookupTemplate(userId, requestId) {
        const { data, error } = await admin.rpc(
          "submit_patient_template_outcome",
          { p_user_id: userId, p_request_id: requestId },
        );
        if (error || !data) throw new SubmissionError("SERVER_ERROR");
        return data;
      },
    },
  })(req);
}

if (import.meta.main) serve(handler);
