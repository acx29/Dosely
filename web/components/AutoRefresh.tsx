"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetches the current page's server data on a timer, so the screens follow the database
 * without a manual reload. The recall job stamps events minutes ahead and the queries only
 * return rows whose time has arrived, so each refresh can show new activity.
 *
 * Does nothing when the app is reading fixtures (no API address set), and pauses while the
 * browser tab is in the background.
 */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_API_URL) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);

  return null;
}
