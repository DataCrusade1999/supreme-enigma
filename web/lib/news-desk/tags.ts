// Kept out of types.ts, which builds zod schemas at module scope: the page
// imports TOPICS, and importing it from there would put zod in the client bundle.

// The topics shown as tabs. The model may also answer Drop for an off-topic item;
// Untagged means not yet tagged, or the tagging call failed. See spec §5.3.
export const TOPICS = ["Economy", "Reforms", "Legislation"] as const;
export type Topic = (typeof TOPICS)[number];
export const MODEL_TAGS = [...TOPICS, "Drop"] as const;
export type ModelTag = (typeof MODEL_TAGS)[number];
export const STORED_TAGS = [...MODEL_TAGS, "Untagged"] as const;
export type StoredTag = (typeof STORED_TAGS)[number];
