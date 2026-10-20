import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function StaffManagementLoading() {
  return <PageSkeleton variant="table" rows={6} />;
}
