"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Code,
  ExternalLink,
  File,
  FileCode,
  FileText,
  FolderOpen,
  Globe,
  Lightbulb,
  Loader2,
  Plug,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentRole = "CEO" | "ENGINEERING" | "MARKETING" | "SALES" | "OPERATIONS";
type AgentStatus = "IDLE" | "PLANNING" | "EXECUTING" | "PAUSED" | "ERROR" | "OFFLINE";
type LogKind = "SYSTEM" | "MESSAGE" | "THOUGHT" | "TOOL_CALL" | "TOOL_RESULT" | "ERROR";
type TaskStatus =
  | "PENDING" | "QUEUED" | "RUNNING" | "SUCCESS"
  | "FAILED" | "AWAITING_HUMAN_REVIEW" | "CANCELLED";

interface AgentSummary {
  id: string; name: string; role: AgentRole;
  status: AgentStatus; model: string; lastActiveAt: string | null;
}
interface Overview {
  company: { id: string; slug: string; name: string; arrCents: number };
  metrics: { tasksCompleted: number; tasksRunning: number; awaitingReview: number; activeAgents: number; connectedServers: number };
  throughput: Array<{ day: string; tasks: number }>;
  agents: AgentSummary[];
}
interface Task {
  id: string; title: string; goal: string; status: TaskStatus;
  priority: number; parentId: string | null;
  agent: { role: AgentRole; name: string } | null;
  startedAt: string | null; endedAt: string | null;
  createdAt: string; preview: string | null;
}
interface TaskDetail {
  id: string; title: string; goal: string; status: TaskStatus;
  error: string | null; result: unknown; input: unknown;
  agent: { role: AgentRole; name: string } | null;
  startedAt: string | null; endedAt: string | null; createdAt: string;
  logs: Array<{ id: string; seq: number; kind: LogKind; agentRole: AgentRole | null; content: string; toolName: string | null; createdAt: string }>;
}
interface LogEvent {
  id: string; seq: number; createdAt: string; kind: LogKind;
  level: string; agentRole: AgentRole | null; content: string; toolName: string | null;
}
interface SandboxFile {
  name: string; relativePath: string; size: number; modifiedAt: string; ext: string;
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const ROLE = {
  CEO:         { icon: "⚡", bg: "bg-violet-500/10", text: "text-violet-300", border: "border-violet-500/25", dot: "bg-violet-400", log: "text-violet-400" },
  ENGINEERING: { icon: "💻", bg: "bg-sky-500/10",    text: "text-sky-300",    border: "border-sky-500/25",    dot: "bg-sky-400",    log: "text-sky-400"    },
  MARKETING:   { icon: "📣", bg: "bg-pink-500/10",   text: "text-pink-300",   border: "border-pink-500/25",   dot: "bg-pink-400",   log: "text-pink-400"   },
  SALES:       { icon: "💵", bg: "bg-emerald-500/10",text: "text-emerald-300",border: "border-emerald-500/25",dot: "bg-emerald-400", log: "text-emerald-400"},
  OPERATIONS:  { icon: "⚙️", bg: "bg-orange-500/10", text: "text-orange-300", border: "border-orange-500/25", dot: "bg-orange-400",  log: "text-orange-400" },
} satisfies Record<AgentRole, { icon: string; bg: string; text: string; border: string; dot: string; log: string }>;

const AGENT_STATUS = {
  IDLE:      { dot: "bg-zinc-600",    label: "Idle",            pulse: false },
  PLANNING:  { dot: "bg-amber-400",   label: "Planning",        pulse: true  },
  EXECUTING: { dot: "bg-emerald-400", label: "Executing",       pulse: true  },
  PAUSED:    { dot: "bg-amber-400",   label: "Awaiting review", pulse: false },
  ERROR:     { dot: "bg-red-500",     label: "Error",           pulse: false },
  OFFLINE:   { dot: "bg-zinc-700",    label: "Offline",         pulse: false },
} satisfies Record<AgentStatus, { dot: string; label: string; pulse: boolean }>;

const TASK_STATUS = {
  PENDING:               { label: "Queued",       color: "text-zinc-400",   bg: "bg-zinc-800/30",    border: "border-zinc-700/40"    },
  QUEUED:                { label: "Queued",       color: "text-amber-400",  bg: "bg-amber-950/40",   border: "border-amber-700/30"   },
  RUNNING:               { label: "Running",      color: "text-emerald-400",bg: "bg-emerald-950/40", border: "border-emerald-700/30" },
  SUCCESS:               { label: "Done",         color: "text-emerald-400",bg: "bg-zinc-900/60",    border: "border-zinc-800/60"    },
  FAILED:                { label: "Failed",       color: "text-red-400",    bg: "bg-red-950/20",     border: "border-red-700/25"     },
  AWAITING_HUMAN_REVIEW: { label: "Needs review", color: "text-amber-400",  bg: "bg-amber-950/30",   border: "border-amber-600/35"   },
  CANCELLED:             { label: "Cancelled",    color: "text-zinc-600",   bg: "bg-zinc-900/40",    border: "border-zinc-800/40"    },
} satisfies Record<TaskStatus, { label: string; color: string; bg: string; border: string }>;

const LOG_STYLE: Record<LogKind, string> = {
  SYSTEM:      "text-zinc-500",
  MESSAGE:     "text-zinc-200",
  THOUGHT:     "text-zinc-600 italic",
  TOOL_CALL:   "text-cyan-400",
  TOOL_RESULT: "text-zinc-400",
  ERROR:       "text-red-400",
};

const FILE_ICONS: Record<string, React.ReactNode> = {
  html:  <Globe className="h-3.5 w-3.5 text-orange-400" />,
  css:   <FileCode className="h-3.5 w-3.5 text-sky-400" />,
  js:    <FileCode className="h-3.5 w-3.5 text-yellow-400" />,
  ts:    <FileCode className="h-3.5 w-3.5 text-blue-400" />,
  md:    <FileText className="h-3.5 w-3.5 text-zinc-400" />,
  json:  <Code className="h-3.5 w-3.5 text-green-400" />,
  txt:   <FileText className="h-3.5 w-3.5 text-zinc-500" />,
  toml:  <Code className="h-3.5 w-3.5 text-zinc-400" />,
  yaml:  <Code className="h-3.5 w-3.5 text-zinc-400" />,
  csv:   <FileText className="h-3.5 w-3.5 text-emerald-400" />,
};

const MAX_LOGS = 500;
const SUGGESTIONS = [
  "Create a business model canvas and save it as a report",
  "Research top 5 competitors and summarize positioning",
  "Write a landing page with sign-up form",
  "Draft a 3-email cold outreach sequence",
  "Plan a 30-day content strategy for launch",
];

// ── DB-down self-healing screen ───────────────────────────────────────────────

function DbDownScreen({ onRetry }: { onRetry: () => void }) {
  const [dots, setDots] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const dotsT = setInterval(() => setDots((d) => d.length >= 3 ? "" : d + "."), 600);
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      setChecking(true);
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const body = await r.json() as { db?: string };
        if (body.db === "ok") { onRetry(); return; }
      } catch { /* still down */ }
      setChecking(false);
      if (!cancelled) setTimeout(() => void poll(), 4_000);
    };
    void poll();
    return () => { cancelled = true; clearInterval(dotsT); };
  }, [onRetry]);

  const isCloud = typeof window !== "undefined" && !window.location.hostname.includes("localhost");

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-8 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10">
          {checking
            ? <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
            : <Zap className="h-7 w-7 text-amber-400" />}
        </div>
        <h2 className="text-xl font-semibold text-zinc-100">Database unavailable</h2>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
          Auto-checking every 4 seconds{dots}
        </p>
        {isCloud ? (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-left space-y-1">
            <p className="text-xs font-semibold text-amber-300">Possible causes:</p>
            <p className="text-xs text-amber-400/80">• Neon free-tier monthly quota exceeded — upgrade at neon.tech</p>
            <p className="text-xs text-amber-400/80">• DATABASE_URL env var missing or invalid in Vercel</p>
            <p className="text-xs text-amber-400/80">• Neon compute is waking up — retry in a few seconds</p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-left">
            <p className="text-xs font-semibold text-amber-300 mb-1">To start the stack:</p>
            <code className="text-xs text-amber-400 font-mono">
              powershell -ExecutionPolicy Bypass -File start-all.ps1
            </code>
          </div>
        )}
        <button
          onClick={onRetry}
          className="mt-5 flex items-center gap-2 mx-auto rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-400"
        >
          <RefreshCw className="h-4 w-4" />
          Retry now
        </button>
      </div>
    </div>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmtARR(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(1)}K`;
  return `$${d.toFixed(0)}`;
}
function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function RolePill({ role }: { role: AgentRole }) {
  const r = ROLE[role];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${r.bg} ${r.text} ${r.border}`}>
      <span>{r.icon}</span>{role}
    </span>
  );
}

