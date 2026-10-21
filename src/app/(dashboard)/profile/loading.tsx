import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function ProfileLoading() {
  return <PageSkeleton variant="cards" columns={2} rows={3} />;
}
