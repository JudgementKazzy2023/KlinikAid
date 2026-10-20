import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function PatientSubmissionsLoading() {
  return <PageSkeleton variant="list" rows={4} />;
}
