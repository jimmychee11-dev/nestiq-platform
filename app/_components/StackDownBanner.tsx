"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

export default function StackDownBanner() {
  const router = useRouter();
  const [status, setStatus] = useState<"down" | "checking" | "up">("down");
  const [dots, setDots] = useState("");

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      setStatus("checking");
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const body = await r.json() as { db?: string };
        if (body.db === "ok") {
          setStatus("up");
          router.refresh();
          return;
        }
      } catch { /* still down */ }
      if (!cancelled) {
        setStatus("down");
        setTimeout(() => void poll(), 3_000);
      }
    };

    void poll();
    const dotsTimer = setInterval(() => setDots((d) => d.length >= 3 ? "" : d + "."), 600);
    return () => { cancelled = true; clearInterval(dotsTimer); };
  }, [router]);

  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-amber-500/20 bg-amber-950/40 px-6 py-3 backdrop-blur-sm">
      {status === "checking"
        ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-amber-400" />
        : <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-400" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-300">Database starting up</p>
        <p className="text-xs text-amber-500/80">
          Run <code className="rounded bg-amber-900/60 px-1 font-mono text-amber-300">start-all.ps1</code> then this page will auto-refresh{dots}
        </p>
      </div>
      <button
        onClick={() => router.refresh()}
        className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-900/40 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-900/70"
      >
        <RefreshCw className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}
