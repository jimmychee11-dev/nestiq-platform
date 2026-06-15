/**
 * Lean-canvas generation — one structured-output model call that turns the
 * onboarding answers into a business model canvas. Runs synchronously
 * during setup so the wizard can show the result before the dashboard.
 */

import { anthropic, DEFAULT_AGENT_MODEL } from "@/src/lib/anthropic";
import {
  LeanCanvasSchema,
  type BusinessProfile,
  type LeanCanvas,
} from "@/src/lib/businessProfile";

const CANVAS_JSON_SCHEMA = {
  type: "object",
  properties: {
    problem: { type: "array", items: { type: "string" }, description: "Top 1-3 problems the business solves." },
    customerSegments: { type: "array", items: { type: "string" } },
    uniqueValueProposition: { type: "string", description: "Single clear sentence." },
    solution: { type: "array", items: { type: "string" }, description: "Top 3 solution features." },
    channels: { type: "array", items: { type: "string" }, description: "Paths to customers." },
    revenueStreams: { type: "array", items: { type: "string" } },
    costStructure: { type: "array", items: { type: "string" } },
    keyMetrics: { type: "array", items: { type: "string" }, description: "Activities to measure." },
    unfairAdvantage: { type: "string", description: "What can't easily be copied or bought." },
  },
  required: [
    "problem",
    "customerSegments",
    "uniqueValueProposition",
    "solution",
    "channels",
    "revenueStreams",
    "costStructure",
    "keyMetrics",
    "unfairAdvantage",
  ],
  additionalProperties: false,
} as const;

export async function generateLeanCanvas(
  profile: Pick<BusinessProfile, "idea" | "industry" | "targetMarket" | "stage">,
): Promise<LeanCanvas> {
  const response = await anthropic.messages.create({
    model: DEFAULT_AGENT_MODEL,
    max_tokens: 8_000,
    thinking: { type: "adaptive" },
    system:
      "You are a startup strategy analyst. Produce a sharp, specific lean canvas for the business " +
      "described by the user. Be concrete — name real channels, real customer segments, and " +
      "plausible revenue models for this exact business, not generic startup advice.",
    output_config: {
      format: { type: "json_schema", schema: CANVAS_JSON_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          `Business idea: ${profile.idea}`,
          `Industry: ${profile.industry}`,
          `Target market: ${profile.targetMarket}`,
          `Stage: ${profile.stage}`,
        ].join("\n"),
      },
    ],
  });

  const text = response.content.find(
    (block): block is Extract<typeof block, { type: "text" }> => block.type === "text",
  )?.text;
  if (!text) throw new Error("Canvas generation returned no text content");
  return LeanCanvasSchema.parse(JSON.parse(text));
}
