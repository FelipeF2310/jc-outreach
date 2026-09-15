"use client";
import { useEffect, useRef, useState } from "react";
import {
  helpQueue,
  helpReceipt,
  helpUpdate,
  type HelpQueue,
  type HelpUpdate,
} from "@/lib/help-admin-contracts";

const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
const arrangements: Record<string, string> = {
  return: "Return visit requested",
  referral: "Resident will contact referral",
  unspecified: "No follow-up arrangement recorded",
};

export function HelpRequestQueue({
  campaignId,
  administratorId,
  deletionAt,
}: {
  campaignId: string;
  administratorId: string;
  deletionAt: string;
}) {
  const [queue, setQueue] = useState<HelpQueue>();
  const [pending, setPending] = useState<HelpUpdate>();
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const running = useRef(false);
  const key = `jco-help-update:${administratorId}:${campaignId}`;
  useEffect(() => {
    if (message) confirmation.current?.focus();
  }, [message, queue]);

  async function run(update?: HelpUpdate) {
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
          "Campaign expired. Application-help information is no longer available.",
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
      const response = await fetch("/api/admin/help", {
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
          "Campaign expired. Application-help information is no longer available.",
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
          body.error ?? "Application-help information could not be confirmed.",
        );
      }
      const next = helpQueue.parse(body.queue);
      if (next.campaignId !== campaignId)
        throw Error("Help requests could not be confirmed for this campaign.");
      if (update) {
        const receipt = helpReceipt.parse(body.receipt);
        if (
          receipt.id !== update.id ||
          receipt.campaignId !== campaignId ||
          receipt.requestId !== update.requestId ||
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
            : "Unable to load application-help requests.",
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
        const restored = helpUpdate.parse(JSON.parse(saved));
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
  function card(request: HelpQueue["requests"][number]) {
    return (
      <article
        className="help-request-card"
        key={request.id}
        aria-label={`Help request for ${request.address}${request.unit ? ` Unit ${request.unit}` : ""}`}
      >
        <div className="help-request-heading">
          <div>
            <h4>
              {request.address}
              {request.unit ? ` · Unit ${request.unit}` : ""}
            </h4>
            <p>{request.requester ?? "Requesting resident not specified"}</p>
          </div>
          <span
            className={
              request.status === "Resolved" ? "received" : "help-status"
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
        <p className="fine">
          {request.phone && request.consent ? (
            <>
              <strong>Phone:</strong> {request.phone}
              <br />
              Permission recorded for application-help follow-up.
            </>
          ) : (
            <>No phone number provided for follow-up.</>
          )}
        </p>
        <p className="fine">
          {arrangements[request.arrangement] ??
            "No follow-up arrangement recorded"}
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
        {request.status !== "Resolved" && (
          <button
            disabled={frozen}
            onClick={() =>
              void run({
                action: "update",
                id: crypto.randomUUID(),
                campaignId,
                requestId: request.id,
                expectedVersion: request.version,
                status: request.status === "New" ? "In progress" : "Resolved",
              })
            }
          >
            {request.status === "New" ? "Mark in progress" : "Mark resolved"}
          </button>
        )}
      </article>
    );
  }
  const active = queue?.requests.filter((r) => r.status !== "Resolved") ?? [];
  const resolved = queue?.requests.filter((r) => r.status === "Resolved") ?? [];
  return (
    <section
      className="follow-up-notice help-request-queue"
      aria-label="Application-help requests"
    >
      <div className="help-request-heading">
        <div>
          <h3>Application help</h3>
          <p className="fine">
            Received requests across this campaign. No phone number is required.
          </p>
        </div>
        <button disabled={busy} onClick={() => void run()}>
          {busy
            ? "Loading help requests…"
            : error || needsRefresh
              ? "Retry help requests"
              : "Refresh help requests"}
        </button>
      </div>
      {!storageReady && (
        <p className="fine">
          Pending-action storage is unavailable. Status changes are disabled.
        </p>
      )}
      {busy && <p role="status">Checking saved help requests…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
          {queue && " Previously loaded requests may be out of date."}
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
          Application-help review needs its database update. Existing visits and
          requests are unchanged.
        </p>
      )}
      {queue?.ready && (
        <>
          <p className="fine">
            {active.length} open · {resolved.length} resolved
          </p>
          {active.length === 0 ? (
            <p>
              {resolved.length
                ? "No open help requests."
                : "No application-help requests received yet. After a volunteer synchronizes a request, refresh this queue."}
            </p>
          ) : (
            active.map(card)
          )}
          {resolved.length > 0 && (
            <details>
              <summary>Resolved requests ({resolved.length})</summary>
              {resolved.map(card)}
            </details>
          )}
          <p className="fine">
            Requests follow the campaign deletion date: {date(deletionAt)}. An
            open request does not extend retention.
          </p>
        </>
      )}
    </section>
  );
}
