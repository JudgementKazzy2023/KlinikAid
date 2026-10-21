import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function PatientChatLoading() {
  return <PageSkeleton variant="list" rows={3} />;
}
