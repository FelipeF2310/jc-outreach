"use client";
import { useEffect, useState } from "react";
import {
  assignmentAdminRequest,
  type AssignmentSave,
  type AssignmentWorkspace,
} from "@/lib/assignment-admin-contracts";

export function CampaignAssignments({
  campaignId,
  administratorId,
  deletionAt,
  ready,
}: {
  campaignId: string;
  administratorId: string;
  deletionAt: string;
  ready: boolean;
}) {
  const [workspace, setWorkspace] = useState<AssignmentWorkspace>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<AssignmentSave>();
  const [storageReady, setStorageReady] = useState(false);
  const [eventName, setEventName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [eventId, setEventId] = useState("");
  const [assignmentName, setAssignmentName] = useState("");
  const [kind, setKind] = useState<"building" | "scattered">("building");
  const [buildingId, setBuildingId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const storageKey = `jco-assignment-save:${administratorId}:${campaignId}`;
  const frozen = busy || !!pending || !storageReady;
  function install(data: AssignmentWorkspace) {
    setWorkspace(data);
    setEventId((value) => value || data.events[0]?.id || "");
    setBuildingId((value) => value || data.households[0]?.buildingId || "");
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    try {
      if (Date.now() >= Date.parse(deletionAt)) {
        sessionStorage.removeItem(storageKey);
        setError("Campaign expired.");
        return;
      }
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = assignmentAdminRequest.safeParse(JSON.parse(stored));
        if (
          !parsed.success ||
          parsed.data.action === "workspace" ||
          parsed.data.campaignId !== campaignId
        )
          throw new Error(
            "Pending save cannot be read. Contact the organizer; do not clear it to retry.",
          );
        setPending(parsed.data);
        setOpen(true);
      }
      setStorageReady(true);
    } catch {
      setError(
        "Pending-save storage is unavailable. Do not clear browser data to retry.",
      );
    }
    if (!ready) return;
    setBusy(true);
    void fetch("/api/admin/assignments", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "workspace", campaignId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to load assignments.");
        if (body.workspace?.campaignId !== campaignId)
          throw new Error("Assignment workspace could not be confirmed.");
        if (active) {
          install(body.workspace);
          setLoaded(true);
        }
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to load assignments.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [campaignId, storageKey, deletionAt, ready]);
  async function run(
    request: AssignmentSave | { action: "workspace"; campaignId: string },
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (Date.now() >= Date.parse(deletionAt)) {
        sessionStorage.removeItem(storageKey);
        setPending(undefined);
        setWorkspace(undefined);
        throw new Error("Campaign expired.");
      }
      if (request.action !== "workspace") {
        sessionStorage.setItem(storageKey, JSON.stringify(request));
        setPending(request);
      }
      const response = await fetch("/api/admin/assignments", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok) {
        if (
          request.action !== "workspace" &&
          [400, 404, 409, 410].includes(response.status)
        ) {
          sessionStorage.removeItem(storageKey);
          setPending(undefined);
        }
        throw new Error(
          body.error ??
            "Save could not be confirmed. Retry the pending request.",
        );
      }
      if (
        body.workspace?.campaignId !== campaignId ||
        (request.action !== "workspace" && body.savedId !== request.id)
      )
        throw new Error(
          "Save receipt could not be confirmed. Retry the pending request.",
        );
      install(body.workspace);
      setLoaded(true);
      if (request.action !== "workspace") {
        sessionStorage.removeItem(storageKey);
        setPending(undefined);
        if (request.action === "event") {
          setEventId(request.id);
          setEventName("");
          setEndDate("");
          setPicked([]);
          setMessage("Event saved. Choose its households below.");
        } else {
          setAssignmentName("");
          setPicked([]);
          setMessage(
            "Assignment saved. Private volunteer links are not connected yet.",
          );
        }
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to complete this step.",
      );
    } finally {
      setBusy(false);
    }
  }
  const assigned = new Set(
    workspace?.assignments
      .filter((a) => a.eventId === eventId)
      .flatMap((a) => a.householdIds),
  );
  const buildings = Array.from(
    new Map(
      workspace?.households.map((h) => [h.buildingId, h.address]),
    ).entries(),
  );
  const doors =
    workspace?.households.filter(
      (h) => kind === "scattered" || h.buildingId === buildingId,
    ) ?? [];
  const ordered =
    kind === "building"
      ? doors.filter((h) => picked.includes(h.id)).map((h) => h.id)
      : picked;
  function move(index: number, delta: number) {
    setPicked((values) => {
      const copy = [...values];
      [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
      return copy;
    });
  }
  return (
    <section
      className="campaign-assignments"
      aria-label="Event and assignment preparation"
    >
      <h3>Events and assignments</h3>
      {!ready ? (
        <p className="fine">
          Assignment preparation needs the next database update. Your imported
          households are saved.
        </p>
      ) : (
        <>
          {workspace && (
            <>
              <p>
                {workspace.events.length} events ·{" "}
                {workspace.assignments.length} saved assignments
              </p>
              {workspace.assignments.map((a) => (
                <p key={a.id}>
                  <strong>{a.name}</strong> · {a.householdIds.length} doors ·{" "}
                  {a.kind === "building" ? "Building run" : "Ordered list"}
                </p>
              ))}
            </>
          )}
          <div className="import-assignment-actions">
            <button disabled={busy} onClick={() => setOpen((value) => !value)}>
              {open ? "Hide assignment builder" : "Manage assignments"}
            </button>
            <button
              disabled={busy}
              onClick={() => void run({ action: "workspace", campaignId })}
            >
              Refresh assignments
            </button>
          </div>
          {busy && !loaded && (
            <p role="status">Loading saved events and households…</p>
          )}
          {pending && (
            <p role="status">
              A save is awaiting confirmation.{" "}
              <button disabled={busy} onClick={() => void run(pending)}>
                Retry pending save
              </button>
            </p>
          )}
          {open && workspace && (
            <>
              <p className="fine">
                Synthetic preparation only. Use practice event and volunteer
                labels. No private volunteer links are issued in this step.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run({
                    action: "event",
                    campaignId,
                    id: crypto.randomUUID(),
                    name: eventName,
                    endDate,
                  });
                }}
              >
                <h4>Create an event</h4>
                <label className="import-label">
                  Event name
                  <input
                    value={eventName}
                    maxLength={100}
                    required
                    disabled={frozen}
                    onChange={(event) => setEventName(event.target.value)}
                  />
                </label>
                <label className="import-label">
                  Event end date
                  <input
                    type="date"
                    value={endDate}
                    required
                    disabled={frozen}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
                <p className="fine">
                  Ends at 5:00 PM New York time on this date, no later than the
                  campaign. Custom end times will be added separately.
                </p>
                <button disabled={frozen} type="submit">
                  Create event
                </button>
              </form>
              {workspace.events.length > 0 && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run({
                      action: "assignment",
                      campaignId,
                      eventId,
                      id: crypto.randomUUID(),
                      name: assignmentName,
                      kind,
                      householdIds: ordered,
                    });
                  }}
                >
                  <h4>Choose doors for a volunteer</h4>
                  <label className="import-label">
                    Field event
                    <select
                      value={eventId}
                      disabled={frozen}
                      onChange={(event) => {
                        setEventId(event.target.value);
                        setPicked([]);
                      }}
                    >
                      {workspace.events.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ·{" "}
                          {new Date(e.endsAt).toLocaleString("en-US", {
                            timeZone: "America/New_York",
                          })}{" "}
                          ET
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="import-label">
                    Assignment / volunteer label
                    <input
                      value={assignmentName}
                      maxLength={100}
                      required
                      disabled={frozen}
                      onChange={(event) =>
                        setAssignmentName(event.target.value)
                      }
                    />
                  </label>
                  <label className="import-label">
                    Assignment type
                    <select
                      value={kind}
                      disabled={frozen}
                      onChange={(event) => {
                        setKind(event.target.value as "building" | "scattered");
                        setPicked([]);
                      }}
                    >
                      <option value="building">Building run</option>
                      <option value="scattered">
                        Scattered doors — ordered list
                      </option>
                    </select>
                  </label>
                  {kind === "building" && (
                    <label className="import-label">
                      Building
                      <select
                        value={buildingId}
                        disabled={frozen}
                        onChange={(event) => {
                          setBuildingId(event.target.value);
                          setPicked([]);
                        }}
                      >
                        {buildings.map(([id, address]) => (
                          <option key={id} value={id}>
                            {address}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {doors.map((h) => (
                    <label key={h.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={picked.includes(h.id)}
                        disabled={frozen || assigned.has(h.id) || h.suppressed}
                        onChange={(event) =>
                          setPicked((values) =>
                            event.target.checked
                              ? [...values, h.id]
                              : values.filter((id) => id !== h.id),
                          )
                        }
                      />
                      <span>
                        {h.address}
                        {h.unit ? ` · Unit ${h.unit}` : ""}
                        <small>
                          {h.peopleCount} listed residents · Ward {h.ward}
                          {h.suppressed
                            ? " · Do not contact"
                            : assigned.has(h.id)
                              ? " · Already assigned in this event"
                              : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                  {kind === "scattered" && picked.length > 0 && (
                    <>
                      <h4>Manual order — not optimized</h4>
                      <ol>
                        {picked.map((id, index) => {
                          const h = workspace.households.find(
                            (h) => h.id === id,
                          )!;
                          return (
                            <li key={id}>
                              {h.address} {h.unit}
                              <div className="import-assignment-actions">
                                <button
                                  type="button"
                                  disabled={frozen || index === 0}
                                  aria-label={`Move door ${index + 1} up`}
                                  onClick={() => move(index, -1)}
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    frozen || index === picked.length - 1
                                  }
                                  aria-label={`Move door ${index + 1} down`}
                                  onClick={() => move(index, 1)}
                                >
                                  Down
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                  <p>{picked.length} household doors selected</p>
                  <button
                    className="primary"
                    type="submit"
                    disabled={frozen || !picked.length || !eventId}
                  >
                    Save assignment
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
