"use client";
import { useEffect, useState } from "react";
import type { ImportReceipt } from "@/lib/import-contracts";

export type HostedCampaign = {
  id: string;
  name: string;
  endAt: string | null;
  deletionAt: string;
  importReceipt?: ImportReceipt | null;
  importReady?: boolean;
  assignmentsReady?: boolean;
  fieldReady?: boolean;
  dataKind?: "synthetic" | "live";
};
type Save = { id: string; name: string; endDate: string };

export function CampaignCreate({
  administratorId,
  onCreated,
  initiallyOpen = false,
  live = false,
}: {
  administratorId: string;
  onCreated: (campaign: HostedCampaign) => void;
  initiallyOpen?: boolean;
  live?: boolean;
}) {
  const [name, setName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pending, setPending] = useState<Save>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(initiallyOpen);
  const storageKey = `jco-campaign-save:${administratorId}`;
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const value: Save = JSON.parse(stored);
        if (
          !value ||
          typeof value.id !== "string" ||
          typeof value.name !== "string" ||
          typeof value.endDate !== "string"
        )
          throw new Error();
        setPending(value);
        setOpen(true);
        setName(value.name);
        setEndDate(value.endDate);
      }
      setReady(true);
    } catch {
      setError(
        "Pending-save storage is unavailable. Use your normal browser; do not clear a pending request to retry.",
      );
    }
  }, [storageKey]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const operation = pending ?? {
        id: crypto.randomUUID(),
        name: name.trim(),
        endDate,
      };
      // Keep the same request across lost acknowledgments and tab reloads.
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
      setPending(operation);
      const response = await fetch("/api/admin/campaigns", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 400) {
          sessionStorage.removeItem(storageKey);
          setPending(undefined);
        }
        throw new Error(
          body.error ??
            "Campaign save could not be confirmed. Retry the same save.",
        );
      }
      if (body.campaign?.id !== operation.id)
        throw new Error(
          "Campaign save could not be confirmed. Retry the same save.",
        );
      sessionStorage.removeItem(storageKey);
      setPending(undefined);
      setName("");
      setEndDate("");
      setOpen(false);
      onCreated(body.campaign);
      setMessage("Campaign saved. No households have been imported.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Save could not be confirmed. Retry the same save.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="campaign-create"
      aria-label={live ? "Create campaign" : "Create synthetic campaign"}
    >
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Create a campaign</summary>
        <h2>{live ? "Create campaign" : "Create synthetic campaign"}</h2>
        <p className="fine">
          {live
            ? "Name the outreach effort and choose its end date. This creates an empty campaign; it does not import households."
            : "Use a practice label only—no resident names or addresses. This does not import households."}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="import-label">
            Campaign name
            <input
              required
              maxLength={100}
              value={name}
              disabled={!ready || busy || !!pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="import-label">
            Campaign end date
            <input
              type="date"
              required
              value={endDate}
              disabled={!ready || busy || !!pending}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <p className="fine">
            Ends at 11:59:59 PM on this date in America/New_York. The database
            schedules deletion 30 calendar days later. Check the retention
            status panel to confirm the deletion worker is running.
          </p>
          {pending && (
            <p role="status">
              A save is awaiting confirmation. Retry this same request to avoid
              duplicates, even after reloading this tab.
            </p>
          )}
          <div className="import-assignment-actions">
            <button className="primary" disabled={!ready || busy} type="submit">
              {busy
                ? "Saving…"
                : pending
                  ? "Retry campaign save"
                  : "Create campaign"}
            </button>
          </div>
        </form>
      </details>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