// ── Review Modal ───────────────────────────────────────────────────────────────

interface Alternative {
  title: string;
  description: string;
  instruction: string;
  effort: string;
}

function ReviewModal({
  taskId,
  onClose,
  onResumed,
}: {
  taskId: string;
  onClose: () => void;
  onResumed: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [altLoading, setAltLoading] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"alternatives" | "output" | "trace">("alternatives");
  const [selectedAlt, setSelectedAlt] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d as TaskDetail); setLoading(false); })
      .catch(() => setLoading(false));
  }, [taskId]);

  // Auto-fetch alternatives once detail loads
  useEffect(() => {
    if (!detail) return;
    setAltLoading(true);
    fetch(`/api/tasks/${taskId}/alternatives`, { method: "POST" })
      .then((r) => r.json())
      .then((d: { alternatives?: Alternative[] }) => {
        if (d.alternatives) setAlternatives(d.alternatives);
      })
      .catch(() => {})
      .finally(() => setAltLoading(false));
  }, [detail, taskId]);

  const applyAlternative = (idx: number) => {
    setSelectedAlt(idx);
    setInstruction(alternatives[idx]?.instruction ?? "");
    setActiveTab("alternatives");
  };

  const resume = async () => {
    if (submitting) return;
    setSubmitting(true);
    await fetch(`/api/tasks/${taskId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: instruction.trim() || undefined }),
    });
    setSubmitting(false);
    onResumed();
    onClose();
  };

  const msgLogs = detail?.logs.filter((l) => l.kind === "MESSAGE") ?? [];
  const allLogs = detail?.logs ?? [];

  const ALT_COLORS = [
    { border: "border-emerald-500/30", bg: "bg-emerald-950/20", badge: "bg-emerald-500/15 text-emerald-300" },
    { border: "border-sky-500/30",     bg: "bg-sky-950/20",     badge: "bg-sky-500/15 text-sky-300"     },
    { border: "border-violet-500/30",  bg: "bg-violet-950/20",  badge: "bg-violet-500/15 text-violet-300" },
    { border: "border-pink-500/30",    bg: "bg-pink-950/20",    badge: "bg-pink-500/15 text-pink-300"    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950 shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="min-w-0">
            {detail?.agent && <RolePill role={detail.agent.role} />}
            <h2 className="mt-2 text-base font-semibold text-zinc-100 leading-snug">
              {loading ? "Loading…" : detail?.title ?? "Task"}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 line-clamp-1">{detail?.goal}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-lg p-1.5 hover:bg-white/[0.06] transition-colors">
            <X className="h-4 w-4 text-zinc-400" />
          </button>
        </div>

        {/* Blocker reason */}
        {detail?.error && (
          <div className="flex gap-3 border-b border-red-700/20 bg-red-950/15 px-6 py-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-400 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed">{detail.error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/[0.05] px-6">
          {([
            ["alternatives", <Lightbulb key="a" className="h-3.5 w-3.5" />, "AI Solutions"],
            ["output",       <Sparkles  key="o" className="h-3.5 w-3.5" />, "Agent Output"],
            ["trace",        <Terminal  key="t" className="h-3.5 w-3.5" />, "Trace"],
          ] as const).map(([tab, icon, label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`mr-4 flex items-center gap-1.5 border-b-2 py-2.5 text-xs font-bold transition-colors ${
                activeTab === tab ? "border-emerald-500 text-emerald-400" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}>
              {icon}{label}
              {tab === "alternatives" && alternatives.length > 0 && (
                <span className="ml-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">{alternatives.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto console-scroll px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-emerald-400" /></div>
          ) : activeTab === "alternatives" ? (
            <div className="space-y-3">
              {altLoading ? (
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-6 justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" />
                  <span className="text-sm text-zinc-400">AI is generating recovery options…</span>
                </div>
              ) : alternatives.length === 0 ? (
                <p className="text-sm text-zinc-500 italic">No alternatives generated yet.</p>
              ) : (
                alternatives.map((alt, i) => {
                  const c = ALT_COLORS[i % ALT_COLORS.length]!;
                  const isSelected = selectedAlt === i;
                  return (
                    <div key={i} className={`rounded-xl border p-4 transition-all cursor-pointer ${isSelected ? `${c.border} ${c.bg}` : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.10]"}`}
                      onClick={() => applyAlternative(i)}>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${c.badge}`}>Option {i + 1}</span>
                          <span className="text-sm font-bold text-zinc-200">{alt.title}</span>
                        </div>
                        <span className="flex-shrink-0 text-[10px] text-zinc-500 whitespace-nowrap">{alt.effort}</span>
                      </div>
                      <p className="text-xs text-zinc-400 mb-3">{alt.description}</p>
                      <div className="rounded-lg border border-white/[0.05] bg-black/30 px-3 py-2">
                        <p className="text-[11px] text-zinc-400 font-mono leading-relaxed line-clamp-3">{alt.instruction}</p>
                      </div>
                      {isSelected && (
                        <p className="mt-2 text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Applied to instruction field below
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : activeTab === "output" ? (
            msgLogs.length === 0 ? (
              <p className="text-sm text-zinc-500 italic">No agent output yet.</p>
            ) : (
              <div className="space-y-4">
                {msgLogs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-4">
                    <div className="mb-2 flex items-center gap-2">
                      {log.agentRole && <RolePill role={log.agentRole} />}
                      <span className="text-[10px] text-zinc-600">{fmtTime(log.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{log.content}</p>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-0.5 font-mono text-[11.5px]">
              {allLogs.map((log) => (
                <div key={log.id} className={`flex gap-2 py-0.5 ${LOG_STYLE[log.kind]}`}>
                  <span className="flex-shrink-0 text-zinc-700">{fmtTime(log.createdAt)}</span>
                  {log.agentRole && <span className={`flex-shrink-0 font-bold ${ROLE[log.agentRole]?.log ?? "text-zinc-400"}`}>[{log.agentRole}]</span>}
                  {log.kind === "TOOL_CALL" && log.toolName && <span className="flex-shrink-0 font-bold text-cyan-500">[{log.toolName}]</span>}
                  <span className="break-all whitespace-pre-wrap">{log.content}</span>
                </div>
              ))}
              {allLogs.length === 0 && <p className="text-zinc-600">No trace available.</p>}
            </div>
          )}
        </div>

        {/* Instruction + resume */}
        <div className="border-t border-white/[0.06] bg-zinc-950 px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-zinc-400">
              Instruction for the agent
            </label>
            {selectedAlt !== null && (
              <button onClick={() => { setSelectedAlt(null); setInstruction(""); }} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                Clear selection
              </button>
            )}
          </div>
          <textarea
            value={instruction}
            onChange={(e) => { setInstruction(e.target.value); setSelectedAlt(null); }}
            placeholder='Click an AI suggestion above, or type your own instruction…'
            rows={2}
            className="w-full resize-none rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-emerald-500/40 transition"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-zinc-600">Leave blank to retry with no change</p>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
              <button onClick={resume} disabled={submitting}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40">
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {submitting ? "Resuming…" : "Resume Agent"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── File Viewer Modal ──────────────────────────────────────────────────────────

function FileViewerModal({
  file,
  companyId,
  onClose,
}: {
  file: SandboxFile;
  companyId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/companies/${companyId}/files/content?path=${encodeURIComponent(file.relativePath)}`)
      .then((r) => r.json())
      .then((d: { content?: string; error?: string }) => {
        if (d.error) setErr(d.error);
        else setContent(d.content ?? "");
        setLoading(false);
      })
      .catch(() => { setErr("Failed to load file"); setLoading(false); });
  }, [file.relativePath, companyId]);

  const isHtml = file.ext === "html";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
          <div className="flex items-center gap-2">
            {FILE_ICONS[file.ext] ?? <File className="h-3.5 w-3.5 text-zinc-500" />}
            <span className="text-sm font-semibold text-zinc-200">{file.relativePath}</span>
            <span className="text-[10px] text-zinc-600">{fmtBytes(file.size)}</span>
          </div>
          <div className="flex items-center gap-2">
            {isHtml && content && (
              <button
                onClick={() => {
                  const blob = new Blob([content], { type: "text/html" });
                  window.open(URL.createObjectURL(blob));
                }}
                className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08] transition-colors"
              >
                <ExternalLink className="h-3 w-3" /> Preview
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/[0.06] transition-colors">
              <X className="h-4 w-4 text-zinc-400" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto console-scroll bg-black/40">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            </div>
          ) : err ? (
            <div className="p-6 text-sm text-red-400">{err}</div>
          ) : (
            <pre className="p-5 font-mono text-[12px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Deliverables tab ───────────────────────────────────────────────────────────

const FILE_GROUPS: { label: string; icon: React.ReactNode; exts: string[] }[] = [
  { label: "Web / App",   icon: <Globe className="h-3.5 w-3.5" />,    exts: ["html", "css", "js", "ts", "tsx", "jsx"] },
  { label: "Documents",   icon: <FileText className="h-3.5 w-3.5" />, exts: ["md", "txt", "pdf", "docx"] },
  { label: "Data / Code", icon: <Code className="h-3.5 w-3.5" />,     exts: ["json", "csv", "yaml", "toml", "sql", "xml"] },
  { label: "Other",       icon: <File className="h-3.5 w-3.5" />,     exts: [] },
];

function DeliverablesTab({ companyId }: { companyId: string }) {
  const [files, setFiles] = useState<SandboxFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<SandboxFile | null>(null);

  useEffect(() => {
    fetch(`/api/companies/${companyId}/files`)
      .then((r) => r.json())
      .then((d: { files: SandboxFile[] }) => { setFiles(d.files ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [companyId]);

  const grouped = FILE_GROUPS.map((g) => {
    const items = g.exts.length
      ? files.filter((f) => g.exts.includes(f.ext))
      : files.filter((f) => !FILE_GROUPS.slice(0, -1).flatMap((x) => x.exts).includes(f.ext));
    return { ...g, items };
  }).filter((g) => g.items.length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] py-16 text-center">
        <FolderOpen className="mb-3 h-8 w-8 text-zinc-700" />
        <p className="text-sm font-medium text-zinc-500">No files yet</p>
        <p className="mt-1 text-xs text-zinc-600">
          Files and reports created by agents will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      {viewing && (
        <FileViewerModal file={viewing} companyId={companyId} onClose={() => setViewing(null)} />
      )}
      <div className="space-y-6">
        {grouped.map((g) => (
          <div key={g.label}>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-400">
              {g.icon}
              {g.label}
              <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
                {g.items.length}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((f) => (
                <button
                  key={f.relativePath}
                  onClick={() => setViewing(f)}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition hover:border-emerald-500/30 hover:bg-white/[0.04]"
                >
                  <span className="flex-shrink-0">
                    {FILE_ICONS[f.ext] ?? <File className="h-3.5 w-3.5 text-zinc-500" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-zinc-300">{f.name}</p>
                    <p className="truncate text-[10px] text-zinc-600">{f.relativePath.includes("/") ? f.relativePath.split("/").slice(0, -1).join("/") : ""}</p>
                    <p className="text-[10px] text-zinc-700">{fmtBytes(f.size)} · {timeAgo(f.modifiedAt)}</p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-zinc-600" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Metric strip ───────────────────────────────────────────────────────────────

function Metric({ icon, label, value, sub, accent = "text-emerald-400", accentBg = "bg-emerald-500/10" }: {
  icon: React.ReactNode; label: string; value: string | number;
  sub?: string; accent?: string; accentBg?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5">
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${accentBg} ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</p>
        <p className="text-2xl font-semibold tabular-nums leading-tight text-zinc-100">{value}</p>
        {sub && <p className="text-[11px] text-zinc-600">{sub}</p>}
      </div>
    </div>
  );
}

// ── Task card ──────────────────────────────────────────────────────────────────

function TaskCard({ task, onReview }: { task: Task; onReview?: (id: string) => void }) {
  const s = TASK_STATUS[task.status];
  const isRunning = task.status === "RUNNING" || task.status === "QUEUED";
  const needsReview = task.status === "AWAITING_HUMAN_REVIEW";

  return (
    <div className={`relative flex flex-col gap-2.5 rounded-2xl border p-4 transition ${s.bg} ${s.border}`}>
      {isRunning && <span className="absolute left-0 top-4 bottom-4 w-0.5 rounded-r-full bg-emerald-400 animate-pulse" />}

      <div className="flex items-center justify-between gap-2">
        {task.agent ? <RolePill role={task.agent.role} /> : <span />}
        <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${s.color}`}>
          <Dot
            color={isRunning ? "bg-emerald-400" : needsReview ? "bg-amber-400" : task.status === "SUCCESS" ? "bg-emerald-400" : task.status === "FAILED" ? "bg-red-500" : "bg-zinc-600"}
            pulse={isRunning}
          />
          {s.label}
        </span>
      </div>

      <div>
        <p className="text-sm font-semibold leading-snug text-zinc-200">{task.title}</p>
        {task.preview && (
          <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-zinc-500">{task.preview}</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] text-zinc-600">
          <Clock className="h-3 w-3" />
          {task.status === "SUCCESS" ? timeAgo(task.endedAt) : isRunning ? `Started ${timeAgo(task.startedAt)}` : timeAgo(task.createdAt)}
        </span>
        {needsReview && onReview && (
          <button
            onClick={() => onReview(task.id)}
            className="rounded-lg bg-amber-500/20 px-3 py-1 text-[11px] font-bold text-amber-300 transition hover:bg-amber-500/30"
          >
            Review →
          </button>
        )}
        {task.status === "SUCCESS" && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
            <CheckCircle2 className="h-3 w-3" /> Done
          </span>
        )}
      </div>
    </div>
  );
}

// ── Agent card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, runningTask }: { agent: AgentSummary; runningTask: Task | undefined }) {
  const r = ROLE[agent.role];
  const s = AGENT_STATUS[agent.status];
  const isActive = agent.status === "EXECUTING" || agent.status === "PLANNING";

  return (
    <div className={`rounded-2xl border p-3.5 ${isActive ? `${r.border} border` : "border-white/[0.05]"} bg-white/[0.02]`}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-sm ${r.bg}`}>{r.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-bold ${r.text}`}>{agent.role}</span>
            <Dot color={s.dot} pulse={s.pulse} />
          </div>
          <p className={`text-[10px] ${isActive ? "text-zinc-400" : "text-zinc-600"}`}>{s.label}</p>
        </div>
      </div>
      {runningTask ? (
        <p className="line-clamp-2 text-[11px] leading-relaxed text-zinc-400">{runningTask.title}</p>
      ) : (
        <p className="text-[11px] italic text-zinc-700">Waiting for work</p>
      )}
      {agent.lastActiveAt && <p className="mt-2 text-[10px] text-zinc-700">{timeAgo(agent.lastActiveAt)}</p>}
    </div>
  );
}

// ── Console drawer ─────────────────────────────────────────────────────────────

function ConsoleDrawer({ logs, connected }: { logs: LogEvent[]; connected: boolean }) {
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
  }, []);

  useEffect(() => {
    if (open && pinned.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, open]);

  return (
    <div className="rounded-2xl border border-white/[0.05] bg-zinc-950 overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left transition hover:bg-white/[0.02]">
        <Terminal className="h-3.5 w-3.5 text-zinc-600" />
        <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Live Console</span>
        <span className="ml-1 rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600">{logs.length}</span>
        <span className="flex items-center gap-1 ml-2">
          <Radio className={`h-2.5 w-2.5 ${connected ? "text-emerald-400" : "text-zinc-700"}`} />
          <span className={`text-[10px] ${connected ? "text-emerald-500" : "text-zinc-600"}`}>{connected ? "live" : "reconnecting"}</span>
        </span>
        <span className="ml-auto">{open ? <ChevronUp className="h-4 w-4 text-zinc-600" /> : <ChevronDown className="h-4 w-4 text-zinc-600" />}</span>
      </button>
      {open && (
        <div onScroll={onScroll} className="console-scroll h-72 overflow-y-auto border-t border-white/[0.04] bg-black/60 px-4 py-3">
          {logs.length === 0 ? <p className="font-mono text-xs text-zinc-700">No activity yet…</p> : logs.map((log) => (
            <div key={log.id} className={`flex gap-2 py-0.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all ${LOG_STYLE[log.kind]}`}>
              <span className="flex-shrink-0 text-zinc-700">{fmtTime(log.createdAt)}</span>
              {log.agentRole && <span className={`flex-shrink-0 font-bold ${ROLE[log.agentRole]?.log ?? "text-zinc-400"}`}>[{log.agentRole}]</span>}
              <span>{log.content}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ── Work Board section label ───────────────────────────────────────────────────

function Section({ title, icon, count, color, children }: {
  title: string; icon: React.ReactNode; count: number; color: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`mb-3 flex items-center gap-2 text-xs font-bold ${color}`}>
        {icon}{title}
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">{count}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DashboardPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [goalMsg, setGoalMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"board" | "files">("board");

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/overview`, { cache: "no-store" });
      if (res.status === 503) {
        setError("db-down");
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      setOverview(await res.json());
      setError(null);
    } catch {
      setError("db-down");
    }
  }, [companyId]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/companies/${companyId}/tasks`);
      if (res.ok) setTasks((await res.json() as { tasks: Task[] }).tasks);
    } catch { /* silent — overview error already surfaced */ }
  }, [companyId]);

  // Adaptive polling: fast when tasks are running, slow when idle.
  useEffect(() => {
    void fetchOverview();
    void fetchTasks();

    const activeSets: TaskStatus[] = ["RUNNING", "QUEUED", "AWAITING_HUMAN_REVIEW"];
    const hasActive = tasks.some((t) => activeSets.includes(t.status));
    const ovInterval = hasActive ? 8_000 : 20_000;
    const tkInterval = hasActive ? 4_000 : 15_000;

    const ov = setInterval(fetchOverview, ovInterval);
    const tk = setInterval(fetchTasks, tkInterval);
    return () => { clearInterval(ov); clearInterval(tk); };
  }, [fetchOverview, fetchTasks, tasks]);

  useEffect(() => {
    const source = new EventSource(`/api/companies/${companyId}/stream`);
    source.onopen = () => setStreamConnected(true);
    source.onerror = () => setStreamConnected(false);
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        const log = JSON.parse(e.data) as LogEvent;
        setLogs((prev) => {
          if (prev.some((x) => x.id === log.id)) return prev;
          const next = [...prev, log];
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
        if (log.kind === "SYSTEM" || log.kind === "MESSAGE") void fetchTasks();
      } catch { /* ignore */ }
    };
    return () => source.close();
  }, [companyId, fetchTasks]);

  const dispatchGoal = useCallback(async () => {
    const text = goal.trim();
    if (text.length < 8 || submitting) return;
    setSubmitting(true);
    setGoalMsg(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/goals`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const { taskIds } = await res.json() as { taskIds: string[] };
      setGoalMsg({ ok: true, text: `Dispatched — CEO planning ${taskIds.length} task(s)` });
      setGoal("");
      setTimeout(() => void fetchTasks(), 2_000);
    } catch (e) {
      setGoalMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setSubmitting(false);
    }
  }, [goal, submitting, companyId, fetchTasks]);

  const activeTasks  = tasks.filter((t) => t.status === "RUNNING" || t.status === "QUEUED");
  const reviewTasks  = tasks.filter((t) => t.status === "AWAITING_HUMAN_REVIEW");
  const doneTasks    = tasks.filter((t) => t.status === "SUCCESS").slice(0, 18);
  const pendingTasks = tasks.filter((t) => t.status === "PENDING").slice(0, 9);
  const hasWork      = activeTasks.length + reviewTasks.length + doneTasks.length + pendingTasks.length > 0;

  if (error === "db-down" && !overview) {
    return <DbDownScreen onRetry={() => { void fetchOverview(); void fetchTasks(); }} />;
  }
  if (!overview) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-400" /></div>;
  }

  const { company, metrics, throughput, agents } = overview;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Review modal */}
      {reviewTaskId && (
        <ReviewModal
          taskId={reviewTaskId}
          onClose={() => setReviewTaskId(null)}
          onResumed={() => { void fetchTasks(); void fetchOverview(); }}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.05] bg-zinc-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-400">NestIQ</span>
          <span className="text-zinc-800">·</span>
          <h1 className="text-sm font-semibold text-zinc-200">{company.name}</h1>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-zinc-600">/{company.slug}</span>
          <div className="ml-auto flex items-center gap-3">
            {metrics.awaitingReview > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300">
                <AlertTriangle className="h-3 w-3" />{metrics.awaitingReview} need review
              </span>
            )}
            <span className={`flex items-center gap-1.5 text-[11px] ${streamConnected ? "text-emerald-400" : "text-zinc-600"}`}>
              <Radio className="h-3 w-3" />{streamConnected ? "Live" : "Offline"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={<CircleDollarSign className="h-4 w-4" />} label="Annual Run Rate"  value={fmtARR(company.arrCents)}     sub="Live company ARR"   accent="text-emerald-400" accentBg="bg-emerald-500/10" />
          <Metric icon={<CheckCircle2 className="h-4 w-4" />}    label="Tasks Completed"  value={metrics.tasksCompleted}       sub={metrics.tasksRunning > 0 ? `${metrics.tasksRunning} running` : "None active"} accent="text-sky-400" accentBg="bg-sky-500/10" />
          <Metric icon={<Bot className="h-4 w-4" />}             label="Active Agents"    value={metrics.activeAgents}         sub={`${agents.length} deployed`} accent="text-violet-400" accentBg="bg-violet-500/10" />
          <Metric icon={<Plug className="h-4 w-4" />}            label="Integrations"     value={metrics.connectedServers}     sub="MCP servers" accent={metrics.awaitingReview > 0 ? "text-amber-400" : "text-orange-400"} accentBg={metrics.awaitingReview > 0 ? "bg-amber-500/10" : "bg-orange-500/10"} />
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {/* Goal dispatch */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />Dispatch a Goal
              </h2>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void dispatchGoal(); } }}
                placeholder="What should your company work on? (Enter to dispatch)"
                rows={2}
                className="w-full resize-none rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition focus:border-emerald-500/40 focus:bg-white/[0.04]"
              />
              {goalMsg && <p className={`mt-2 text-xs ${goalMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{goalMsg.text}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => setGoal(s)}
                    className="rounded-full border border-white/[0.05] bg-white/[0.02] px-3 py-1 text-[11px] text-zinc-500 transition hover:border-emerald-500/30 hover:text-emerald-300">
                    {s.length > 44 ? s.slice(0, 44) + "…" : s}
                  </button>
                ))}
                <button onClick={() => void dispatchGoal()} disabled={goal.trim().length < 8 || submitting}
                  className="ml-auto flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {submitting ? "Planning…" : "Dispatch"}
                </button>
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
                <Activity className="h-3.5 w-3.5 text-emerald-400" />14-Day Throughput
              </h2>
              <ResponsiveContainer width="100%" height={110}>
                <AreaChart data={throughput} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#52525b" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#52525b" }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, fontSize: 11 }} labelStyle={{ color: "#71717a" }} itemStyle={{ color: "#10b981" }} />
                  <Area type="monotone" dataKey="tasks" stroke="#10b981" strokeWidth={1.5} fill="url(#tg)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Agent Command Center */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
              <Bot className="h-3.5 w-3.5 text-emerald-400" />Agent Command Center
            </h2>
            <div className="space-y-2.5">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} runningTask={activeTasks.find((t) => t.agent?.role === agent.role)} />
              ))}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div>
          <div className="flex gap-1 rounded-xl border border-white/[0.05] bg-white/[0.02] p-1 w-fit mb-6">
            {([["board", <ClipboardList key="b" className="h-3.5 w-3.5" />, "Work Board"] as const,
               ["files", <FolderOpen    key="f" className="h-3.5 w-3.5" />, "Deliverables"] as const]).map(([tab, icon, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === tab ? "bg-emerald-500 text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {/* Work Board */}
          {activeTab === "board" && (
            <div className="space-y-6">
              {reviewTasks.length > 0 && (
                <Section title="Needs Your Review" icon={<AlertTriangle className="h-3 w-3" />} count={reviewTasks.length} color="text-amber-400">
                  {reviewTasks.map((t) => <TaskCard key={t.id} task={t} onReview={setReviewTaskId} />)}
                </Section>
              )}
              {activeTasks.length > 0 && (
                <Section title="Active Work" icon={<Zap className="h-3 w-3" />} count={activeTasks.length} color="text-emerald-400">
                  {activeTasks.map((t) => <TaskCard key={t.id} task={t} />)}
                </Section>
              )}
              {pendingTasks.length > 0 && (
                <Section title="Up Next" icon={<Clock className="h-3 w-3" />} count={pendingTasks.length} color="text-zinc-500">
                  {pendingTasks.map((t) => <TaskCard key={t.id} task={t} />)}
                </Section>
              )}
              {doneTasks.length > 0 && (
                <Section title="Completed Work" icon={<CheckCircle2 className="h-3 w-3" />} count={metrics.tasksCompleted} color="text-zinc-500">
                  {doneTasks.map((t) => <TaskCard key={t.id} task={t} />)}
                </Section>
              )}
              {!hasWork && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] py-16 text-center">
                  <Sparkles className="mb-3 h-8 w-8 text-zinc-700" />
                  <p className="text-sm font-medium text-zinc-500">No work yet</p>
                  <p className="mt-1 text-xs text-zinc-600">Dispatch a goal above — the CEO will plan and delegate tasks automatically.</p>
                </div>
              )}
            </div>
          )}

          {/* Deliverables */}
          {activeTab === "files" && <DeliverablesTab companyId={companyId} />}
        </div>

        <ConsoleDrawer logs={logs} connected={streamConnected} />
      </main>
    </div>
  );
}
