"use client";
import { useEffect, useState } from "react";
import {
  fieldAdminRequest,
  type FieldAdminRequest,
  type FieldSnapshot,
} from "@/lib/field-admin-contracts";

export function AssignmentFieldControls({
  assignmentId,
  name,
  administratorId,
  deletionAt,
}: {
  assignmentId: string;
  name: string;
  administratorId: string;
  deletionAt: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<FieldSnapshot>();
  const [label, setLabel] = useState(name);
  const [pending, setPending] = useState<FieldAdminRequest>();
  const [storageReady, setStorageReady] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string }>();
  const [confirm, setConfirm] = useState<string>();
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const key = `jco-field-action:${administratorId}:${assignmentId}`;
  const date = (v: string) =>
    new Date(v).toLocaleString("en-US", { timeZone: "America/New_York" }) +
    " ET";
  async function copyLink() {
    try {
      if (!link || !navigator.clipboard) throw Error();
      await navigator.clipboard.writeText(link.url);
      setMessage("Private link copied.");
    } catch {
      setError("Select and copy the private link manually.");
    }
  }
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (Date.now() >= Date.parse(deletionAt)) {
        sessionStorage.removeItem(key);
        return;
      }
      if (saved) {
        const request = fieldAdminRequest.parse(JSON.parse(saved));
        if (request.assignmentId !== assignmentId) throw Error();
        setPending(request);
        if (request.action === "issue" && request.label !== undefined)
          setLabel(request.label);
        setOpen(true);
      }
      setStorageReady(true);
    } catch {
      setError(
        "Pending action could not be restored. Do not clear browser storage; contact the organizer.",
      );
    }
  }, [key, assignmentId, deletionAt]);
  async function run(request: FieldAdminRequest) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (Date.now() >= Date.parse(deletionAt)) {
        setLink(undefined);
        setSnapshot(undefined);
        sessionStorage.removeItem(key);
        setPending(undefined);
        throw Error("Campaign expired.");
      }
      if (request.action !== "status") {
        if (!storageReady)
          throw Error(
            "Pending-action storage is unavailable. Contact the organizer.",
          );
        sessionStorage.setItem(key, JSON.stringify(request));
        setPending(request);
      }
      const response = await fetch("/api/admin/field", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json();
      if (!response.ok) {
        if ([400, 404, 409, 410, 422].includes(response.status)) {
          sessionStorage.removeItem(key);
          setPending(undefined);
        }
        throw Error(body.error ?? "Action could not be confirmed. Retry it.");
      }
      if (body.snapshot?.assignmentId !== assignmentId)
        throw Error(
          "Response could not be verified. Retry the pending action.",
        );
      if (
        request.action === "issue" &&
        (body.credentialId !== request.id ||
          (request.label !== undefined &&
            body.snapshot.credentials?.find(
              (c: { id: string; label?: string }) => c.id === request.id,
            )?.label !== request.label) ||
          !(
            body.token === null ||
            (typeof body.token === "string" &&
              /^[A-Za-z0-9_-]{43}$/.test(body.token))
          ))
      )
        throw Error(
          "Link receipt could not be verified. Retry the pending action.",
        );
      setSnapshot(body.snapshot);
      if (
        link &&
        (!body.snapshot.credentials.some(
          (c: { id: string; revoked: boolean }) =>
            c.id === link.id && !c.revoked,
        ) ||
          Date.now() >= Date.parse(body.snapshot.uploadEndsAt))
      )
        setLink(undefined);
      if (request.action !== "status") {
        sessionStorage.removeItem(key);
        setPending(undefined);
      }
      if (request.action === "issue") {
        if (
          typeof body.token === "string" &&
          /^[A-Za-z0-9_-]{43}$/.test(body.token)
        ) {
          setLink({
            id: request.id,
            url: `${location.origin}/field#key=${body.token}`,
          });
          setMessage(
            "Link created. Copy it now; the server cannot reveal it again after this screen is closed.",
          );
        } else {
          setMessage(
            "This link was already created, but its secret cannot be shown again. You can revoke its entry below and generate a new link. Existing links were not changed.",
          );
        }
      }
      if (request.action === "revoke") {
        if (link?.id === request.id) setLink(undefined);
        setConfirm(undefined);
        setMessage(
          "Link revoked. Future downloads and uploads using it are blocked. Offline copies cannot be erased remotely.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Action could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={`Volunteer links for ${name}`}
      className="assignment-field-controls"
    >
      <button
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          if (!open) void run({ action: "status", assignmentId });
        }}
      >
        {open ? "Hide volunteer links" : "Volunteer links"}
      </button>
      {open && (
        <>
          <p className="fine">
            Synthetic testing only. A private link grants access to this
            assignment. Send it only to its assigned volunteer; do not forward
            it. New links do not revoke earlier links.
          </p>
          {!storageReady && (
            <p role="alert">
              Pending-action storage is unavailable. Link changes are disabled;
              contact the organizer.
            </p>
          )}
          {pending && (
            <p role="status">
              An action is awaiting confirmation.{" "}
              <button disabled={busy} onClick={() => void run(pending)}>
                Retry pending link action
              </button>
            </p>
          )}
          {snapshot?.labelsReady && (
            <label className="import-label">
              Volunteer / link name
              <input
                value={label}
                maxLength={100}
                disabled={busy || !!pending || !storageReady}
                onChange={(e) => setLabel(e.target.value)}
              />
              <small>
                For example, “Pair 01 — Saturday”. This is an organizer label,
                not a verified identity.
              </small>
            </label>
          )}
          {snapshot && !snapshot.labelsReady && (
            <p className="fine">
              Individual link names need the link-label database update.
              Existing links still work.
            </p>
          )}
          <div className="import-assignment-actions">
            <button
              disabled={
                busy ||
                !!pending ||
                !storageReady ||
                !snapshot ||
                (snapshot.labelsReady === true && !label.trim()) ||
                Date.now() >= Date.parse(snapshot.eventEndsAt)
              }
              onClick={() =>
                void run({
                  action: "issue",
                  assignmentId,
                  id: crypto.randomUUID(),
                  ...(snapshot?.labelsReady ? { label: label.trim() } : {}),
                })
              }
            >
              Generate private link
            </button>
            <button
              disabled={busy}
              onClick={() => void run({ action: "status", assignmentId })}
            >
              Refresh links
            </button>
          </div>
          {link && (
            <div className="private-link-box">
              <p>Copy this private link before leaving this screen.</p>
              <label>
                Private volunteer link
                <input
                  readOnly
                  value={link.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <div className="import-assignment-actions">
                <button onClick={() => void copyLink()}>
                  Copy private link
                </button>
                <a
                  className="primary"
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open volunteer assignment
                </a>
              </div>
            </div>
          )}
          {snapshot && (
            <>
              <p className="fine">
                Downloads end: {date(snapshot.eventEndsAt)}
                <br />
                Pending uploads end: {date(snapshot.uploadEndsAt)}
              </p>
              {(["active", "expired", "revoked"] as const).map((group) => {
                // Keep original issuance numbers when moving rows between groups.
                const entries = snapshot.credentials
                  .map((credential, index) => ({ credential, index }))
                  .filter(({ credential }) => {
                    const state = credential.revoked
                      ? "revoked"
                      : Date.now() >= Date.parse(snapshot.uploadEndsAt)
                        ? "expired"
                        : "active";
                    return state === group;
                  });
                const rows = entries.map(({ credential: c, index: i }) => (
                  <div className="credential-row" key={c.id}>
                    {c.label && <strong>{c.label}</strong>}
                    <p>
                      Link {i + 1} ·{" "}
                      {c.revoked
                        ? "Revoked"
                        : Date.now() >= Date.parse(snapshot.uploadEndsAt)
                          ? "Expired"
                          : Date.now() >= Date.parse(snapshot.eventEndsAt)
                            ? "Upload only"
                            : "Active"}
                      <br />
                      <small>Issued: {date(c.issuedAt)}</small>
                      {c.revoked && (
                        <>
                          <br />
                          <small>
                            Revoked:{" "}
                            {c.revokedAt
                              ? date(c.revokedAt)
                              : "Time unavailable"}
                          </small>
                        </>
                      )}
                    </p>
                    {group === "active" && (
                      <>
                        {confirm !== c.id ? (
                          <button
                            disabled={busy || !!pending || !storageReady}
                            onClick={() => setConfirm(c.id)}
                          >
                            Revoke link {i + 1}
                            {c.label ? ` — ${c.label}` : ""}
                          </button>
                        ) : (
                          <>
                            <p>
                              {c.label && <>Revoke “{c.label}”? </>}
                              Revoking blocks pending uploads from this link,
                              including work already saved offline. It cannot
                              erase a disconnected copy.
                            </p>
                            <div className="import-assignment-actions">
                              <button
                                disabled={busy || !!pending || !storageReady}
                                onClick={() =>
                                  void run({
                                    action: "revoke",
                                    assignmentId,
                                    id: c.id,
                                    confirmed: true,
                                  })
                                }
                              >
                                Confirm revoke link {i + 1}
                                {c.label ? ` — ${c.label}` : ""}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => setConfirm(undefined)}
                              >
                                Cancel revocation
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ));
                return group === "active" ? (
                  <section aria-label="Active links" key={group}>
                    <h4>Active links</h4>
                    {entries.length === 0 ? <p>No active links.</p> : rows}
                  </section>
                ) : entries.length > 0 ? (
                  <details key={group}>
                    <summary>
                      {group === "revoked" ? "Revoked links" : "Expired links"}{" "}
                      ({entries.length})
                    </summary>
                    {rows}
                  </details>
                ) : null;
              })}
            </>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
