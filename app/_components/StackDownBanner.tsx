"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";

const IS_PROD = typeof window !== "undefined" && !window.location.hostname.includes("localhost");

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
        if (body.db === "ok") { setStatus("up"); router.refresh(); return; }
      } catch { /* still down */ }
      if (!cancelled) { setStatus("down"); setTimeout(() => void poll(), 4_000); }
    };

    void poll();
    const t = setInterval(() => setDots((d) => d.length >= 3 ? "" : d + "."), 600);
    return () => { cancelled = true; clearInterval(t); };
  }, [router]);

  return (
    <div className="sticky top-0 z-50 flex items-start gap-3 border-b border-amber-500/20 bg-amber-950/40 px-6 py-3 backdrop-blur-sm">
      {status === "checking"
        ? <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-amber-400" />
        : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-300">Database not connected</p>
        {IS_PROD ? (
          <p className="text-xs text-amber-500/80">
            Add <code className="rounded bg-amber-900/60 px-1 font-mono text-amber-300">DATABASE_URL</code> and{" "}
            <code className="rounded bg-amber-900/60 px-1 font-mono text-amber-300">REDIS_URL</code> in your{" "}
            <a href="https://vercel.com/dashboard" target="_blank" rel="noreferrer" className="underline text-amber-300">
              Vercel settings
            </a>{" "}
            then redeploy.
          </p>
        ) : (
          <p className="text-xs text-amber-500/80">
            Run <code className="rounded bg-amber-900/60 px-1 font-mono text-amber-300">start-all.ps1</code>.
            Auto-refreshing{dots}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {IS_PROD && (
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-900/40 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-900/70"
          >
            <ExternalLink className="h-3 w-3" />
            Vercel
          </a>
        )}
        <button
          onClick={() => router.refresh()}
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-900/40 px-3 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-900/70"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    </div>
  );
}
