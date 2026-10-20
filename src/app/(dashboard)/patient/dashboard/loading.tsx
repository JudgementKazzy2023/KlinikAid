import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function PatientDashboardLoading() {
  return <PageSkeleton variant="cards" columns={4} rows={4} />;
}
