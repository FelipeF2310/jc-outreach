import type { CompletionSnapshot } from "@/lib/completion-contracts";

export function CompletionSummary({
  snapshot,
}: {
  snapshot?: CompletionSnapshot;
}) {
  if (!snapshot) return null;
  return (
    <section
      aria-label="Received walk completion"
      className="completion-summary"
    >
      <h3>Walk completion</h3>
      <p className="fine">
        Last received status per browser, not a live view of every phone. New
        offline work is unknown until it synchronizes.
      </p>
      {!snapshot.devices.length && <p>No walk status received yet.</p>}
      {snapshot.devices.map((device, index) => {
        const finished =
          device.state === "finished" &&
          !device.missingCount &&
          !device.additionalActivity;
        return (
          <div className="result-row" key={device.deviceId}>
            <div>
              <strong>
                {device.label ?? "Volunteer link"} · Browser {index + 1}
              </strong>
              <small>
                {finished
                  ? "Finished and synchronized"
                  : device.additionalActivity
                    ? "New activity — updated walk status needed"
                    : device.state === "finished"
                      ? "Field work finished — records still missing"
                      : "In progress"}
              </small>
              <small>
                {device.declaredCount} declared records · {device.missingCount}{" "}
                not yet received
              </small>
              <small>
                Device reported {device.pendingReportedCount} pending at last
                contact:{" "}
                {new Date(device.receivedAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  timeZoneName: "short",
                })}
              </small>
            </div>
            {finished && <span className="received">Received</span>}
          </div>
        );
      })}
    </section>
  );
}
