"use client";
import { useEffect, useState } from "react";
import { outcomes } from "@/lib/contracts";
import type { results } from "@/server/service";
import { ImportRehearsal } from "./import-rehearsal";

type Results = Awaited<ReturnType<typeof results>>;
export function AdminApp() {
  const [data, setData] = useState<Results>();
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/demo", {
        cache: "no-store",
        headers: { "X-JCO-Demo": "1" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load results.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function issue() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "X-JCO-Demo": "1" },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setLink(`${window.location.origin}/field#key=${body.token}`);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue link.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <a href="/" className="wordmark">
          <span className="mark">J</span> JCO
          <span className="wordmark-sub">JERSEY CITY OUTREACH</span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <span className="nav-active">◎ &nbsp; Field rehearsal</span>
        <div className="sidebar-foot">
          <span className="live-dot" /> Local development
          <br />
          <small>Synthetic records only</small>
        </div>
      </aside>
      <main className="admin-main">
        <div className="topline">
          <span>Jersey City / Outreach</span>
          <span className="pill">SYNTHETIC BUILD · 0.1</span>
        </div>
        <header className="page-heading">
          <div>
            <p className="eyebrow">ORGANIZER WORKSPACE</p>
            <h1>
              A good day starts
              <br />
              with a clear assignment.
            </h1>
            <p className="muted">
              One household. One door. A reliable record of what happened.
            </p>
          </div>
          <span className="seal" aria-hidden="true">
            JC
            <br />
            <small>OUTREACH</small>
          </span>
        </header>
        <div className="notice">
          <strong>Practice environment</strong>
          <span>
            All residents and addresses below are made up. Production sign-in,
            real-file uploads, and scheduled deletion are not connected. Do not
            enter real resident information.
          </span>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <ImportRehearsal />
        <section className="stats" aria-label="Received field results">
          {[
            ["Households attempted", data?.counts.attempts],
            ["Conversations", data?.counts.conversations],
            ["Help requests", data?.counts.help],
            ["Building access failures", data?.counts.buildings],
          ].map(([label, value]) => (
            <div className="stat" key={label}>
              <span>{label}</span>
              <strong>{value ?? "—"}</strong>
              <small>Received by server</small>
            </div>
          ))}
        </section>
        <div className="admin-grid">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">01 / ASSIGNMENT</p>
                <h2>Practice walk</h2>
              </div>
              <span className="pill">3 DOORS</span>
            </div>
            <p className="muted">
              A small ordered list to rehearse the full field workflow.
            </p>
            <div className="assignment-detail">
              <span className="building-icon" aria-hidden="true">
                ▥
              </span>
              <div>
                <strong>100 Fixture Walk</strong>
                <p>Units 2A and 10B · 3 listed residents</p>
              </div>
            </div>
            <div className="assignment-detail">
              <span className="building-icon" aria-hidden="true">
                ⌂
              </span>
              <div>
                <strong>200 Synthetic Lane</strong>
                <p>1 household · 1 listed resident</p>
              </div>
            </div>
            <button
              className="primary full"
              onClick={issue}
              disabled={busy || !data}
            >
              Generate practice link <span aria-hidden="true">↗</span>
            </button>
            {link && (
              <div className="link-actions">
                <a className="primary" href={link}>
                  Open volunteer assignment
                </a>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                    } catch {
                      setError(
                        "Clipboard unavailable. Open the assignment in this browser instead.",
                      );
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy private link"}
                </button>
                <small>
                  Possession grants assignment access. Do not forward it.
                </small>
              </div>
            )}
          </section>
          <section className="panel dark-panel">
            <p className="eyebrow">02 / FIELD CHECK</p>
            <h2>
              Ready for the
              <br />
              no-signal test?
            </h2>
            <ol>
              <li>Open your practice link and download.</li>
              <li>Wait for “Ready offline.”</li>
              <li>Go offline, record a visit, and reopen.</li>
              <li>Reconnect, sync, and refresh these results.</li>
            </ol>
            <p className="fine">
              A desktop test does not replace testing Safari and Chrome on the
              two physical phones.
            </p>
          </section>
        </div>
        <section className="panel results-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">03 / RECEIVED ACTIVITY</p>
              <h2>What happened at the door</h2>
            </div>
            <button onClick={refresh} disabled={busy}>
              {busy ? "Loading…" : "Refresh results"}
            </button>
          </div>
          <p className="muted">
            Only server-received work appears here.{" "}
            {data ? `${data.counts.repeats} repeat visits.` : ""}
          </p>
          {!data?.visits.length ? (
            <div className="empty">
              <span aria-hidden="true">◎</span>
              <h3>No visits received yet</h3>
              <p>Save a visit on the phone, then tap Sync now.</p>
            </div>
          ) : (
            <div className="result-list">
              {data.visits.map((v) => (
                <div className="result-row" key={v.id}>
                  <div>
                    <strong>
                      {v.address}
                      {v.unit ? ` · ${v.unit}` : ""}
                    </strong>
                    <small>{outcomes[v.result]}</small>
                  </div>
                  <span className="received">Received</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <footer className="footer">
          Informational outreach, never an eligibility determination.{" "}
          <span>Synthetic field + import rehearsal</span>
        </footer>
      </main>
    </div>
  );
}
