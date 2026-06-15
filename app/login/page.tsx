"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Loader2, Lock, Zap } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/login?next=${encodeURIComponent(next)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (!res.ok) { setError("Invalid access token"); setLoading(false); return; }
      router.push(next);
    } catch {
      setError("Network error — is the server running?");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-5">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
          <Zap className="h-4 w-4 text-emerald-400" />
        </div>
        <span className="text-lg font-bold text-zinc-100">NestIQ</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Access Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">Enter your dashboard access token to continue.</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-400">Access Token</label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="nestiq_••••••••"
            autoFocus
            className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 pl-9 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <button
        type="submit"
        disabled={loading || !token.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
