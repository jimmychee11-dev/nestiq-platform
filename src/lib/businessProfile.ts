/**
 * Business profile — captured by the onboarding wizard, enriched with a
 * generated lean canvas, and injected into every agent's system prompt.
 */

import { z } from "zod";

export const BUSINESS_STAGES = ["idea", "launched", "scaling"] as const;
export type BusinessStage = (typeof BUSINESS_STAGES)[number];

export const LeanCanvasSchema = z.object({
  problem: z.array(z.string()),
  customerSegments: z.array(z.string()),
  uniqueValueProposition: z.string(),
  solution: z.array(z.string()),
  channels: z.array(z.string()),
  revenueStreams: z.array(z.string()),
  costStructure: z.array(z.string()),
  keyMetrics: z.array(z.string()),
  unfairAdvantage: z.string(),
});
export type LeanCanvas = z.infer<typeof LeanCanvasSchema>;

export const BusinessProfileSchema = z.object({
  idea: z.string(),
  industry: z.string(),
  targetMarket: z.string(),
  stage: z.enum(BUSINESS_STAGES),
  canvas: LeanCanvasSchema.nullable().optional(),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

/** Safe parse from the Company.businessProfile JSONB column. */
export function parseBusinessProfile(raw: unknown): BusinessProfile | null {
  const result = BusinessProfileSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Compact prompt block shared by the CEO planner and every worker agent. */
export function businessContextPrompt(profile: BusinessProfile): string {
  const lines = [
    "## Business context",
    `Idea: ${profile.idea}`,
    `Industry: ${profile.industry}`,
    `Target market: ${profile.targetMarket}`,
    `Stage: ${profile.stage}`,
  ];
  if (profile.canvas) {
    const canvas = profile.canvas;
    lines.push(
      "Lean canvas:",
      `- Problem: ${canvas.problem.join("; ")}`,
      `- Customer segments: ${canvas.customerSegments.join("; ")}`,
      `- Unique value proposition: ${canvas.uniqueValueProposition}`,
      `- Solution: ${canvas.solution.join("; ")}`,
      `- Channels: ${canvas.channels.join("; ")}`,
      `- Revenue streams: ${canvas.revenueStreams.join("; ")}`,
      `- Key metrics: ${canvas.keyMetrics.join("; ")}`,
      `- Unfair advantage: ${canvas.unfairAdvantage}`,
    );
  }
  return lines.join("\n");
}
