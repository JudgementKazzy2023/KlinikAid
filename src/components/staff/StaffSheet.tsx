"use client";

import React, { useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { CheckCircle2, Copy, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import DataLoadError from "@/components/DataLoadError";
import RoleCards from "@/components/staff/RoleCards";
import TitleChips from "@/components/staff/TitleChips";
import {
  joinEmployeeTitles,
  parseEmployeeTitles,
  type DbRole,
  type StaffFormValues,
  type StaffMember,
} from "@/app/(dashboard)/admin/staff/staff-form";

export interface CreatedAccount {
  name: string;
  email: string;
  password: string;
}

interface StaffSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingStaff: StaffMember | null;
  form: UseFormReturn<StaffFormValues>;
  assignableRoles: DbRole[];
  rolesLoaded: boolean;
  rolesError: string | null;
  isDeptStaff: boolean;
  errorMsg: string;
  submitting: boolean;
  onSubmit: (values: StaffFormValues) => void;
  onRoleChange: (roleId: string) => void;
  created: CreatedAccount | null;
  sendingReset: boolean;
  onSendReset: () => void;
}

const DEPARTMENT_OPTIONS = [
  { value: "laboratory", label: "Laboratory" },
  { value: "imaging", label: "Imaging (X-Ray)" },
  { value: "ultrasound", label: "Ultrasound" },
  { value: "ecg", label: "ECG" },
] as const;

const FIELD = "h-10 text-sm focus-visible:ring-2 focus-visible:ring-ring/40";

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function StaffSheet(props: StaffSheetProps) {
  const {
    open, onOpenChange, editingStaff, form, assignableRoles, rolesLoaded, rolesError, isDeptStaff,
    errorMsg, submitting, onSubmit, onRoleChange, created, sendingReset, onSendReset,
  } = props;
  const { register, handleSubmit, watch, setValue, formState: { errors } } = form;
  const roleId = watch("roleId");
  const department = watch("department");
  const titles = parseEmployeeTitles(watch("employeeType"));
  const [copied, setCopied] = useState(false);
  const orderedRoles = useMemo(() => {
    const order = ["admin", "receptionist", "department_staff", "medical_specialist"];
    const rank = (r: DbRole) => (r.is_system ? order.indexOf(r.name) : 99);
    return [...assignableRoles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [assignableRoles]);

  const copyPassword = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.password);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the password and copy it manually.");
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
      disablePointerDismissal={true}
    >
      <SheetContent
        className="gap-0 bg-white p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        data-testid="staff-sheet"
      >
        <SheetHeader className="shrink-0 gap-1 border-b border-slate-200 px-6 py-5 pr-14">
          <SheetTitle className="text-lg font-semibold tracking-tight text-slate-900">
            {created ? "Account created" : editingStaff ? "Edit staff member" : "Add staff member"}
          </SheetTitle>
          <SheetDescription className="text-sm text-slate-600">
            {created
              ? "Share the temporary password now. It is not stored and cannot be shown again."
              : editingStaff
              ? "Changes to name, email and role apply immediately."
              : "Create a clinic account and choose what it can do."}
          </SheetDescription>
        </SheetHeader>

        {created ? (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
              <div className="flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 text-sm text-slate-800">
                  <p><span className="font-semibold">{created.name}</span> can now sign in.</p>
                  <p className="mt-0.5 truncate text-slate-600" title={created.email}>{created.email}</p>
                  <p className="mt-2 text-[13px] text-slate-600">They will be asked to set up an authenticator on first login.</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="created-password" className="block text-sm font-medium text-slate-900">
                  Temporary password
                </label>
                <div className="flex gap-2">
                  <Input id="created-password" readOnly value={created.password} className={cn(FIELD, "flex-1 bg-slate-50 font-mono tracking-wide")} onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={copyPassword} className="h-10 gap-2 px-3.5">
                    <Copy className="h-4 w-4" />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">Send it over a secure channel. They should change it after signing in.</p>
              </div>
            </div>
            <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
              <Button type="button" onClick={() => onOpenChange(false)} className="h-10 w-full bg-primary text-white hover:bg-primary/90">
                Done
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
              {errorMsg && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <Group title="Account">
                <Field label="Full name" htmlFor="fullName" error={errors.fullName?.message}>
                  <Input id="fullName" autoComplete="off" placeholder="e.g. Dr. Maria Santos" aria-invalid={!!errors.fullName} aria-describedby={errors.fullName ? "fullName-error" : undefined} className={FIELD} {...register("fullName")} />
                </Field>
                <Field label="Email address" htmlFor="email" error={errors.email?.message}>
                  <Input id="email" type="email" autoComplete="off" placeholder="name@bloodcare.com" aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} className={FIELD} {...register("email")} />
                </Field>
                {editingStaff && (
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-sm font-medium text-slate-900">Password</p>
                    <p className="mt-0.5 text-[13px] text-slate-600">Administrators cannot view or set passwords. Email the person a recovery link instead.</p>
                    <Button type="button" variant="outline" onClick={onSendReset} disabled={sendingReset} className="mt-3 h-9 gap-2 border-primary/30 text-primary hover:bg-primary/5">
                      {sendingReset ? (<><Loader2 className="h-4 w-4 animate-spin" />Sending…</>) : "Send password reset email"}
                    </Button>
                  </div>
                )}
              </Group>

              <Group title="Access" hint="The role decides what this account can open. Titles are labels only.">
                {!rolesLoaded ? (
                  <DataLoadError what="the role catalogue, so this account cannot be granted a role" error={rolesError} retryHref="/admin/staff" />
                ) : (
                  <Field label="System role" htmlFor="role-group" error={errors.roleId?.message}>
                    <RoleCards roles={orderedRoles} value={roleId} onChange={onRoleChange} invalid={!!errors.roleId} describedBy={errors.roleId ? "role-group-error" : undefined} />
                  </Field>
                )}

                {isDeptStaff && (
                  <Field label="Clinical department" htmlFor="department-group" error={errors.department?.message as string | undefined}>
                    <div id="department-group" role="radiogroup" aria-label="Clinical department" className="grid grid-cols-2 gap-2">
                      {DEPARTMENT_OPTIONS.map((opt) => {
                        const selected = department === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setValue("department", opt.value, { shouldValidate: true, shouldDirty: true })}
                            className={cn(
                              "h-10 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                              selected ? "border-primary bg-primary/5 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]" : "border-input bg-white text-slate-700 hover:border-slate-400"
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}

                <Field label="Titles (optional)" htmlFor="employeeTitleInput" error={errors.employeeType?.message}>
                  <TitleChips
                    id="employeeTitleInput"
                    titles={titles}
                    onChange={(next) => setValue("employeeType", joinEmployeeTitles(next), { shouldValidate: true, shouldDirty: true })}
                  />
                </Field>
              </Group>
              {/* Generated client-side and sent with the create request; revealed once after success. */}
              <input type="hidden" {...register("password")} />
              <input type="hidden" {...register("employeeType")} />
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-white px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-10 px-4">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !rolesLoaded} className="h-10 min-w-[11rem] bg-primary px-4 font-semibold text-white hover:bg-primary/90">
                {submitting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>) : editingStaff ? "Save changes" : "Create account"}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
