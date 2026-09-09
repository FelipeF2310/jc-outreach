"use client";
import { useEffect, useState } from "react";

type Identity = { id: string; email: string };
type Campaign = { id: string; name: string; deletionAt: string };
export function AdminSignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(true);
  const [identity, setIdentity] = useState<Identity>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>();
  async function api(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`/api/admin/${path}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "X-JCO-Admin": "1",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Administrator access unavailable.");
    return result;
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/session", {
      cache: "no-store",
      headers: { "X-JCO-Admin": "1" },
    })
      .then(async (response) => {
        const body = await response.json();
        if (!active) return;
        if (response.ok) setIdentity(body.administrator);
        else if (response.status !== 401) setError(body.error);
      })
      .catch(() => {
        if (active)
          setError("Unable to check administrator sign-in. Please retry.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: "send" | "verify" | "signout" | "campaigns") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "send") {
        const result = await api("send-code", "POST", { email });
        setSent(true);
        setMessage(result.message);
      } else if (action === "verify") {
        const result = await api("verify-code", "POST", { email, code });
        setIdentity(result.administrator);
        setCode("");
      } else if (action === "signout") {
        await api("session", "DELETE");
        setIdentity(undefined);
        setCampaigns(undefined);
        setSent(false);
        setCode("");
        setMessage("Signed out.");
      } else {
        setCampaigns(undefined);
        const result = await api("campaigns");
        setCampaigns(result.campaigns);
      }
    } catch (e) {
      if (action === "signout") {
        setIdentity(undefined);
        setCampaigns(undefined);
      }
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-sign-in">
      <p className="eyebrow">JERSEY CITY BENEFITS OUTREACH</p>
      <h1>Administrator access</h1>
      <p>
        For approved organizers only. Volunteers still use their private
        assignment links—no account needed.
      </p>
      <p className="fine">
        Hosted synthetic preview only. This is separate from the local practice
        console. Real resident uploads remain disabled.
      </p>
      {identity ? (
        <section aria-label="Signed-in administrator">
          <h2>Signed in</h2>
          <p>{identity.email}</p>
          <div className="import-assignment-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run("campaigns")}
            >
              Load synthetic campaigns
            </button>
            <button disabled={busy} onClick={() => void run("signout")}>
              Sign out
            </button>
          </div>
          {campaigns && (
            <div aria-label="Synthetic campaigns">
              <h2>Campaigns</h2>
              {campaigns.length === 0 ? (
                <p>
                  No active synthetic campaigns. Campaign creation is the next
                  implementation step.
                </p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.id} className="result-row">
                    <div>
                      <strong>{campaign.name}</strong>
                      <small>
                        Deletion scheduled:{" "}
                        {new Date(campaign.deletionAt).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                        })}{" "}
                        ET
                      </small>
                    </div>
                  </div>
                ))
              )}
              <p className="fine">Automatic deletion is not connected yet.</p>
            </div>
          )}
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(sent ? "verify" : "send");
          }}
        >
          <label className="import-label">
            Administrator email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              disabled={busy || sent}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {sent && (
            <label className="import-label">
              Six-digit sign-in code
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                maxLength={6}
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
          <div className="import-assignment-actions">
            <button className="primary" disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : sent
                  ? "Verify code"
                  : "Send sign-in code"}
            </button>
            {sent && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setMessage("");
                }}
              >
                Use a different email or request another code
              </button>
            )}
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="admin-feedback">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error admin-feedback">
          {error}
        </p>
      )}
    </main>
  );
}
