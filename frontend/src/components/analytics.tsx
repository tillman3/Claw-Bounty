"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    // Fire and forget — don't block rendering
    fetch(`/api/analytics/pageview?page=${encodeURIComponent(pathname)}`).catch(() => {});
  }, [pathname]);

  return null;
}
