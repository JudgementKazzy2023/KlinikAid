import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function RolesLoading() {
  return <PageSkeleton variant="cards" columns={3} rows={4} />;
}
