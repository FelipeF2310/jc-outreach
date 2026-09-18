"use client";
import { useRef, useState } from "react";
import type {
  AssignmentSave,
  AssignmentWorkspace,
} from "@/lib/assignment-admin-contracts";

type Move = Extract<AssignmentSave, { action: "reassign" }>;
export function ReassignDoors({
  assignment,
  workspace,
  disabled,
  onMove,
}: {
  assignment: AssignmentWorkspace["assignments"][number];
  workspace: AssignmentWorkspace;
  disabled: boolean;
  onMove: (request: Move) => Promise<boolean>;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const ended =
    Date.now() >=
    Date.parse(
      workspace.events.find((e) => e.id === assignment.eventId)?.endsAt ?? "",
    );
  return (
    <details className="assignment-doors" ref={disclosure}>
      <summary>Reassign doors</summary>
      <p className="fine">
        Move selected doors into a new assignment in the same event. Previously
        saved visits stay with this assignment. This does not revoke its links.
      </p>
      <p className="fine">
        An offline volunteer will not see the change until they refresh. Tell
        both volunteers about the handoff.
      </p>
      {ended ? (
        <p>Field work has ended. Doors cannot be reassigned.</p>
      ) : (
        <form
          aria-label={`Reassign doors from ${assignment.name}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!confirmed || disabled) return;
            const saved = await onMove({
              action: "reassign",
              id: crypto.randomUUID(),
              campaignId: workspace.campaignId,
              sourceId: assignment.id,
              name,
              confirmed: true,
              householdIds: assignment.householdIds.filter((id) =>
                picked.includes(id),
              ),
            });
            if (saved) {
              setPicked([]);
              setName("");
              setConfirmed(false);
              if (disclosure.current) disclosure.current.open = false;
            }
          }}
        >
          {assignment.householdIds.map((id) => {
            const h = workspace.households.find((h) => h.id === id);
            return h ? (
              <label className="check-row" key={id}>
                <input
                  type="checkbox"
                  checked={picked.includes(id)}
                  disabled={disabled || h.suppressed}
                  onChange={(e) => {
                    setPicked((values) =>
                      e.target.checked
                        ? [...values, id]
                        : values.filter((v) => v !== id),
                    );
                    setConfirmed(false);
                  }}
                />
                <span>
                  {h.address}
                  {h.unit ? ` · Unit ${h.unit}` : ""}
                  {h.suppressed && (
                    <>
                      <br />
                      <small>Do not contact · cannot reassign</small>
                    </>
                  )}
                </span>
              </label>
            ) : null;
          })}
          <label className="import-label">
            New assignment / volunteer label
            <input
              required
              maxLength={100}
              value={name}
              disabled={disabled}
              onChange={(e) => {
                setName(e.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <p className="fine">
            The new assignment keeps this event, assignment type and selected
            door order. No volunteer link is issued automatically.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled || !picked.length || !name.trim()}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              Move{" "}
              {picked.length === 1
                ? "this 1 selected door"
                : `these ${picked.length} selected doors`}
              . Old offline copies may still exist; pending visits must be
              synchronized.
            </span>
          </label>
          <button
            type="submit"
            disabled={disabled || !confirmed || !picked.length || !name.trim()}
          >
            Move selected doors
          </button>
        </form>
      )}
    </details>
  );
}
