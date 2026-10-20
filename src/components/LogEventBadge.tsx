import React from "react";
import { Badge } from "@/components/ui/badge";
import { EVENT_BADGE_STYLES, DEFAULT_BADGE_STYLE } from "@/lib/log-event-badge-styles";

interface LogEventBadgeProps {
  eventType: string;
}


export default function LogEventBadge({ eventType }: LogEventBadgeProps) {
  const style = EVENT_BADGE_STYLES[eventType] || {
    ...DEFAULT_BADGE_STYLE,
    label: eventType.replace(/_/g, " "),
  };

  return (
    <Badge
      variant="outline"
      className={`${style.classes} font-medium text-xs px-2 py-0.5 whitespace-nowrap`}
    >
      {style.label}
    </Badge>
  );
}
