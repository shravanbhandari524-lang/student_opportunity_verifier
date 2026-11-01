"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLastActiveCheckId } from "../lib/client-logger.js";

/**
 * Top navigation link for "Final Report" that dynamically routes to the
 * latest active or viewed check report in the browser session.
 */
export default function FinalReportNavLink() {
  const [reportUrl, setReportUrl] = useState("/check");
  const pathname = usePathname();

  useEffect(() => {
    function updateUrl() {
      const lastId = getLastActiveCheckId();
      if (lastId) {
        setReportUrl(`/check/${lastId}`);
      }
    }

    updateUrl();
    window.addEventListener("storage", updateUrl);
    window.addEventListener("debug_logs_updated", updateUrl);

    return () => {
      window.removeEventListener("storage", updateUrl);
      window.removeEventListener("debug_logs_updated", updateUrl);
    };
  }, []);

  const isCurrentReport =
    Boolean(pathname) && pathname.startsWith("/check/") && pathname !== "/check";

  return (
    <Link
      href={reportUrl}
      className={`nav-item ${isCurrentReport ? "active" : ""}`}
      style={isCurrentReport ? { fontWeight: 700, color: "var(--accent-primary)" } : {}}
      title="View the latest opportunity risk report"
    >
      Final Report
    </Link>
  );
}
