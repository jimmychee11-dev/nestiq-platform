"use client";

import { RefreshCw } from "lucide-react";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html>
      <body style={{ background: "#09090b", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", margin: 0, fontFamily: "sans-serif", color: "#a1a1aa" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚡</div>
          <h1 style={{ color: "#f4f4f5", fontWeight: 600, fontSize: 22, margin: "0 0 8px" }}>
            NestIQ unavailable
          </h1>
          <p style={{ fontSize: 14, marginBottom: 24, maxWidth: 320 }}>
            {typeof window !== "undefined" && !window.location.hostname.includes("localhost")
              ? "The database isn't reachable. Check your Supabase project and DATABASE_URL in Vercel, then refresh."
              : <>The database or server isn&apos;t reachable yet. Run{" "}
                  <code style={{ background: "#1c1c1e", padding: "2px 6px", borderRadius: 4, color: "#34d399" }}>
                    start-all.ps1
                  </code>{" "}
                  then refresh.</>}
          </p>
          <button
            onClick={reset}
            style={{ background: "#10b981", color: "#000", border: "none", borderRadius: 12, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <RefreshCw size={16} />
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
