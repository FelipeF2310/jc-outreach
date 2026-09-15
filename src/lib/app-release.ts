import { z } from "zod";

export const APP_RELEASE = process.env.NEXT_PUBLIC_JCO_RELEASE!;
export const releaseSchema = z.strictObject({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  storageVersion: z.number().int().positive(),
  operationVersion: z.number().int().positive(),
});
export type Release = z.infer<typeof releaseSchema>;
export const currentRelease: Release = {
  version: APP_RELEASE,
  storageVersion: 1,
  operationVersion: 1,
};
export function compatibleRelease(release: Release) {
  return release.storageVersion === 1 && release.operationVersion === 1;
}
