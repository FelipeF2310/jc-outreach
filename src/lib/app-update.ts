import { compatibleRelease, releaseSchema, type Release } from "./app-release";
import { prepareOfflineShell, readLocal } from "./local-store";

export async function latestRelease(): Promise<Release> {
  const response = await fetch("/api/app-version", {
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("Update check unavailable.");
  return releaseSchema.parse(await response.json());
}

export async function prepareAppUpdate(target: Release) {
  if (!compatibleRelease(target))
    throw Error(
      "This update needs organizer assistance. Keep your saved work on this device.",
    );
  const before = await readLocal();
  if (!before.assignment || before.records.some((r) => !r.receipt))
    throw Error(
      "Sync all saved work before updating, including records needing organizer review.",
    );
  const latest = await latestRelease();
  if (latest.version !== target.version || !compatibleRelease(latest))
    throw Error("The available update changed. Check again before reloading.");
  // The worker caches all referenced assets before replacing its generic shell.
  // Never clear IndexedDB, receipts or earlier cached chunks to update the app.
  await prepareOfflineShell();
  const cache = await caches.open("jco-shell-v1");
  const shell = await cache.match("/field");
  if (!shell)
    throw Error("The updated offline page is not ready. Retry when connected.");
  const html = new DOMParser().parseFromString(await shell.text(), "text/html");
  if (
    html
      .querySelector('meta[name="jco-app-version"]')
      ?.getAttribute("content") !== target.version
  )
    throw Error(
      "The updated offline page could not be verified. Keep this page open and retry.",
    );
  // Re-read shared storage after network/cache work: another tab may have saved.
  const after = await readLocal();
  if (
    !after.assignment ||
    after.assignment.assignment.id !== before.assignment.assignment.id ||
    after.assignment.sequence !== before.assignment.sequence ||
    after.records.some((r) => !r.receipt)
  )
    throw Error(
      "Stored work changed. Sync all saved work and try the update again.",
    );
}
