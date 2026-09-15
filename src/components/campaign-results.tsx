"use client";
import { useEffect, useState } from "react";
import type { FieldSnapshot } from "@/lib/field-admin-contracts";
import type { AssignmentWorkspace } from "@/lib/assignment-admin-contracts";
import { outcomes } from "@/lib/contracts";
import { HelpRequestQueue } from "./help-request-queue";
import { CorrectionReviewQueue } from "./correction-review-queue";

export function CampaignResults({
  campaignId,
  assignments,
  ready,
  selected,
  onSelect,
  administratorId,
  deletionAt,
}: {
  campaignId: string;
  assignments: AssignmentWorkspace["assignments"];
  ready: boolean;
  selected: string;
  onSelect: (id: string) => void;
  administratorId: string;
  deletionAt: string;
}) {
  const assignment =
    assignments.find((a) => a.id === selected) ?? assignments[0];
  return (
    <section
      id={`results-${campaignId}`}
      className="panel workspace-section"
      aria-label="Results and follow-up"
    >
      <p className="eyebrow">REVIEW</p>
      <h2>Results &amp; follow-up</h2>
      <p className="fine">
        Received activity for one assignment at a time. Work still on an offline
        phone is not visible here.
      </p>
      {!assignment ? (
        <p>
          No assignments yet. Create an assignment above to start collecting
          results.
        </p>
      ) : !ready ? (
        <p>
          Received results need the field database update. Your assignments are
          saved.
        </p>
      ) : (
        <>
          <label className="import-label">
            Results for assignment
            <select
              aria-label="Results for assignment"
              value={assignment.id}
              onChange={(e) => onSelect(e.target.value)}
            >
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <AssignmentResults key={assignment.id} assignmentId={assignment.id} />
        </>
      )}
      {ready && (
        <HelpRequestQueue
          key={`${administratorId}:${campaignId}`}
          campaignId={campaignId}
          administratorId={administratorId}
          deletionAt={deletionAt}
        />
      )}
      {ready && (
        <CorrectionReviewQueue
          key={`corrections:${administratorId}:${campaignId}`}
          campaignId={campaignId}
          administratorId={administratorId}
          deletionAt={deletionAt}
        />
      )}
    </section>
  );
}

function AssignmentResults({ assignmentId }: { assignmentId: string }) {
  const [snapshot, setSnapshot] = useState<FieldSnapshot>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setBusy(true);
    setError("");
    void fetch("/api/admin/field", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", assignmentId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw Error(body.error ?? "Unable to load received results.");
        if (body.snapshot?.assignmentId !== assignmentId)
          throw Error("Results could not be confirmed for this assignment.");
        if (active) setSnapshot(body.snapshot);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to load received results.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [assignmentId, refresh]);
  return (
    <div className="assignment-results">
      <button disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
        {busy
          ? "Loading results…"
          : error
            ? "Retry results"
            : "Refresh results"}
      </button>
      {busy && <p role="status">Loading received activity…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
          {snapshot &&
            " Previously received results remain below; they may be out of date."}
        </p>
      )}
      {snapshot && (
        <>
          <div
            className="stats result-stats"
            aria-label="Received assignment totals"
          >
            <div className="stat">
              <span>Households attempted</span>
              <strong>{snapshot.counts.attempts}</strong>
            </div>
            <div className="stat">
              <span>Conversations</span>
              <strong>{snapshot.counts.conversations}</strong>
            </div>
            <div className="stat">
              <span>Application-help requests</span>
              <strong>{snapshot.helpRequests}</strong>
            </div>
          </div>
          <p className="fine">
            {snapshot.counts.repeats} repeat visits ·{" "}
            {snapshot.buildingFailures} building-access failures
          </p>
          <p className="fine">
            Latest received activity:{" "}
            {snapshot.latestReceivedAt
              ? new Date(snapshot.latestReceivedAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  timeZoneName: "short",
                })
              : "None yet"}
          </p>
          {snapshot.visits.length === 0 ? (
            <div className="empty">
              <h3>No visits received yet</h3>
              <p>
                After a volunteer records a visit and synchronizes, refresh
                these results.
              </p>
            </div>
          ) : (
            <details className="visit-details">
              <summary>View received visits ({snapshot.visits.length})</summary>
              {snapshot.visits.map((v) => (
                <div className="result-row" key={v.id}>
                  <div>
                    <strong>
                      {v.address}
                      {v.unit ? ` · Unit ${v.unit}` : ""}
                    </strong>
                    <small>{outcomes[v.result]}</small>
                    {v.superseded && (
                      <small>Reassigned door · original visit retained</small>
                    )}
                  </div>
                  <span className="received">Received</span>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
