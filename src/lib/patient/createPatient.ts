import { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/logger";
import crypto from "crypto";
import { SYSTEM_EVENT_TYPES } from "@/lib/constants";
import { MUST_CHANGE_PASSWORD } from "@/lib/auth/temporary-password";
import { sendEmailConfirmation } from "@/lib/auth/email-confirmation";

export interface CreatePatientInput {
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: "male" | "female" | "other";
  contactNumber: string;
  address: string;
}

export interface CreatePatientResult {
  success: boolean;
  userId?: string;
  patientId?: string;
  passwordUsed?: string;
  error?: string;
  /** The address already has an Auth account. Nothing was created. */
  emailExists?: boolean;
}

/**
 * Centralized function to handle patient creation.
 * Creates an unconfirmed auth user, auto-triggers profile generation, inserts the patient
 * record, and emails a confirmation link. The account cannot sign in until it is confirmed.
 * Uses admin/service role client to insert to public.patients since patients/anonymous users lack insert RLS.
 */
export async function createPatient(
  client: SupabaseClient,
  input: CreatePatientInput,
  isReceptionistCreated: boolean,
  receptionistId?: string | null
): Promise<CreatePatientResult> {
  const { email, password, firstName, lastName, dob, gender, contactNumber, address } = input;
  const fullName = `${firstName} ${lastName}`;
  const adminClient = createAdminClient();

  let userId: string | undefined;
  let passwordUsed = password;

  try {
    if (!passwordUsed) {
      if (!isReceptionistCreated) {
        return {
          success: false,
          error: "Password is required for self-registration.",
        };
      }
      // Generate cryptographically secure random password if none provided
      passwordUsed = crypto.randomBytes(8).toString("hex") + "A1!";
    }

    // 1. Create the Auth user unconfirmed, for both pathways. Auth refuses a password
    // sign-in until the address is confirmed, so nobody reaches patient data through
    // an address they do not control. The admin client also avoids replacing the
    // receptionist's session, and returns email_exists instead of an obfuscated user.
    // Role belongs in app_metadata, not user_metadata: the signup trigger grants
    // privilege from app_metadata only, since user_metadata is caller-writable.
    // See migration_20.sql.
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: passwordUsed,
      email_confirm: false,
      user_metadata: {
        full_name: fullName,
      },
      app_metadata: {
        role: "patient",
        ...(isReceptionistCreated ? { [MUST_CHANGE_PASSWORD]: true } : {}),
      },
    });

    if (authError || !authData.user) {
      if (authError?.code === "email_exists") {
        return { success: false, emailExists: true, error: authError.message };
      }
      if (isReceptionistCreated) {
        return {
          success: false,
          error: authError?.message || "Failed to create user in authentication database.",
        };
      }
      const isUserFacing = !!authError && authError.status !== 500 && !!authError.message;
      return {
        success: false,
        error: isUserFacing
          ? authError.message
          : "Registration is currently unavailable. Please try again later.",
      };
    }
    userId = authData.user.id;

    // 3. Insert linked patients record using adminClient (RLS requires admin/receptionist)
    const { data: patientData, error: patientError } = await adminClient
      .from("patients")
      .insert({
        profile_id: userId,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: dob,
        gender,
        contact_number: contactNumber,
        address,
        email,
      })
      .select("id")
      .single();

    if (patientError) {
      // 4. Split Partial-Failure Handling
      // Delete auth user to prevent orphaned auth record.
      await adminClient.auth.admin.deleteUser(userId);

      if (isReceptionistCreated) {
        // Receptionist failure logging
        await logEvent(
          adminClient,
          receptionistId || null,
          SYSTEM_EVENT_TYPES.STAFF_ACTION_FAILED,
          `Receptionist failed to create patient: DB insert failed for ${email} - ${patientError.message}`
        );
        return {
          success: false,
          error: `Database registration error: ${patientError.message}`,
        };
      } else {
        // Self-registration failure logging
        return {
          success: false,
          error: "Registration failed. We were unable to set up your patient record. Please try again.",
        };
      }
    }

    // 5. Send the confirmation link. Without it the account cannot sign in, so a
    // failure here is a failed registration: remove what was created.
    const { error: confirmError } = await sendEmailConfirmation(client, email);
    if (confirmError) {
      await adminClient.from("patients").delete().eq("id", patientData.id);
      await adminClient.auth.admin.deleteUser(userId);
      return {
        success: false,
        error:
          confirmError.code === "email_address_invalid"
            ? "We could not send a confirmation email to this address. Check the address and try again."
            : "We could not send a confirmation email right now. Please try again later.",
      };
    }

    // 6. Log success event and return result
    const logMessage = isReceptionistCreated
      ? `Patient registered by receptionist: ${fullName} (${email})`
      : `Patient registered via self-registration: ${fullName} (${email})`;

    await logEvent(adminClient, userId, SYSTEM_EVENT_TYPES.USER_REGISTERED, logMessage);

    return {
      success: true,
      userId,
      patientId: patientData.id,
      passwordUsed,
    };
  } catch (err: unknown) {
    // Top-level fallback cleanup
    if (userId) {
      try {
        await adminClient.auth.admin.deleteUser(userId);
      } catch {}
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unexpected error occurred during patient creation.",
    };
  }
}
