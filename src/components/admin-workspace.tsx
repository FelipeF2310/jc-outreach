"use client";
import { useEffect, useState } from "react";
import { CampaignCreate, type HostedCampaign } from "./campaign-create";
import { CampaignImport } from "./campaign-import";
import { CampaignAssignments } from "./campaign-assignments";
import type { ImportReceipt } from "@/lib/import-contracts";
import { CampaignRetention } from "./retention-status";

export function AdminWorkspace({
  administratorId,
  campaigns,
  onCreated,
  onFinalized,
}: {
  administratorId: string;
  campaigns: HostedCampaign[];
  onCreated: (campaign: HostedCampaign) => void;
  onFinalized: (campaignId: string, receipt: ImportReceipt) => void;
}) {
  const [selected, setSelected] = useState("");
  const key = `jco-selected-campaign:${administratorId}`;
  useEffect(() => {
    try {
      setSelected(sessionStorage.getItem(key) ?? "");
    } catch {
      /* Navigation does not require storage. */
    }
  }, [key]);
  const current =
    campaigns.find((c) => c.id === selected) ??
    campaigns.find((c) => c.importReceipt) ??
    campaigns[0];
  function select(id: string) {
    setSelected(id);
    try {
      sessionStorage.setItem(key, id);
    } catch {
      /* Still usable for this session. */
    }
  }
  const date = (value: string) =>
    new Date(value).toLocaleString("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  return (
    <>
      <section className="workspace-overview" aria-label="Campaign overview">
        <div className="workspace-toolbar">
          {current ? (
            <label className="import-label campaign-picker">
              Current campaign
              <select
                aria-label="Current campaign"
                value={current.id}
                onChange={(e) => select(e.target.value)}
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div>
              <h2>Start your outreach campaign</h2>
              <p>
                No active synthetic campaigns. Create a practice campaign below.
              </p>
            </div>
          )}
        </div>
        <CampaignCreate
          administratorId={administratorId}
          initiallyOpen={campaigns.length === 0}
          onCreated={(campaign) => {
            select(campaign.id);
            onCreated(campaign);
          }}
        />
        {current && (
          <>
            <div className="campaign-dates">
              <span>
                Campaign ends:{" "}
                {current.endAt
                  ? date(current.endAt)
                  : "Not recorded in this earlier practice campaign"}
              </span>
              <span>Deletion scheduled: {date(current.deletionAt)}</span>
            </div>
          </>
        )}
        <CampaignRetention
          key={current?.id ?? "none"}
          campaignId={current?.id ?? null}
        />
      </section>
      {current && (
        <nav className="workspace-nav" aria-label="Campaign sections">
          <a href={`#households-${current.id}`}>Household list</a>
          <a href={`#assignments-${current.id}`}>Volunteer assignments</a>
          <a href={`#results-${current.id}`}>Results &amp; follow-up</a>
        </nav>
      )}
      {/* Keep each campaign's mounted forms/one-time links intact when switching.
        hidden removes inactive controls from keyboard and accessibility navigation. */}
      {campaigns.map((c) => (
        <div
          key={c.id}
          hidden={c.id !== current?.id}
          className="campaign-workspace"
          aria-label={`Workspace for ${c.name}`}
        >
          <section
            id={`households-${c.id}`}
            className="panel workspace-section"
            aria-labelledby={`households-title-${c.id}`}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">PREPARE</p>
                <h2 id={`households-title-${c.id}`}>Household list</h2>
              </div>
              <span className="pill">
                {c.importReceipt ? "IMPORTED" : "NOT IMPORTED"}
              </span>
            </div>
            <CampaignImport
              campaignId={c.id}
              receipt={c.importReceipt}
              ready={c.importReady === true}
              onFinalized={(receipt) => onFinalized(c.id, receipt)}
            />
          </section>
          {c.importReceipt ? (
            <CampaignAssignments
              campaignId={c.id}
              administratorId={administratorId}
              deletionAt={c.deletionAt}
              ready={c.assignmentsReady === true}
              fieldReady={c.fieldReady === true}
            />
          ) : (
            <>
              <section
                id={`assignments-${c.id}`}
                className="panel workspace-section"
                aria-label="Volunteer assignments"
              >
                <p className="eyebrow">ORGANIZE</p>
                <h2>Volunteer assignments</h2>
                <p>
                  Import and review your household list first. Then choose doors
                  for each volunteer.
                </p>
              </section>
              <section
                id={`results-${c.id}`}
                className="panel workspace-section"
                aria-label="Results and follow-up"
              >
                <p className="eyebrow">REVIEW</p>
                <h2>Results &amp; follow-up</h2>
                <p>
                  Received visits will appear here after volunteers have
                  assignments and synchronize their work.
                </p>
              </section>
            </>
          )}
        </div>
      ))}
    </>
  );
}
