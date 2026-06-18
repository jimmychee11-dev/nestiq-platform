"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  const isDbError =
    error.message?.includes("Can't reach database") ||
    error.message?.includes("ECONNREFUSED") ||
    error.message?.includes("P1001") ||
    error.message?.includes("PrismaClientInitializationError");

  useEffect(() => {
    if (isDbError) {
      const t = setTimeout(() => reset(), 5_000);
      return () => clearTimeout(t);
    }
  }, [isDbError, reset]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 mb-6">
        <AlertTriangle className="h-6 w-6 text-red-400" />
      </div>

      <h1 className="text-xl font-semibold text-zinc-100">
        {isDbError ? "Database unavailable" : "Something went wrong"}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        {isDbError
          ? (typeof window !== "undefined" && !window.location.hostname.includes("localhost")
              ? "The database isn't reachable. Check your Neon quota and DATABASE_URL in Vercel. Retrying every 5 seconds."
              : "Run start-all.ps1 to boot the stack. This page retries automatically every 5 seconds.")
          : error.message ?? "An unexpected error occurred."}
      </p>

      <div className="mt-8 flex gap-3">
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
        <button
          onClick={() => router.push("/")}
          className="rounded-xl border border-white/[0.08] px-5 py-2.5 text-sm text-zinc-400 transition hover:text-zinc-200"
        >
          Home
        </button>
      </div>

      {isDbError && (
        <p className="mt-4 text-xs text-zinc-700">Auto-retrying in 5 seconds…</p>
      )}
    </div>
  );
}
