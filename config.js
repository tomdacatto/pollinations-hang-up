// What a visitor's key may spend and for how long. Pollen is per visitor.
// Three cheap models, every pair, told and not told, at 12 turns cost a few hundredths of a Pollen.
export const BUDGET = 0.5;
export const EXPIRY_DAYS = 1;

// How many calls run at the same time.
export const CONCURRENCY = 6;

// Models ticked at the start, when the live list has them.
export const DEFAULT_MODELS = ["openai/gpt-5.4-nano", "deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash"];

export const TURN_LIMITS = [8, 12, 16];
export const DEFAULT_LIMIT = 12;
