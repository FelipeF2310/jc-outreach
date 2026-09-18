"use client";
import { useState } from "react";
import type { ImportPreview, ImportReceipt } from "@/lib/import-contracts";

export function CampaignImport({
  campaignId,
  receipt: savedReceipt,
  ready,
  onFinalized,
}: {
  campaignId: string;
  receipt?: ImportReceipt | null;
  ready: boolean;
  onFinalized: (receipt: ImportReceipt) => void;
}) {
  const [open, setOpen] = useState(false);
  const [caseId, setCaseId] = useState("valid-couple-and-buildings");
  const [preview, setPreview] = useState<ImportPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<ImportReceipt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = receipt ?? savedReceipt;
  async function run(action: "preview" | "finalize") {
    if (
      action === "finalize" &&
      (!confirmed || !preview?.valid || !preview.digest)
    )
      return;
    setBusy(true);
    setError("");
    if (action === "preview") {
      setPreview(undefined);
      setConfirmed(false);
    } else setPending(true);
    try {
      const response = await fetch("/api/admin/import", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-JCO-Admin": "1", "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          campaignId,
          caseId,
          ...(action === "finalize"
            ? { digest: preview!.digest, confirmed: true }
            : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ??
            "Import could not be confirmed. Retry or refresh this campaign.",
        );
      if (action === "preview") setPreview(result.preview);
      else {
        if (result.receipt?.campaignId !== campaignId)
          throw new Error(
            "Import receipt could not be confirmed. Retry the same import.",
          );
        setReceipt(result.receipt);
        setPending(false);
        onFinalized(result.receipt);
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Import unavailable. Retry without changing the example.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="campaign-import" aria-label="Campaign household import">
      {saved ? (
        <>
          <h3 className="visually-hidden">Import finalized</h3>
          <p role="status">
            {saved.counts.people} people · {saved.counts.households} households
            · {saved.counts.buildings}{" "}
            {saved.counts.buildings === 1 ? "building" : "buildings"} saved.
          </p>
          <p className="fine">
            Your household list is saved. Continue to volunteer assignments
            below. This finalized synthetic source cannot be replaced.
          </p>
        </>
      ) : (
        <>
          <button disabled={!ready} onClick={() => setOpen((value) => !value)}>
            {open ? "Hide import preview" : "Import synthetic households"}
          </button>
          {!ready && (
            <p className="fine">
              Synthetic household imports need the next database update. Your
              campaign is saved.
            </p>
          )}
          {open && (
            <>
              <h3>Preview households before importing</h3>
              <p className="fine">
                Built-in practice examples only. Real-file uploads remain
                disabled. The two error examples deliberately demonstrate
                rejection.
              </p>
              <details className="testing-tools">
                <summary>Testing tools — choose a CSV example</summary>
                <label className="import-label">
                  Synthetic CSV example
                  <select
                    value={caseId}
                    disabled={busy || pending}
                    onChange={(event) => {
                      setCaseId(event.target.value);
                      setPreview(undefined);
                      setConfirmed(false);
                      setError("");
                    }}
                  >
                    <option value="valid-couple-and-buildings">
                      Valid example — 4 people, 3 doors
                    </option>
                    <option value="tier-three">
                      Error example — disallowed Tier 3
                    </option>
                    <option value="conflicting-unit">
                      Error example — conflicting units
                    </option>
                  </select>
                </label>
              </details>
              <button
                disabled={busy || pending}
                onClick={() => void run("preview")}
              >
                Validate example
              </button>
              {preview &&
                (preview.valid && preview.counts ? (
                  <div className="import-preview">
                    <h4>Validation passed — not yet imported</h4>
                    <p>
                      {preview.counts.people} people ·{" "}
                      {preview.counts.households} households ·{" "}
                      {preview.counts.buildings} buildings
                    </p>
                    {preview.households.map((h) => (
                      <div className="result-row" key={h.key}>
                        <div>
                          <strong>
                            {h.address}
                            {h.unit ? ` · Unit ${h.unit}` : ""}
                          </strong>
                          <small>
                            {h.people
                              .map(
                                (person) =>
                                  `${person.firstName} ${person.lastName}`,
                              )
                              .join(" · ")}
                          </small>
                        </div>
                        <span className="pill">ONE DOOR</span>
                      </div>
                    ))}
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={busy || pending}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      I reviewed the households and approve this synthetic
                      import.
                    </label>
                    {pending && (
                      <p role="status">
                        The result is not yet confirmed. Retry this same import
                        or refresh to check the saved summary; do not create a
                        new campaign.
                      </p>
                    )}
                    <button
                      className="primary"
                      disabled={busy || !confirmed}
                      onClick={() => void run("finalize")}
                    >
                      {busy
                        ? "Working…"
                        : pending
                          ? "Retry import"
                          : "Finalize synthetic import"}
                    </button>
                  </div>
                ) : (
                  <div role="alert" className="error">
                    <h4>Import rejected — no records stored</h4>
                    <ul>
                      {preview.issues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
