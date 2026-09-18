"use client";
import { useEffect, useState } from "react";
import type { HostedCampaign } from "./campaign-create";
import { AdminWorkspace } from "./admin-workspace";

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
  const [live, setLive] = useState(false);
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
  // Unmount expired campaign workspaces (including retained one-time links and
  // queue state), even when the administrator leaves this tab open/offline.
  // Server authorization remains authoritative; this is best-effort UI cleanup.
  useEffect(() => {
    if (!campaigns?.length) return;
    const expire = () =>
      setCampaigns((values) => {
        if (!values) return values;
        const active = values.filter(
          (c) => Date.parse(c.deletionAt) > Date.now(),
        );
        return active.length === values.length ? values : active;
      });
    const next = Math.min(...campaigns.map((c) => Date.parse(c.deletionAt)));
    const timeout = window.setTimeout(
      expire,
      Math.max(0, Math.min(next - Date.now(), 2147483647)),
    );
    const interval = window.setInterval(expire, 60_000);
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [campaigns]);
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
        if (active) {
          setCampaigns(body.campaigns);
          setLive(body.live === true);
        }
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
        setLive(false);
        setMessage("Signed out.");
      }
    } catch (e) {
      if (action === "signout") {
        setIdentity(undefined);
        setCampaigns(undefined);
        setLive(false);
      }
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      if (action === "signin" || action === "signout") setPassword("");
      setBusy(false);
    }
  }
  return (
    <main
      className={identity ? "admin-sign-in admin-workspace" : "admin-sign-in"}
    >
      <p className="eyebrow">JERSEY CITY BENEFITS OUTREACH</p>
      <h1>{identity ? "Outreach workspace" : "Administrator access"}</h1>
      {!identity && (
        <p>
          For approved organizers only. Volunteers still use their private
          assignment links—no account needed.
        </p>
      )}
      <p className={identity ? "preview-banner" : "fine"}>
        {live
          ? "Resident outreach · Assigned households only. This app does not determine eligibility."
          : "Synthetic preview · Practice records only. Real resident uploads remain disabled."}
      </p>
      {identity ? (
        <section aria-label="Signed-in administrator">
          <div className="workspace-toolbar account-toolbar">
            <p className="fine">Signed in as {identity.email}</p>
            <div className="workspace-actions">
              <button
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
          </div>
          {campaignsLoading && <p role="status">Loading saved campaigns…</p>}
          {campaignsError && (
            <p role="alert" className="error admin-feedback">
              {campaignsError} Your saved campaigns have not been cleared. Retry
              loading; do not re-enter them in the creation form.
            </p>
          )}
          {campaigns && (
            <AdminWorkspace
              key={identity.id}
              administratorId={identity.id}
              live={live}
              campaigns={campaigns}
              onCreated={(campaign) => {
                setCampaigns((existing) => [
                  campaign,
                  ...(existing ?? []).filter((row) => row.id !== campaign.id),
                ]);
                // Replace any older list request with a fresh server read after saving.
                setCampaignRefresh((value) => value + 1);
              }}
              onFinalized={(campaignId, receipt) => {
                setCampaigns((values) =>
                  values?.map((value) =>
                    value.id === campaignId
                      ? { ...value, importReceipt: receipt }
                      : value,
                  ),
                );
                setCampaignRefresh((value) => value + 1);
              }}
            />
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
