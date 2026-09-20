"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function refreshEvidenceStatus(evidenceId: string, refresh: () => void): void {
  void fetch(`/api/evidence/${evidenceId}`, { cache: "no-store" })
    .finally(refresh);
}

export function StatusRefresh({ evidenceId }: { evidenceId: string }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      // This route also retries a durable assessment-dispatch record. Keep the
      // receipt private by using the browser's same-origin session cookie.
      refreshEvidenceStatus(evidenceId, () => router.refresh());
    };
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, [evidenceId, router]);
  return null;
}
