/**
 * Event chips for the audit-log table, keyed by event type. Class strings, not
 * inline hex colours (issue #153): inline styles kept these chips on their
 * light pastel fill in dark mode, so every log row carried a light panel;
 * class strings let the same `dark:` mechanism the rest of the app uses swap
 * in the dark fill. Each pair keeps its hue and clears 4.5:1 in both themes,
 * guarded by src/lib/badge-contrast.test.ts.
 */
export const EVENT_BADGE_STYLES: Record<string, { classes: string; label: string }> = {
  LOGIN_SUCCESS:          { classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900", label: "Login Success" },
  LOGIN_FAILED:           { classes: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900", label: "Login Failed" },
  LOGOUT:                 { classes: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700", label: "Logout" },
  USER_REGISTERED:        { classes: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", label: "User Registered" },
  PROFILE_PROVISIONING_FAILED: { classes: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", label: "Profile Provisioning Failed" },
  STAFF_CREATED:          { classes: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900", label: "Staff Created" },
  STAFF_UPDATED:          { classes: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900", label: "Staff Updated" },
  STAFF_ACTIVATED:        { classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900", label: "Staff Activated" },
  STAFF_DEACTIVATED:      { classes: "bg-red-200 text-red-900 border-red-400 dark:bg-red-950 dark:text-red-300 dark:border-red-900", label: "Staff Deactivated" },
  DOCUMENT_APPROVED:      { classes: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900", label: "Doc Approved" },
  DOCUMENT_REJECTED:      { classes: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900", label: "Doc Rejected" },
  TRIAGE_COMPLETED:       { classes: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900", label: "Triage Completed" },
  RECORD_ENTERED:         { classes: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", label: "Record Entered" },
  RAG_DOCUMENT_UPLOADED:  { classes: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-950 dark:text-fuchsia-300 dark:border-fuchsia-900", label: "RAG Uploaded" },
  RAG_DOCUMENT_DELETED:   { classes: "bg-pink-50 text-pink-800 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-900", label: "RAG Deleted" },
  ACCESS_DENIED:          { classes: "bg-red-950 text-red-200 border-red-900", label: "Access Denied" },
  EXPORT_SYSTEM_LOGS:     { classes: "bg-sky-50 text-sky-900 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", label: "Logs Exported" },
  STAFF_ACTION_FAILED:    { classes: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", label: "Staff Action Failed" },
  DOCUMENT_SUBMITTED:     { classes: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900", label: "Doc Submitted" },
  DOCUMENT_OCR_PROCESSED: { classes: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", label: "Document OCR Processed" },
  LAB_RESULT_OCR_PROCESSED: { classes: "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-900", label: "Lab Result OCR Processed" },
  LAB_RESULT_OCR_IDENTITY_OVERRIDE: { classes: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900", label: "Lab OCR Name Override" },
  DEPARTMENT_TEXT_OCR_PROCESSED: { classes: "bg-teal-50 text-teal-900 border-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900", label: "Department Text OCR Processed" },
  PRIVACY_ACCEPTED:       { classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900", label: "Privacy Accepted" },
  QUEUE_COMPLETED:        { classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900", label: "Queue Completed" },
  MFA_ENROLLED:           { classes: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900", label: "MFA Enrolled" },
  PASSWORD_CHANGED:       { classes: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900", label: "Password Changed" },
  PROFILE_UPDATED:        { classes: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", label: "Profile Updated" },
  SPECIALIST_PATIENT_CREATED: { classes: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900", label: "Spec Patient Created" },
  SPECIALIST_RECORD_ENTERED: { classes: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-950 dark:text-fuchsia-300 dark:border-fuchsia-900", label: "Spec Record Entered" },
  CUSTOM_ROLE_CREATED:    { classes: "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-900", label: "Role Created" },
  ROLE_UPDATED:           { classes: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900", label: "Role Updated" },
  ROLE_DELETED:           { classes: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900", label: "Role Deleted" },
  ROLE_ASSIGNED:          { classes: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900", label: "Role Assigned" },
};

export const DEFAULT_BADGE_STYLE = {
  classes: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  label: "Unknown Event",
};
