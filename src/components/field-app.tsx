"use client";
import { useEffect, useRef, useState } from "react";
import {
  accessReasons,
  correctionNames,
  outcomes,
  programNames,
  type Assignment,
  type Household,
  type Operation,
  type Outcome,
  type ProgramId,
  type VisitOperation,
} from "@/lib/contracts";
import {
  prepareOfflineShell,
  readLocal,
  saveOperation,
  storeAssignment,
  syncLocal,
  type LocalRecord,
  type StoredAssignment,
} from "@/lib/local-store";

function visitState(visit: VisitOperation, records: LocalRecord[]) {
  const latest = [...records]
    .reverse()
    .find(
      (record) =>
        record.operation.kind !== "building" &&
        record.operation.visitId === visit.visitId,
    );
  return {
    result:
      latest && latest.operation.kind !== "building"
        ? latest.operation.result
        : visit.result,
    received: !!latest?.receipt,
  };
}

export function FieldApp() {
  const [stored, setStored] = useState<StoredAssignment>();
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Household>();
  const [reference, setReference] = useState(false);
  const [blocked, setBlocked] = useState<string>();
  const [editing, setEditing] = useState<VisitOperation>();
  const lock = useRef(false);
  async function reload() {
    const local = await readLocal();
    setStored(local.assignment);
    setRecords(local.records);
    setSelected((current) =>
      current
        ? local.assignment?.assignment.households.find(
            (h) => h.id === current.id,
          )
        : undefined,
    );
    if (local.expired) {
      setSelected(undefined);
      setReference(false);
      setBlocked(undefined);
      setReady(false);
      setToken("");
      setError(
        "This campaign has expired. Its data was removed from this browser.",
      );
    }
    return local;
  }
  useEffect(() => {
    const key =
      new URLSearchParams(window.location.hash.slice(1)).get("key") ?? "";
    if (key) {
      setToken(key);
      history.replaceState(null, "", "/field");
    }
    void reload()
      .then(async (local) => {
        if (local.assignment) {
          const cache = await caches.open("jco-shell-v1");
          setReady(!!(await cache.match("/field")));
        }
      })
      .catch(() =>
        setError("Local storage could not be opened. Do not begin field work."),
      )
      .finally(() => setLoaded(true));
    function connectivity() {
      setOnline(navigator.onLine);
    }
    function resume() {
      if (document.visibilityState === "visible")
        void reload().catch(() =>
          setError("Unable to read stored work. Do not clear browser data."),
        );
    }
    connectivity();
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    const timer = window.setInterval(resume, 15000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, []);
  async function download() {
    setBusy(true);
    setError("");
    try {
      const credential = token || stored?.token;
      if (!credential)
        throw new Error("Open the private link from your organizer first.");
      const response = await fetch("/api/assignment", {
        headers: { Authorization: `Bearer ${credential}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await prepareOfflineShell();
      await storeAssignment(payload as Assignment, credential);
      await reload();
      setReady(true);
      setToken("");
      setMessage("Ready offline — assignment and program reference stored.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Download failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await syncLocal(() => {
        void reload();
      });
      await reload();
      setMessage(
        result.rejected
          ? "Some records need organizer review. They remain saved on this device."
          : "Synchronization finished. Check record status below.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Sync interrupted. Saved work remains on this device.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function persist(operation: Operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await saveOperation(operation);
      const local = await reload();
      setMessage("Saved on this device — waiting to sync.");
      setEditing(undefined);
      setBlocked(undefined);
      if (operation.kind === "visit") {
        const households = local.assignment?.assignment.households ?? [];
        const index = households.findIndex(
          (h) => h.id === operation.householdId,
        );
        setSelected(
          households
            .slice(index + 1)
            .find(
              (h) =>
                !h.suppressed &&
                !local.records.some(
                  (r) =>
                    r.operation.kind === "visit" &&
                    r.operation.householdId === h.id,
                ),
            ),
        );
      } else setSelected(undefined);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Save failed. Your draft has not been submitted.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const assignment = stored?.assignment;
  const pending = records.filter((r) => !r.receipt).length;
  const received = records.filter((r) => r.receipt).length;
  const visited = new Set(
    records.flatMap(({ operation }) =>
      operation.kind === "visit" &&
      assignment?.households.some((h) => h.id === operation.householdId)
        ? [operation.householdId]
        : [],
    ),
  );
  const groups = assignment
    ? [...new Set(assignment.households.map((h) => h.buildingId))]
    : [];
  const ended = assignment
    ? Date.now() >= Date.parse(assignment.eventEndsAt)
    : false;
  function base() {
    return {
      id: crypto.randomUUID(),
      assignmentId: assignment!.id,
      createdAt: new Date().toISOString(),
      schemaVersion: 1 as const,
    };
  }
  return (
    <div className="field-shell">
      <header className="field-header">
        <a
          href="/"
          className="field-brand"
          aria-label="JCO organizer workspace"
        >
          <span className="mark">J</span> JCO
        </a>
        <span className={`connection ${online ? "" : "offline"}`}>
          <i />
          {online ? "Network available" : "Offline"}
        </span>
      </header>
      <div className="demo-ribbon">
        SYNTHETIC REHEARSAL · NO REAL RESIDENT DATA
      </div>
      <main className="field-main">
        {!loaded ? (
          <p role="status">Opening stored assignment…</p>
        ) : !assignment || (token && token !== stored?.token) ? (
          <section className="download-panel">
            <p className="eyebrow">YOUR FIELD ASSIGNMENT</p>
            <h1>
              Good outreach
              <br />
              starts at the door.
            </h1>
            <p className="muted">
              Download your private list before you leave Wi-Fi. Your saved work
              stays on this device until you synchronize.
            </p>
            <button
              className="primary full"
              disabled={busy || !token}
              onClick={download}
            >
              {busy ? "Preparing offline…" : "Download assignment"}
            </button>
            <p className="fine">
              This link gives access to your assigned households. Do not forward
              it.
            </p>
            {!token && (
              <p>Open a private assignment link from the organizer to begin.</p>
            )}
          </section>
        ) : (
          <>
            <div className="field-title">
              <p className="eyebrow">{assignment.eventName}</p>
              <h1>
                {reference
                  ? "Program reference"
                  : selected
                    ? selected.unit
                      ? `Unit ${selected.unit}`
                      : "Household"
                    : "Your practice walk"}
              </h1>
              <p className="muted">
                {selected
                  ? selected.address
                  : `${assignment.households.length} households · ${groups.length} buildings · Manually ordered`}
              </p>
            </div>
            <div className={`offline-status ${ready ? "ready" : ""}`}>
              <span aria-hidden="true">{ready ? "✓" : "!"}</span>
              <div>
                <strong>
                  {ready ? "Ready offline" : "Offline setup incomplete"}
                </strong>
                <small>
                  {ready
                    ? `${assignment.households.length} households stored on this device`
                    : "Download again before starting field work."}
                </small>
              </div>
              {!ready && (
                <button onClick={download} disabled={busy}>
                  Retry
                </button>
              )}
            </div>
            {ended && (
              <p className="notice">
                Field work has ended. You can synchronize previously saved work
                during the upload window.
              </p>
            )}
            {!!assignment.supersededHouseholdIds?.length && (
              <p className="notice">
                {assignment.supersededHouseholdIds.length}{" "}
                {assignment.supersededHouseholdIds.length === 1
                  ? "door has"
                  : "doors have"}{" "}
                been reassigned. Only your current doors appear below.
                Previously saved work remains on this device and can still
                synchronize while your link permits uploads.
              </p>
            )}
            {assignment.households.length === 0 && (
              <p className="notice">
                No active doors remain in this assignment. Sync any pending
                work; contact your organizer for your next assignment.
              </p>
            )}
            {reference ? (
              <>
                <button
                  className="text-button"
                  onClick={() => setReference(false)}
                >
                  ← Back to assignment
                </button>
                <p className="notice">
                  Practice content — not approved for resident outreach. Program
                  rules must be reviewed before launch.
                </p>
                {assignment.programs.map((p) => (
                  <section className="panel program" key={p.id}>
                    <h2>{p.name}</h2>
                    <p>{p.summary}</p>
                    <small>Review status: not yet reviewed</small>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {p.source} ↗
                    </a>
                  </section>
                ))}
              </>
            ) : selected ? (
              <>
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(undefined);
                    setEditing(undefined);
                  }}
                >
                  ← All households
                </button>
                <section className="resident-card">
                  <p className="eyebrow">LISTED RESIDENTS · ONE HOUSEHOLD</p>
                  {selected.people.map((p) => (
                    <div key={p.id}>
                      {p.firstName} {p.lastName}
                    </div>
                  ))}
                </section>
                {selected.suppressed ? (
                  <p className="notice">
                    Do not contact. This household is suppressed in this
                    assignment.
                  </p>
                ) : (
                  ready &&
                  !ended && (
                    <VisitForm
                      key={`${selected.id}:${editing?.id ?? "new"}`}
                      household={selected}
                      editing={editing}
                      disabled={busy}
                      onSave={(value) => {
                        if (editing) {
                          const latest = [...records]
                            .reverse()
                            .find(
                              (r) =>
                                r.operation.kind === "revision" &&
                                r.operation.visitId === editing.visitId,
                            );
                          void persist({
                            ...base(),
                            kind: "revision",
                            visitId: editing.visitId,
                            householdId: selected.id,
                            originalOperationId: editing.id,
                            previousOperationId: latest?.id ?? editing.id,
                            result: value.result,
                          });
                        } else
                          void persist({
                            ...base(),
                            kind: "visit",
                            visitId: crypto.randomUUID(),
                            householdId: selected.id,
                            ...value,
                          });
                      }}
                    />
                  )
                )}
                <button
                  className="text-button"
                  onClick={() => setReference(true)}
                >
                  View program reference ↗
                </button>
                {records
                  .filter(
                    (r) =>
                      r.operation.kind === "visit" &&
                      r.operation.householdId === selected.id,
                  )
                  .map((r) => (
                    <div className="history" key={r.id}>
                      <span>
                        {r.operation.kind === "visit"
                          ? outcomes[visitState(r.operation, records).result]
                          : "Visit"}{" "}
                        ·{" "}
                        {r.operation.kind === "visit" &&
                        visitState(r.operation, records).received
                          ? "Received"
                          : "Saved on device"}
                      </span>
                      <button
                        disabled={ended || busy}
                        onClick={() => {
                          if (r.operation.kind === "visit")
                            setEditing({
                              ...r.operation,
                              result: visitState(r.operation, records).result,
                            });
                        }}
                      >
                        Edit result
                      </button>
                    </div>
                  ))}
              </>
            ) : (
              <>
                <div className="walk-progress">
                  <span>
                    {visited.size} of {assignment.households.length} households
                    recorded
                  </span>
                  <span>
                    {Math.round(
                      assignment.households.length
                        ? (visited.size / assignment.households.length) * 100
                        : 0,
                    )}
                    %
                  </span>
                  <progress
                    value={visited.size}
                    max={Math.max(1, assignment.households.length)}
                  />
                </div>
                {groups.map((buildingId, index) => {
                  const households = assignment.households.filter(
                    (h) => h.buildingId === buildingId,
                  );
                  return (
                    <section className="building-card" key={buildingId}>
                      <div className="building-heading">
                        <span className="building-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h2>{households[0].address}</h2>
                          <p>
                            {households.length}{" "}
                            {households.length === 1
                              ? "household"
                              : "households"}
                          </p>
                        </div>
                      </div>
                      {households.map((h) => {
                        const rows = records.filter(
                          (r) =>
                            r.operation.kind !== "building" &&
                            r.operation.householdId === h.id,
                        );
                        const state = h.suppressed
                          ? "Do not contact"
                          : !rows.length
                            ? "Not visited"
                            : rows.every((r) => r.receipt)
                              ? "Received"
                              : "Saved on device";
                        return (
                          <button
                            className="household-row"
                            key={h.id}
                            onClick={() => {
                              setSelected(h);
                              setEditing(undefined);
                            }}
                          >
                            <div>
                              <strong>
                                {h.unit ? `Unit ${h.unit}` : "Household"}
                              </strong>
                              <small>
                                {h.people.length} listed{" "}
                                {h.people.length === 1
                                  ? "resident"
                                  : "residents"}
                              </small>
                            </div>
                            <span
                              className={
                                state === "Received" ? "received" : "row-state"
                              }
                            >
                              {state} &nbsp; ›
                            </span>
                          </button>
                        );
                      })}
                      {ready && !ended && (
                        <button
                          className="access-button"
                          onClick={() =>
                            setBlocked(
                              blocked === buildingId ? undefined : buildingId,
                            )
                          }
                        >
                          Cannot access building
                        </button>
                      )}
                      {blocked === buildingId && (
                        <div className="access-options">
                          <p>
                            Record one building failure. Unvisited households
                            remain not visited.
                          </p>
                          {Object.entries(accessReasons).map(([id, label]) => (
                            <button
                              key={id}
                              disabled={busy}
                              onClick={() =>
                                void persist({
                                  ...base(),
                                  kind: "building",
                                  buildingId,
                                  reason: id as keyof typeof accessReasons,
                                })
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
                <button
                  className="text-button"
                  onClick={() => setReference(true)}
                >
                  Program reference ↗
                </button>
                <button
                  className="text-button"
                  disabled={busy || !online || ended}
                  onClick={download}
                >
                  Refresh assignment
                </button>
                <p className="fine">
                  Clearing browser or site data may remove unsynchronized work.
                  Sync whenever connectivity returns.
                </p>
              </>
            )}
          </>
        )}
        {message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {records
          .filter((r) => r.rejection && !r.receipt)
          .map((r) => (
            <p role="alert" key={r.id} className="error">
              {r.rejection} Saved on this device; not received.
            </p>
          ))}
      </main>
      {assignment && (
        <footer className="sync-bar">
          <div>
            <strong>
              {busy
                ? "Working…"
                : pending
                  ? `${pending} waiting to sync`
                  : received
                    ? "All records received"
                    : "No pending records"}
            </strong>
            <small>{received} received by server</small>
          </div>
          <button
            className="primary"
            onClick={sync}
            disabled={busy || !online || !pending}
          >
            {busy ? "Please wait…" : "Sync now"}
          </button>
        </footer>
      )}
    </div>
  );
}

type VisitDetails = Pick<
  VisitOperation,
  "result" | "programs" | "help" | "corrections" | "doNotContact"
>;
function VisitForm({
  household,
  disabled,
  editing,
  onSave,
}: {
  household: Household;
  disabled: boolean;
  editing?: VisitOperation;
  onSave: (value: VisitDetails) => void;
}) {
  const [result, setResult] = useState<Outcome | "">(editing?.result ?? "");
  const [programs, setPrograms] = useState<ProgramId[]>([]);
  const [help, setHelp] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [dnc, setDnc] = useState(false);
  const [correction, setCorrection] = useState<
    keyof typeof correctionNames | ""
  >("");
  const [person, setPerson] = useState("");
  const [error, setError] = useState("");
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!result) {
      setError("Choose what happened at this door.");
      return;
    }
    if (help && phone.trim() && !consent) {
      setError(
        "Remove the phone number to save without contact permission, or record the resident’s permission.",
      );
      return;
    }
    if (["moved", "deceased"].includes(correction) && !person) {
      setError("Select the person this report concerns.");
      return;
    }
    onSave({
      result,
      programs,
      doNotContact: dnc,
      help: help
        ? {
            id: crypto.randomUUID(),
            personId: null,
            phone: phone.trim(),
            consent,
            arrangement: "unspecified",
          }
        : null,
      corrections: correction
        ? [
            {
              id: crypto.randomUUID(),
              kind: correction,
              personId: person || null,
            },
          ]
        : [],
    });
  }
  return (
    <form onSubmit={submit} className="visit-form">
      <fieldset disabled={disabled}>
        <legend>
          {editing ? "Correct the saved contact result" : "What happened?"}
        </legend>
        {editing && (
          <p className="fine">
            This saves a revision, not another door attempt. Help requests and
            reported corrections remain unchanged.
          </p>
        )}
        <div className="outcome-options">
          {Object.entries(outcomes).map(([key, label]) => (
            <label className={result === key ? "chosen" : ""} key={key}>
              <input
                type="radio"
                name="result"
                value={key}
                checked={result === key}
                onChange={() => {
                  setResult(key as Outcome);
                  if (!["resident", "other"].includes(key)) {
                    setPrograms([]);
                    setHelp(false);
                    setPhone("");
                    setConsent(false);
                  }
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {!editing && (
          <>
            {["resident", "other"].includes(result) && (
              <div className="conversation">
                <h3>Information delivered</h3>
                {Object.entries(programNames).map(([id, name]) => (
                  <label className="check-row" key={id}>
                    <input
                      type="checkbox"
                      checked={programs.includes(id as ProgramId)}
                      onChange={(e) =>
                        setPrograms(
                          e.target.checked
                            ? [...programs, id as ProgramId]
                            : programs.filter((p) => p !== id),
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
                <label className="check-row help-toggle">
                  <input
                    type="checkbox"
                    checked={help}
                    onChange={(e) => setHelp(e.target.checked)}
                  />
                  Wants application help
                </label>
                {help && (
                  <div className="help-details">
                    <p>
                      A phone number is not required. The request will be saved
                      either way.
                    </p>
                    <label>
                      Phone number — optional
                      <input
                        type="tel"
                        autoComplete="off"
                        maxLength={32}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </label>
                    {phone && (
                      <>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          Resident gave permission to use this number for
                          application-help follow-up
                        </label>
                        {!consent && (
                          <button
                            type="button"
                            onClick={() => {
                              setPhone("");
                              setError("");
                            }}
                          >
                            Remove phone number
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <details className="correction-details">
              <summary>Resident-reported corrections or requests</summary>
              <label>
                Reported issue
                <select
                  value={correction}
                  onChange={(e) => {
                    setCorrection(
                      e.target.value as keyof typeof correctionNames | "",
                    );
                    setPerson("");
                  }}
                >
                  <option value="">No correction</option>
                  {Object.entries(correctionNames).map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {["moved", "deceased"].includes(correction) && (
                <label>
                  Which person?
                  <select
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  >
                    <option value="">Select a listed resident</option>
                    {household.people.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={dnc}
                  onChange={(e) => setDnc(e.target.checked)}
                />
                Explicit do-not-contact request
              </label>
              <small>
                Declining a conversation does not mean do not contact.
              </small>
            </details>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary full">
          {disabled ? "Saving…" : editing ? "Save revision" : "Save & next"}{" "}
          <span aria-hidden="true">→</span>
        </button>
      </fieldset>
    </form>
  );
}
