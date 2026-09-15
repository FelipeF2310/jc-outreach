"use client";
import { useEffect, useState } from "react";
import { CampaignCreate, type HostedCampaign } from "./campaign-create";
import { CampaignImport } from "./campaign-import";
import { CampaignAssignments } from "./campaign-assignments";

type Identity = { id: string; email: string };
export function AdminSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(true);
  const [identity, setIdentity] = useState<Identity>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [campaigns, setCampaigns] = useState<HostedCampaign[]>();
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState("");
  const [campaignRefresh, setCampaignRefresh] = useState(0);
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
  const administratorId = identity?.id;
  useEffect(() => {
    if (!administratorId) return;
    let active = true;
    const controller = new AbortController();
    setCampaignsLoading(true);
    setCampaignsError("");
    void fetch("/api/admin/campaigns", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-JCO-Admin": "1" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Unable to load saved campaigns.");
        if (active) setCampaigns(body.campaigns);
      })
      .catch((failure: unknown) => {
        if (active)
          setCampaignsError(
            failure instanceof Error
              ? failure.message
              : "Unable to load saved campaigns.",
          );
      })
      .finally(() => {
        if (active) setCampaignsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [administratorId, campaignRefresh]);
  async function run(action: "signin" | "signout") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "signin") {
        const result = await api("sign-in", "POST", { email, password });
        setIdentity(result.administrator);
      } else if (action === "signout") {
        await api("session", "DELETE");
        setIdentity(undefined);
        setCampaigns(undefined);
        setMessage("Signed out.");
      }
    } catch (e) {
      if (action === "signout") {
        setIdentity(undefined);
        setCampaigns(undefined);
      }
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      if (action === "signin" || action === "signout") setPassword("");
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
              disabled={busy || campaignsLoading}
              onClick={() => setCampaignRefresh((value) => value + 1)}
            >
              {campaignsLoading
                ? "Loading campaigns…"
                : campaignsError
                  ? "Retry loading campaigns"
                  : "Refresh campaigns"}
            </button>
            <button disabled={busy} onClick={() => void run("signout")}>
              Sign out
            </button>
          </div>
          {campaignsLoading && <p role="status">Loading saved campaigns…</p>}
          {campaignsError && (
            <p role="alert" className="error admin-feedback">
              {campaignsError} Your saved campaigns have not been cleared. Retry
              loading; do not re-enter them in the creation form.
            </p>
          )}
          <CampaignCreate
            key={identity.id}
            administratorId={identity.id}
            onCreated={(campaign) => {
              setCampaigns((existing) => [
                campaign,
                ...(existing ?? []).filter((row) => row.id !== campaign.id),
              ]);
              // Replace any older list request with a fresh server read after saving.
              setCampaignRefresh((value) => value + 1);
            }}
          />
          {campaigns && (
            <div className="campaign-list" aria-label="Synthetic campaigns">
              <h2>Campaigns</h2>
              {campaigns.length === 0 ? (
                <p>
                  No active synthetic campaigns. Create a practice campaign
                  above.
                </p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.id} className="result-row">
                    <div>
                      <strong>{campaign.name}</strong>
                      <small>
                        Campaign ends:{" "}
                        {campaign.endAt
                          ? new Date(campaign.endAt).toLocaleString("en-US", {
                              timeZone: "America/New_York",
                              timeZoneName: "short",
                            })
                          : "Not recorded in this earlier practice campaign"}
                      </small>
                      <small>
                        Deletion scheduled:{" "}
                        {new Date(campaign.deletionAt).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                        })}{" "}
                        ET
                      </small>
                      <CampaignImport
                        campaignId={campaign.id}
                        receipt={campaign.importReceipt}
                        ready={campaign.importReady === true}
                        onFinalized={(receipt) => {
                          setCampaigns((values) =>
                            values?.map((value) =>
                              value.id === campaign.id
                                ? { ...value, importReceipt: receipt }
                                : value,
                            ),
                          );
                          setCampaignRefresh((value) => value + 1);
                        }}
                      />
                      {campaign.importReceipt && (
                        <CampaignAssignments
                          campaignId={campaign.id}
                          administratorId={identity.id}
                          deletionAt={campaign.deletionAt}
                          ready={campaign.assignmentsReady === true}
                          fieldReady={campaign.fieldReady === true}
                        />
                      )}
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
            void run("signin");
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
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="import-label">
            Password
            <input
              type="password"
              autoComplete="current-password"
              aria-describedby="password-help"
              required
              maxLength={1024}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p id="password-help" className="fine">
            Use your outreach administrator account password. If you need a
            password or have forgotten it, contact the website owner.
            Self-service password recovery is not available in this preview.
          </p>
          <div className="import-assignment-actions">
            <button className="primary" disabled={busy} type="submit">
              {busy ? "Please wait…" : "Sign in"}
            </button>
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
