"use client";
import { useEffect, useRef, useState } from "react";
import { correctionNames } from "@/lib/contracts";
import {
  correctionQueue,
  correctionReceipt,
  correctionUpdate,
  type CorrectionQueue,
  type CorrectionUpdate,
} from "@/lib/correction-admin-contracts";

const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });

export function CorrectionReviewQueue({
  campaignId,
  administratorId,
  deletionAt,
}: {
  campaignId: string;
  administratorId: string;
  deletionAt: string;
}) {
  const [queue, setQueue] = useState<CorrectionQueue>();
  const [pending, setPending] = useState<CorrectionUpdate>();
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const running = useRef(false);
  const key = `jco-correction-update:${administratorId}:${campaignId}`;
  useEffect(() => {
    if (message) confirmation.current?.focus();
  }, [message, queue]);

  async function run(update?: CorrectionUpdate) {
    if (running.current) return;
    running.current = true;
    const version = ++sequence.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (Date.now() >= Date.parse(deletionAt)) {
        sessionStorage.removeItem(key);
        setPending(undefined);
        setQueue(undefined);
        throw Error(
          "Campaign expired. Resident correction information is no longer available.",
        );
      }
      if (update) {
        if (!storageReady)
          throw Error(
            "Pending-action storage is unavailable. Status changes are disabled.",
          );
        sessionStorage.setItem(key, JSON.stringify(update));
        setPending(update);
      }
      const response = await fetch("/api/admin/corrections", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
        body: JSON.stringify(update ?? { action: "list", campaignId }),
      });
      const body = await response.json();
      if (!mounted.current || version !== sequence.current) return;
      if (Date.now() >= Date.parse(deletionAt)) {
        sessionStorage.removeItem(key);
        setPending(undefined);
        setQueue(undefined);
        throw Error(
          "Campaign expired. Resident correction information is no longer available.",
        );
      }
      if (!response.ok) {
        if (update && [400, 404, 409, 410, 422].includes(response.status)) {
          sessionStorage.removeItem(key);
          setPending(undefined);
          setNeedsRefresh(true);
        }
        if ([401, 403, 404, 410].includes(response.status)) setQueue(undefined);
        throw Error(
          body.error ??
            "Resident correction information could not be confirmed.",
        );
      }
      const next = correctionQueue.parse(body.queue);
      if (next.campaignId !== campaignId)
        throw Error(
          "Correction reports could not be confirmed for this campaign.",
        );
      if (update) {
        const receipt = correctionReceipt.parse(body.receipt);
        if (
          receipt.id !== update.id ||
          receipt.campaignId !== campaignId ||
          receipt.reportId !== update.reportId ||
          receipt.status !== update.status ||
          receipt.version !== update.expectedVersion + 1
        )
          throw Error(
            "The status update could not be confirmed. Retry the pending update.",
          );
        sessionStorage.removeItem(key);
        setPending(undefined);
        setMessage(
          "Status update received. The queue shows the latest saved status.",
        );
      }
      setQueue(next);
      setNeedsRefresh(false);
    } catch (failure) {
      if (mounted.current && version === sequence.current) {
        if (!update) setNeedsRefresh(true);
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to load resident correction requests.",
        );
      }
    } finally {
      if (version === sequence.current) {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = sessionStorage.getItem(key);
      if (Date.now() >= Date.parse(deletionAt)) sessionStorage.removeItem(key);
      else if (saved) {
        const restored = correctionUpdate.parse(JSON.parse(saved));
        if (restored.campaignId !== campaignId) throw Error();
        setPending(restored);
      }
      setStorageReady(true);
    } catch {
      setStorageReady(false);
    }
    void run();
    return () => {
      mounted.current = false;
      sequence.current++;
      running.current = false;
    };
    // Each component is scoped to one administrator/campaign for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const frozen = busy || !!pending || !storageReady || needsRefresh;
  function card(request: CorrectionQueue["reports"][number]) {
    return (
      <article
        className="help-request-card"
        key={request.id}
        aria-label={`Correction report for ${request.address}${request.unit ? ` Unit ${request.unit}` : ""}`}
      >
        <div className="help-request-heading">
          <div>
            <h4>
              {request.address}
              {request.unit ? ` · Unit ${request.unit}` : ""}
            </h4>
            <p>{request.person ?? "Household-level report"}</p>
          </div>
          <span
            className={
              request.status === "Reviewed" ? "received" : "help-status"
            }
          >
            {request.status}
          </span>
        </div>
        {request.suppressed && (
          <p className="error">
            Campaign do-not-contact request recorded. Do not initiate further
            outreach to this household.
          </p>
        )}
        <p>
          <strong>Reported:</strong> {correctionNames[request.kind]}
        </p>
        <details>
          <summary>Source visit &amp; update details</summary>
          <p className="fine">
            Assignment: {request.assignmentName}
            <br />
            Visit received: {date(request.receivedAt)}
            <br />
            Visit ID: <span className="help-visit-id">{request.visitId}</span>
            {request.updatedAt && (
              <>
                <br />
                Status updated: {date(request.updatedAt)}
              </>
            )}
          </p>
        </details>
        <button
          disabled={frozen}
          onClick={() =>
            void run({
              action: "update",
              id: crypto.randomUUID(),
              campaignId,
              reportId: request.id,
              expectedVersion: request.version,
              status: request.status === "Open" ? "Reviewed" : "Open",
            })
          }
        >
          {request.status === "Open" ? "Mark reviewed" : "Keep open"}
        </button>
      </article>
    );
  }
  const active = queue?.reports.filter((r) => r.status !== "Reviewed") ?? [];
  const reviewed = queue?.reports.filter((r) => r.status === "Reviewed") ?? [];
  return (
    <section
      className="follow-up-notice help-request-queue"
      aria-label="Resident correction reports"
    >
      <div className="help-request-heading">
        <div>
          <h3>Resident corrections</h3>
          <p className="fine">
            Resident-reported information across this campaign. Marking reviewed
            does not verify the report or change imported records.
          </p>
        </div>
        <button disabled={busy} onClick={() => void run()}>
          {busy
            ? "Loading correction reports…"
            : error || needsRefresh
              ? "Retry correction reports"
              : "Refresh correction reports"}
        </button>
      </div>
      {!storageReady && (
        <p className="fine">
          Pending-action storage is unavailable. Status changes are disabled.
        </p>
      )}
      {busy && <p role="status">Checking saved correction reports…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
          {queue && " Previously loaded reports may be out of date."}
        </p>
      )}
      {pending && (
        <p role="status">
          A status update is awaiting confirmation.{" "}
          <button
            disabled={busy || !storageReady}
            onClick={() => void run(pending)}
          >
            Retry pending status update
          </button>
        </p>
      )}
      {message && (
        <p role="status" tabIndex={-1} ref={confirmation}>
          {message}
        </p>
      )}
      {queue && !queue.ready && (
        <p className="fine">
          Resident correction review needs its database update. Existing visits
          and reports are unchanged.
        </p>
      )}
      {queue?.ready && (
        <>
          <p className="fine">
            {active.length} open · {reviewed.length} reviewed
          </p>
          {active.length === 0 ? (
            <p>
              {reviewed.length
                ? "No open correction reports."
                : "No correction reports received yet. After a volunteer synchronizes a report, refresh this queue."}
            </p>
          ) : (
            active.map(card)
          )}
          {reviewed.length > 0 && (
            <details>
              <summary>Reviewed reports ({reviewed.length})</summary>
              {reviewed.map(card)}
            </details>
          )}
          <p className="fine">
            Reports follow the campaign deletion date: {date(deletionAt)}. An
            open report does not extend retention.
          </p>
        </>
      )}
    </section>
  );
}
