"use client";

/**
 * Onboarding wizard — /setup
 *
 * Step 1: business idea + company name
 * Step 2: industry, target market, stage
 * Step 3: review → submit → live canvas generation → enter dashboard
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Lightbulb,
  Loader2,
  Rocket,
  Sparkles,
  Target,
} from "lucide-react";

type Stage = "idea" | "launched" | "scaling";

interface LeanCanvas {
  problem: string[];
  customerSegments: string[];
  uniqueValueProposition: string;
  solution: string[];
  channels: string[];
  revenueStreams: string[];
  costStructure: string[];
  keyMetrics: string[];
  unfairAdvantage: string;
}

interface CreateResponse {
  id: string;
  slug: string;
  name: string;
  canvas: LeanCanvas | null;
  canvasError: string | null;
}

const STAGES: Array<{ value: Stage; label: string; description: string }> = [
  { value: "idea", label: "Idea", description: "Pre-launch — validating the concept" },
  { value: "launched", label: "Launched", description: "Live product, early customers" },
  { value: "scaling", label: "Scaling", description: "Growing revenue, expanding channels" },
];

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 " +
  "placeholder-zinc-600 outline-none transition focus:border-emerald-500";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [industry, setIndustry] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [stage, setStage] = useState<Stage>("idea");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const step1Valid = name.trim().length >= 2 && idea.trim().length >= 10;
  const step2Valid = industry.trim().length >= 2 && targetMarket.trim().length >= 2;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, idea, industry, targetMarket, stage }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setResult((await res.json()) as CreateResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Canvas result screen -------------------------------------------------
  if (result) {
    const canvas = result.canvas;
    const cells: Array<{ title: string; body: string }> = canvas
      ? [
          { title: "Problem", body: canvas.problem.join("\n") },
          { title: "Customer Segments", body: canvas.customerSegments.join("\n") },
          { title: "Unique Value Proposition", body: canvas.uniqueValueProposition },
          { title: "Solution", body: canvas.solution.join("\n") },
          { title: "Channels", body: canvas.channels.join("\n") },
          { title: "Revenue Streams", body: canvas.revenueStreams.join("\n") },
          { title: "Cost Structure", body: canvas.costStructure.join("\n") },
          { title: "Key Metrics", body: canvas.keyMetrics.join("\n") },
          { title: "Unfair Advantage", body: canvas.unfairAdvantage },
        ]
      : [];
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="text-center">
          <Sparkles className="mx-auto text-emerald-400" size={28} />
          <h1 className="mt-3 text-2xl font-semibold">{result.name} is ready</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {canvas
              ? "Your AI CEO generated this lean canvas — it now guides every agent."
              : `Company created, but canvas generation failed: ${result.canvasError}`}
          </p>
        </div>
        {canvas ? (
          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cells.map((cell) => (
              <div key={cell.title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  {cell.title}
                </h3>
                <p className="mt-2 whitespace-pre-line text-sm text-zinc-300">{cell.body}</p>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-10 text-center">
          <button
            onClick={() => router.push(`/dashboard/${result.slug}`)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
          >
            <Rocket size={16} /> Enter operations dashboard
          </button>
        </div>
      </main>
    );
  }

  // ---- Generating screen ----------------------------------------------------
  if (submitting) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <Loader2 className="animate-spin text-emerald-400" size={32} />
        <h1 className="mt-4 text-xl font-semibold">Analyzing your business…</h1>
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Deploying your five-agent fleet and generating a lean canvas for{" "}
          <span className="text-zinc-200">{name}</span>. This takes about a minute.
        </p>
      </main>
    );
  }

  // ---- Wizard ---------------------------------------------------------------
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
        NestIQ · New Company
      </p>
      <div className="mt-2 flex gap-1.5">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`h-1 flex-1 rounded-full ${n <= step ? "bg-emerald-500" : "bg-zinc-800"}`}
          />
        ))}
      </div>

      {step === 1 ? (
        <section className="mt-8 space-y-5">
          <div className="flex items-center gap-2">
            <Lightbulb className="text-emerald-400" size={20} />
            <h1 className="text-xl font-semibold">What are you building?</h1>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Company name</label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NestIQ"
              maxLength={80}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Business idea — what does it do, and for whom?
            </label>
            <textarea
              className={`${inputClass} min-h-32 resize-y`}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. A subscription service that ships curated coffee from small Malaysian roasters to offices in KL, with an app for teams to vote on next month's beans."
              maxLength={2000}
            />
            <p className="mt-1 text-right text-[11px] text-zinc-600">{idea.length}/2000</p>
          </div>
          <button
            disabled={!step1Valid}
            onClick={() => setStep(2)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue <ArrowRight size={15} />
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-8 space-y-5">
          <div className="flex items-center gap-2">
            <Target className="text-emerald-400" size={20} />
            <h1 className="text-xl font-semibold">Who is it for?</h1>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Industry</label>
            <input
              className={inputClass}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Food & beverage subscription"
              maxLength={120}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Target market</label>
            <input
              className={inputClass}
              value={targetMarket}
              onChange={(e) => setTargetMarket(e.target.value)}
              placeholder="e.g. 20-200 person companies in Kuala Lumpur with office pantries"
              maxLength={500}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">Stage</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {STAGES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStage(s.value)}
                  className={`rounded-lg border p-3 text-left transition ${
                    stage === s.value
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
                  }`}
                >
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{s.description}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 transition hover:border-zinc-500"
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button
              disabled={!step2Valid}
              onClick={() => setStep(3)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue <ArrowRight size={15} />
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="mt-8 space-y-5">
          <div className="flex items-center gap-2">
            <Building2 className="text-emerald-400" size={20} />
            <h1 className="text-xl font-semibold">Review & launch</h1>
          </div>
          <dl className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm">
            {[
              ["Company", name],
              ["Idea", idea],
              ["Industry", industry],
              ["Target market", targetMarket],
              ["Stage", STAGES.find((s) => s.value === stage)?.label ?? stage],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  {label}
                </dt>
                <dd className="mt-0.5 text-zinc-200">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-zinc-500">
            Launching deploys five AI agents (CEO, Engineering, Marketing, Sales, Operations) and
            generates a lean business model canvas that guides everything they do.
          </p>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 transition hover:border-zinc-500"
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button
              onClick={() => void submit()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
            >
              <Rocket size={15} /> Launch company
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
