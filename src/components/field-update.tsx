"use client";
import { useEffect, useRef, useState } from "react";
import {
  APP_RELEASE,
  compatibleRelease,
  type Release,
} from "@/lib/app-release";
import { latestRelease, prepareAppUpdate } from "@/lib/app-update";

export function FieldUpdate({
  busy,
  formOpen,
  pending,
  online,
  checkSignal,
  onUpdating,
}: {
  busy: boolean;
  formOpen: boolean;
  pending: number;
  online: boolean;
  checkSignal: number;
  onUpdating: (value: boolean) => void;
}) {
  const [release, setRelease] = useState<Release>();
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    let checking = false;
    async function check() {
      if (
        checking ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      )
        return;
      checking = true;
      try {
        const next = await latestRelease();
        if (active) setRelease(next.version === APP_RELEASE ? undefined : next);
      } catch {
        /* Offline/server failure must not interrupt field work or dismiss a known update. */
      } finally {
        checking = false;
      }
    }
    void check();
    const interval = window.setInterval(check, 60000);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [checkSignal]);
  if (!release) return null;
  const reason = !compatibleRelease(release)
    ? "This update needs organizer assistance. Keep your saved work on this device."
    : formOpen
      ? "Finish saving your visit or close the form before updating."
      : pending
        ? "Sync all saved work before updating. Records needing organizer review also block reload."
        : !online
          ? "Reconnect before updating. Your saved work remains on this device."
          : "All saved work has been received. Reload when you are ready; your assignment and visit history will remain.";
  return (
    <section className="notice field-update" aria-label="App update">
      <p role="status">
        <strong>App update available</strong>
      </p>
      <p>{reason}</p>
      <button
        disabled={
          busy ||
          updating ||
          formOpen ||
          pending > 0 ||
          !online ||
          !compatibleRelease(release)
        }
        onClick={async () => {
          if (inFlight.current || busy || formOpen || pending || !online)
            return;
          inFlight.current = true;
          setUpdating(true);
          onUpdating(true);
          setError("");
          try {
            await prepareAppUpdate(release);
            window.location.reload();
          } catch {
            setError(
              "Update could not be completed safely. Sync all saved work, then retry when connected. Do not clear browser storage.",
            );
            inFlight.current = false;
            setUpdating(false);
            onUpdating(false);
          }
        }}
      >
        {updating ? "Preparing update…" : "Reload to update"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
