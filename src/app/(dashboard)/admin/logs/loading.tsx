import React from "react";
import PageSkeleton from "@/components/PageSkeleton";

export default function LogsLoading() {
  return <PageSkeleton variant="list" rows={5} />;
}
