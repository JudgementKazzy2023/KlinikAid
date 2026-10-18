"use server";

import { createClient } from "@/lib/supabase/server";
import { createPatient } from "@/lib/patient/createPatient";
import { hasPermission } from "@/lib/auth/helpers";
import { validateAge, validateName, nameFieldMessage, CONTACT_REQUIREMENT_TEXT, validateContactNumber, validateAddress, ADDRESS_FIELD_MESSAGE } from "@/lib/validation";
import { z } from "zod";

const receptionPatientSchema = z.object({
  email: z.string().email("Invalid email address"),
  firstName: z.string().trim().refine((v) => validateName(v, "First name").valid, {
    message: nameFieldMessage("First name")
  }),
  lastName: z.string().trim().refine((v) => validateName(v, "Last name").valid, {
    message: nameFieldMessage("Last name")
  }),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date of birth format"),
  gender: z.enum(["male", "female", "other"], { message: "Select a valid gender" }),
  contactNumber: z.string().refine((v) => validateContactNumber(v).valid, CONTACT_REQUIREMENT_TEXT),
  address: z.string().trim().refine((v) => validateAddress(v).valid, { message: ADDRESS_FIELD_MESSAGE }),
});

export interface ReceptionPatientResult {
  error?: string;
  success?: boolean;
  passwordUsed?: string;
  /** False: the account exists but the confirmation email was not sent yet. */
  confirmationSent?: boolean;
}

export async function createPatientByStaffAction(
  prevState: unknown,
  formData: FormData
): Promise<ReceptionPatientResult> {
  // 1. Authenticate receptionist session (Rule 1)
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();

  if (authError || !user) {
    return { error: "Unauthorized. Session expired." };
  }

  if (!(await hasPermission(user.id, "patients.manage"))) {
    return { error: "Unauthorized. Front desk privileges required." };
  }

  // 2. Extract and Validate Form Data
  const email = formData.get("email") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const dob = formData.get("dob") as string;
  const gender = formData.get("gender") as string;
  const contactNumber = formData.get("contactNumber") as string;
  const address = formData.get("address") as string;

  const validation = receptionPatientSchema.safeParse({
    email,
    firstName,
    lastName,
    dob,
    gender,
    contactNumber,
    address,
  });

  if (!validation.success) {
    return { error: validation.error.issues.map((e) => e.message).join(". ") };
  }

  // Use the parsed (trimmed) values so whitespace-only input is refused by the
  // schema above and stored names/addresses never carry surrounding whitespace.
  const parsed = validation.data;

  const ageValidation = validateAge(parsed.dob);
  if (!ageValidation.valid) {
    return { error: ageValidation.error || "Invalid date of birth." };
  }

  // 3. Invoke Patient Creation
  const res = await createPatient(
    client,
    {
      email: parsed.email,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      dob: parsed.dob,
      gender: parsed.gender,
      contactNumber: parsed.contactNumber,
      address: parsed.address,
    },
    true, // Receptionist-led patient registration
    user.id // Pass receptionist user ID for audit log tracking
  );

  if (!res.success || res.error) {
    return { error: res.error || "Failed to create patient account." };
  }

  return {
    success: true,
    passwordUsed: res.passwordUsed,
    confirmationSent: res.confirmationSent !== false,
  };
}
