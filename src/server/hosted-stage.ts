export type HostedStage = "synthetic-preview" | "outreach-live";

/** Explicit reviewed modes only; neither truthiness nor arbitrary env values. */
export function isHostedStage(value: unknown): value is HostedStage {
  return value === "synthetic-preview" || value === "outreach-live";
}
