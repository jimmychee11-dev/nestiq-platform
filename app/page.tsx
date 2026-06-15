import Link from "next/link";
import { ArrowRight, Bot, Building2, Plus, Sparkles, Zap } from "lucide-react";
import { prisma } from "@/src/lib/db";
import StackDownBanner from "./_components/StackDownBanner";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let companies: Array<{ id: string; slug: string; name: string }> = [];
  let dbDown = false;

  try {
    companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, slug: true, name: true },
    });
  } catch {
    dbDown = true;
  }

  return (
    <>
      {dbDown && <StackDownBanner />}
      <main className="mx-auto max-w-2xl px-6 py-20">
        <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15">
          <Zap className="h-5 w-5 text-emerald-400" />
        </div>

        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-400">NestIQ</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-zinc-100">
          Autonomous company<br />operations
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-400">
          Describe your business once. An AI CEO and four specialist agents plan, build, and
          execute around the clock.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { icon: <Bot className="h-3 w-3" />, label: "5 AI agents" },
            { icon: <Sparkles className="h-3 w-3" />, label: "Goal-to-task planning" },
            { icon: <Zap className="h-3 w-3" />, label: "Real-time execution" },
          ].map(({ icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs text-zinc-400"
            >
              {icon}
              {label}
            </span>
          ))}
        </div>

        <Link
          href="/setup"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          Start a new company
        </Link>

        {companies.length > 0 && (
          <section className="mt-14">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">
              Your companies
            </p>
            <ul className="mt-3 space-y-2">
              {companies.map((company) => (
                <li key={company.id}>
                  <Link
                    href={`/dashboard/${company.slug}`}
                    className="group flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 transition hover:border-emerald-500/30 hover:bg-white/[0.04]"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                        <Building2 className="h-4 w-4 text-emerald-400" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-zinc-200">
                          {company.name}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-600">/{company.slug}</span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-400" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
