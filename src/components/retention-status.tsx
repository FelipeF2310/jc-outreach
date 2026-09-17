"use client";
import { useEffect, useState } from "react";
import {
  retentionResponse,
  type RetentionStatus,
} from "@/lib/retention-contracts";

export function CampaignRetention({
  campaignId,
}: {
  campaignId: string | null;
}) {
  const [data, setData] = useState<RetentionStatus>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError(false);
    setData(undefined);
    void fetch("/api/admin/retention", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-JCO-Admin": "1" },
      body: JSON.stringify({ campaignId }),
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Status unavailable");
        const body = await response.json();
        const status = retentionResponse.parse(body.retention);
        if (!controller.signal.aborted) setData(status);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [campaignId, refresh]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") setRefresh((v) => v + 1);
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const date = (value: string) =>
    new Date(value).toLocaleString("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  const attention =
    data?.ready &&
    (data.failedCampaigns > 0 ||
      data.overdueCampaigns > 0 ||
      data.health === "stale");
  const selected =
    data?.ready && data.selected?.campaignId === campaignId
      ? data.selected
      : null;
  return (
    <section className="retention-status" aria-label="Campaign data retention">
      <div className="workspace-toolbar">
        <strong>Data retention</strong>
        <button disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
          {busy ? "Checking deletion status…" : "Refresh deletion status"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          Deletion status could not be checked. Do not assume cleanup has run.
          Retry or contact the website owner.
        </p>
      )}
      {data && !data.ready && (
        <p className="fine retention-warning">
          Automatic deletion is not connected yet. Its database update and
          scheduler setup are still required. Synthetic testing only.
        </p>
      )}
      {data?.ready && (
        <>
          <p
            role={attention ? "alert" : "status"}
            className={attention ? "error" : "fine"}
          >
            {data.failedCampaigns > 0
              ? "Campaign deletion failed — administrator action required."
              : data.overdueCampaigns > 0
                ? "Expired campaign cleanup is pending. Access is blocked; deletion is not yet confirmed."
                : data.health === "stale"
                  ? "Deletion checks are overdue — contact the website owner."
                  : data.health === "not_started"
                    ? "Deletion worker is installed; no completed check yet. The website owner must verify the schedule."
                    : "Deletion worker checked recently. No overdue campaign data was found."}
          </p>
          {data.checkedAt && (
            <p className="fine">Last completed check: {date(data.checkedAt)}</p>
          )}
          {attention && (
            <p className="fine">
              {data.overdueCampaigns} expired campaigns awaiting cleanup ·{" "}
              {data.failedCampaigns} failed attempts awaiting retry. The
              scheduled worker retries; the website owner must investigate
              persistent failures.
            </p>
          )}
          {data.oldestDeadline && (
            <p className="fine">
              Oldest pending deadline: {date(data.oldestDeadline)}
            </p>
          )}
          {selected && selected.openHelpRequests > 0 && (
            <p className="retention-warning">
              {selected.openHelpRequests} unresolved application-help requests
              remain. Identifying campaign data is still scheduled for deletion
              on {date(selected.deletionAt)}. Resolve or arrange an approved
              handoff before then; open requests do not extend retention.
            </p>
          )}
          <details>
            <summary>What deletion covers</summary>
            <p className="fine">
              Access ends at the deadline. The scheduled worker checks every
              minute and removes expired campaign records, including open help
              requests, visits and private links. Failed or delayed checks can
              postpone cleanup, not extend access.
            </p>
            <p className="fine">
              This status covers the live application database, not backups,
              administrator exports or disconnected phones. Those copies need
              their separate retention safeguards. Synthetic testing only.
            </p>
            <p className="fine">
              Campaigns removed by this worker: {data.deletedCampaigns}. No
              resident or volunteer history is retained in this total.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
