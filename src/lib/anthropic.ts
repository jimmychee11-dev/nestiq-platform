import Anthropic from "@anthropic-ai/sdk";

// Opus 4.8 constraints honored throughout the engine:
//  - adaptive thinking only (no budget_tokens; explicit {type:"disabled"} 400s on Fable 5/Opus 4.8)
//  - no temperature / top_p / top_k
//  - structured output via output_config.format; effort via output_config.effort
export const DEFAULT_AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-4-8";

export const anthropic = new Anthropic();
