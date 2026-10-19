"use server";

import { createClient } from "@/lib/supabase/server";
import { createPatient } from "@/lib/patient/createPatient";
import { sendEmailConfirmation } from "@/lib/auth/email-confirmation";
import { PASSWORD_REQUIREMENT_TEXT, validateAge, validatePassword, validateName, nameFieldMessage, CONTACT_REQUIREMENT_TEXT, validateContactNumber, validateAddress, ADDRESS_FIELD_MESSAGE } from "@/lib/validation";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().refine(validatePassword, PASSWORD_REQUIREMENT_TEXT),
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
  acceptedTerms: z
    .string()
    .refine((value) => value === "true", "You must accept the KlinikAid Terms and Conditions to register."),
});

export interface RegisterResult {
  error?: string;
  success?: boolean;
  registeredEmail?: string;
}

export async function registerAction(
  prevState: RegisterResult | null,
  formData: FormData
): Promise<RegisterResult> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const firstName = formData.get("firstName") as string;
  const lastName = formData.get("lastName") as string;
  const dob = formData.get("dob") as string;
  const gender = formData.get("gender") as string;
  const contactNumber = formData.get("contactNumber") as string;
  const address = formData.get("address") as string;
  const acceptedTerms = formData.get("acceptedTerms") as string;

  // 1. Zod Validation
  const validation = registerSchema.safeParse({
    email,
    password,
    firstName,
    lastName,
    dob,
    gender,
    contactNumber,
    address,
    acceptedTerms,
  });

  if (!validation.success) {
    const errorMsg = validation.error.issues.map((e) => e.message).join(". ");
    return { error: errorMsg };
  }

  // Use the parsed (trimmed) values so whitespace-only input is refused by the
  // schema above and stored names/addresses never carry surrounding whitespace.
  const parsed = validation.data;

  const ageValidation = validateAge(parsed.dob);
  if (!ageValidation.valid) {
    return { error: ageValidation.error || "Invalid date of birth." };
  }

  // 2. Initialize Client
  const client = await createClient();

  // 3. Call Centralized Patient Creator
  const res = await createPatient(
    client,
    {
      email: parsed.email,
      password: parsed.password,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      dob: parsed.dob,
      gender: parsed.gender,
      contactNumber: parsed.contactNumber,
      address: parsed.address,
    },
    false // Self-registration pathway
  );

  // A duplicate address gets the same answer as a new one, so this form cannot be
  // used to test which addresses have accounts. Resending is a no-op for a
  // confirmed account and a fresh link for one that never confirmed.
  if (res.emailExists) {
    await sendEmailConfirmation(client, email);
    return { success: true, registeredEmail: email };
  }

  if (!res.success || res.error) {
    return { error: res.error || "Signup failed." };
  }

  return { success: true, registeredEmail: email };
}
