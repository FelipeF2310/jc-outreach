"use client";
import { useEffect, useState } from "react";
import type { ImportPreview, ImportReceipt } from "@/lib/import-contracts";

const examples = [
  ["valid-couple-and-buildings", "Approved synthetic CSV"],
  ["tier-three", "Disallowed Tier 3 record"],
  ["unknown-tier", "Unknown Tier value"],
  ["blank-tier", "Missing Tier value"],
  ["conflicting-unit", "Conflicting household units"],
  ["missing-household-key", "Missing Household Key"],
  ["missing-address", "Missing residence address"],
  ["duplicate-source-person", "Duplicate person"],
  ["missing-required-header", "Missing required header"],
  ["unexpected-header", "Unexpected header"],
];
type Rehearsal = {
  campaignId: string;
  endAt: string;
  deletionAt: string;
  receipt?: ImportReceipt | null;
};
const formatDate = (date: string) =>
  new Date(date).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });

export function ImportRehearsal() {
  const [campaign, setCampaign] = useState<Rehearsal>();
  const [history, setHistory] = useState<Rehearsal[]>([]);
  const [caseId, setCaseId] = useState(examples[0][0]);
  const [preview, setPreview] = useState<ImportPreview>();
  const [receipt, setReceipt] = useState<ImportReceipt>();
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function api<T>(input: unknown): Promise<T> {
    const response = await fetch("/api/demo/import", {
      method: "POST",
      cache: "no-store",
      headers: { "X-JCO-Demo": "1", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        body.error ??
          "Import rehearsal failed. Retry without changing the source.",
      );
    return body;
  }
  function select(value: Rehearsal) {
    setCampaign(value);
    setReceipt(value.receipt ?? undefined);
    setPreview(undefined);
    setError("");
    setLink("");
    setConfirmed(false);
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/demo/import", {
      headers: { "X-JCO-Demo": "1" },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (active) {
          setHistory(body);
          if (body[0]) select(body[0]);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Unable to load import rehearsals.",
          );
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: "create" | "preview" | "finalize" | "assignment") {
    setBusy(true);
    setError("");
    try {
      if (action === "create") {
        const next = await api<Rehearsal>({
          action,
          campaignId: crypto.randomUUID(),
        });
        select(next);
        setHistory((values) => [next, ...values]);
      } else if (campaign) {
        if (action === "preview") {
          setPreview(undefined);
          setConfirmed(false);
          setPreview(
            await api<ImportPreview>({
              action,
              campaignId: campaign.campaignId,
              caseId,
            }),
          );
        }
        if (action === "finalize" && preview?.digest && confirmed) {
          const result = await api<ImportReceipt>({
            action,
            campaignId: campaign.campaignId,
            caseId,
            digest: preview.digest,
          });
          setReceipt(result);
          setHistory((values) =>
            values.map((value) =>
              value.campaignId === campaign.campaignId
                ? { ...value, receipt: result }
                : value,
            ),
          );
        }
        if (action === "assignment") {
          const result = await api<{ token: string }>({
            action,
            campaignId: campaign.campaignId,
          });
          setLink(`${window.location.origin}/field#key=${result.token}`);
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to complete the import step.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel import-panel" aria-labelledby="import-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DATA / IMPORT REHEARSAL</p>
          <h2 id="import-heading">One list. The right doors.</h2>
        </div>
        <button
          onClick={() => void run("create")}
          disabled={busy || loadingHistory}
        >
          New import rehearsal
        </button>
      </div>
      <p className="muted">
        Practice validation and finalization with built-in CSV examples.
        Real-file uploads are disabled until production access and upload
        handling are verified.
      </p>
      {history.length > 0 && (
        <label className="import-label">
          Synthetic campaign
          <select
            value={campaign?.campaignId ?? ""}
            disabled={busy}
            onChange={(e) => {
              const value = history.find(
                (v) => v.campaignId === e.target.value,
              );
              if (value) select(value);
            }}
          >
            {history.map((value, index) => (
              <option key={value.campaignId} value={value.campaignId}>
                Rehearsal {history.length - index} ·{" "}
                {value.receipt ? "Finalized" : "Not finalized"}
              </option>
            ))}
          </select>
        </label>
      )}
      {campaign && (
        <>
          <p className="fine">
            Campaign ends: {formatDate(campaign.endAt)} ET
            <br />
            Identifying-data deadline: {formatDate(campaign.deletionAt)} ET.
            Automatic deletion is not connected in this demo.
          </p>
          {receipt ? (
            <div className="finalized-import">
              <h3>Import finalized</h3>
              <p role="status">
                {receipt.counts.people} people · {receipt.counts.households}{" "}
                households · {receipt.counts.buildings} buildings committed.
              </p>
              <p className="fine">
                This source cannot be replaced. Retrying finalization does not
                create duplicate records.
              </p>
              <div className="import-assignment-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run("assignment")}
                >
                  Create imported practice assignment
                </button>
                {link && (
                  <a href={link} className="primary">
                    Open imported volunteer assignment ↗
                  </a>
                )}
              </div>
            </div>
          ) : (
            <>
              <label className="import-label">
                CSV example
                <select
                  value={caseId}
                  disabled={busy}
                  onChange={(e) => {
                    setCaseId(e.target.value);
                    setPreview(undefined);
                    setConfirmed(false);
                  }}
                >
                  {examples.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run("preview")}
              >
                {busy ? "Working…" : "Validate synthetic CSV"}
              </button>
              {preview &&
                (preview.valid && preview.counts ? (
                  <div className="import-preview">
                    <h3>Validation passed — not yet imported</h3>
                    <p role="status">
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
                              .map((p) => `${p.firstName} ${p.lastName}`)
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
                        onChange={(e) => setConfirmed(e.target.checked)}
                        disabled={busy}
                      />
                      I reviewed the household grouping and approve this
                      synthetic source.
                    </label>
                    <p className="fine">
                      Schema validation is not proof that a real file is
                      approved. The production source must be selected by its
                      authorized owner.
                    </p>
                    <button
                      className="primary"
                      disabled={busy || !confirmed}
                      onClick={() => void run("finalize")}
                    >
                      Finalize import
                    </button>
                  </div>
                ) : (
                  <div className="error" role="alert">
                    <h3>Import rejected — no resident rows stored</h3>
                    <ul>
                      {preview.issues.map((issue) => (
                        <li key={issue.code}>
                          {issue.message}
                          {issue.records.length > 0 && (
                            <small>
                              {" "}
                              CSV record numbers: {issue.records.join(", ")}
                              {issue.count > issue.records.length
                                ? " (first reported examples)"
                                : ""}
                              .
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p>
                      Correct the source file and repeat validation. No partial
                      import was created.
                    </p>
                  </div>
                ))}
            </>
          )}
        </>
      )}
      {!campaign && (
        <p className="fine">
          Create an empty synthetic campaign to start. This will not replace
          your existing practice walk.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
