import { openDB, type DBSchema } from "idb";
import {
  completionReportSchema,
  completionReceiptSchema,
  type CompletionReport,
  type CompletionReceipt,
} from "./completion-contracts";
import {
  operationSchema,
  type Assignment,
  type Operation,
  type Receipt,
} from "./contracts";

export type StoredAssignment = {
  key: "active";
  assignment: Assignment;
  token: string;
  sequence: number;
  deviceId?: string;
  reportVersion?: number;
  finished?: boolean;
  report?: {
    payload: CompletionReport;
    receipt?: CompletionReceipt;
    rejection?: string;
  };
};
export type LocalRecord = {
  id: string;
  sequence: number;
  operation: Operation;
  receipt?: Receipt;
  rejection?: string;
};

function refreshReport(current: StoredAssignment, records: LocalRecord[]) {
  if (!current.assignment.completionReady) return;
  current.deviceId ??= crypto.randomUUID();
  const operationIds = records.map((r) => r.id);
  if (operationIds.length > 2000)
    throw Error(
      "This browser has reached the practice assignment's 2,000-record limit. Previously saved work is unchanged. Contact your organizer.",
    );
  const pendingIds = records.filter((r) => !r.receipt).map((r) => r.id);
  const state = current.finished ? "finished" : "working";
  const previous = current.report?.payload;
  if (
    previous?.state === state &&
    JSON.stringify(previous.operationIds) === JSON.stringify(operationIds) &&
    JSON.stringify(previous.pendingIds) === JSON.stringify(pendingIds)
  )
    return;
  const version = (current.reportVersion ?? 0) + 1;
  const payload = completionReportSchema.parse({
    id: crypto.randomUUID(),
    assignmentId: current.assignment.id,
    deviceId: current.deviceId,
    version,
    state,
    operationIds,
    pendingIds,
    createdAt: new Date().toISOString(),
  });
  current.reportVersion = version;
  current.report = { payload };
}

export async function captureCompletion(finished?: boolean) {
  const db = await localDatabase();
  try {
    const tx = db.transaction(["assignments", "operations"], "readwrite", {
      durability: "strict",
    });
    try {
      const current = await tx.objectStore("assignments").get("active");
      if (!current || !current.assignment.completionReady) {
        await tx.done;
        return;
      }
      if (
        Date.now() >= Date.parse(current.assignment.deletionAt) ||
        Date.now() >= Date.parse(current.assignment.eventEndsAt) + 72 * 3600000
      )
        throw Error(
          "The campaign or synchronization window has ended. Saved work is unchanged.",
        );
      if (finished !== undefined) current.finished = finished;
      const records = await tx
        .objectStore("operations")
        .index("sequence")
        .getAll();
      refreshReport(current, records);
      await tx.objectStore("assignments").put(current);
      await tx.done;
      return current;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already complete. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
  } finally {
    db.close();
  }
}

async function syncCompletion() {
  const current = await captureCompletion();
  const report = current?.report;
  if (!current || !report || report.receipt || report.rejection) return;
  let response: Response;
  try {
    response = await fetch("/api/completion", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${current.token}`,
      },
      body: JSON.stringify(report.payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Error(
      "Walk status upload interrupted. Saved work remains on this device; retry when connected.",
    );
  }
  if (
    !response.ok &&
    (response.status >= 500 || [408, 424, 429].includes(response.status))
  )
    throw Error(
      "Walk status upload interrupted. Retry when connected; saved work is unchanged.",
    );
  let receipt: CompletionReceipt | undefined;
  if (response.ok) {
    try {
      receipt = completionReceiptSchema.parse(await response.json());
    } catch {
      throw Error(
        "Walk status receipt could not be verified. Saved work is unchanged; retry when connected.",
      );
    }
  }
  if (receipt && receipt.reportId !== report.payload.id)
    throw Error("Walk status receipt could not be verified.");
  const db = await localDatabase();
  try {
    const tx = db.transaction("assignments", "readwrite", {
      durability: "strict",
    });
    const latest = await tx.store.get("active");
    if (latest?.report?.payload.id === report.payload.id) {
      if (receipt) {
        latest.report.receipt = receipt;
        delete latest.report.rejection;
      } else if (!latest.report.receipt) {
        const reasons: Record<number, string> = {
          401: "This assignment link is unavailable.",
          403: "This link is revoked or the report is outside its assignment.",
          409: "Walk status conflicts with an existing report.",
          410: "The campaign or synchronization window has expired.",
          422: "Walk status did not pass validation.",
        };
        latest.report.rejection = `${reasons[response.status] ?? "Walk status was rejected."} Contact the organizer; it remains saved on this device.`;
      }
      await tx.store.put(latest);
    }
    await tx.done;
  } finally {
    db.close();
  }
}
interface LocalSchema extends DBSchema {
  assignments: { key: string; value: StoredAssignment };
  operations: {
    key: string;
    value: LocalRecord;
    indexes: { sequence: number };
  };
}
export function localDatabase() {
  return openDB<LocalSchema>("jco-field-v1", 1, {
    upgrade(db) {
      db.createObjectStore("assignments", { keyPath: "key" });
      db.createObjectStore("operations", { keyPath: "id" }).createIndex(
        "sequence",
        "sequence",
        { unique: true },
      );
    },
    blocked() {
      throw new Error(
        "Close other tabs of this app, then reopen it. Saved work has not been deleted.",
      );
    },
    blocking() {
      /* Schema migrations are deferred; version 1 is never destructively recreated. */
    },
  });
}
export async function readLocal() {
  const db = await localDatabase();
  try {
    const tx = db.transaction(["assignments", "operations"], "readwrite");
    const assignment = await tx.objectStore("assignments").get("active");
    if (
      assignment &&
      Date.now() >= Date.parse(assignment.assignment.deletionAt)
    ) {
      await tx.objectStore("assignments").clear();
      await tx.objectStore("operations").clear();
      await tx.done;
      return { assignment: undefined, records: [], expired: true };
    }
    const records = await tx
      .objectStore("operations")
      .index("sequence")
      .getAll();
    await tx.done;
    return { assignment, records, expired: false };
  } finally {
    db.close();
  }
}
export async function storeAssignment(assignment: Assignment, token: string) {
  if (Date.now() >= Date.parse(assignment.deletionAt))
    throw new Error("This campaign has expired.");
  const db = await localDatabase();
  try {
    const tx = db.transaction(["assignments", "operations"], "readwrite", {
      durability: "strict",
    });
    const current = await tx.objectStore("assignments").get("active");
    const records = await tx.objectStore("operations").getAll();
    if (
      current &&
      (current.token !== token || current.assignment.id !== assignment.id) &&
      (records.some((r) => !r.receipt) ||
        (current.report && !current.report.receipt))
    ) {
      await tx.done;
      throw new Error(
        "This browser has pending work for another link. Sync that work first; it has not been replaced.",
      );
    }
    const same = current?.assignment.id === assignment.id;
    // Refresh cannot undo a suppression that has not reached the server yet.
    for (const h of assignment.households) {
      if (
        records.some(
          (r) =>
            !r.receipt &&
            r.operation.kind === "visit" &&
            r.operation.householdId === h.id &&
            r.operation.doNotContact,
        )
      )
        h.suppressed = true;
    }
    const next: StoredAssignment = {
      ...(same ? current! : {}),
      key: "active",
      assignment,
      token,
      sequence: same ? current!.sequence : 0,
    };
    try {
      if (next.report || (same && records.length))
        refreshReport(
          next,
          same ? records.sort((a, b) => a.sequence - b.sequence) : [],
        );
      if (!same) await tx.objectStore("operations").clear();
      await tx.objectStore("assignments").put(next);
      await tx.done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already complete. */
      }
      await tx.done.catch(() => {});
      throw error;
    }
    if (!(await db.get("assignments", "active")))
      throw new Error("Could not verify assignment storage.");
  } finally {
    db.close();
  }
}
export async function saveOperation(input: Operation) {
  const operation = operationSchema.parse(input);
  const db = await localDatabase();
  try {
    const tx = db.transaction(["assignments", "operations"], "readwrite", {
      durability: "strict",
    });
    const current = await tx.objectStore("assignments").get("active");
    if (
      !current ||
      current.assignment.id !== operation.assignmentId ||
      Date.now() >= Date.parse(current.assignment.deletionAt) ||
      Date.now() >= Date.parse(current.assignment.eventEndsAt)
    ) {
      await tx.done;
      throw new Error(
        "Field work has ended or this assignment is unavailable. Previously saved work is unchanged.",
      );
    }
    // A refresh may remove reassigned doors while another tab still has an old form.
    // Preserve the outbox, but do not create fresh outreach for a no-longer-active door.
    if (
      (operation.kind === "visit" &&
        !current.assignment.households.some(
          (h) => h.id === operation.householdId,
        )) ||
      (operation.kind === "building" &&
        !current.assignment.households.some(
          (h) => h.buildingId === operation.buildingId,
        ))
    ) {
      await tx.done;
      throw new Error(
        "This door or building is no longer in your active assignment. Refresh the list. Previously saved work is unchanged.",
      );
    }
    current.sequence++;
    const records = await tx
      .objectStore("operations")
      .index("sequence")
      .getAll();
    refreshReport(current, [
      ...records,
      { id: operation.id, sequence: current.sequence, operation },
    ]);
    if (operation.kind === "visit" && operation.doNotContact) {
      const household = current.assignment.households.find(
        (h) => h.id === operation.householdId,
      );
      if (household) household.suppressed = true;
    }
    // Both the outbox and suppression state commit, or neither does.
    const done = tx.done;
    const writes: Promise<unknown>[] = [];
    try {
      writes.push(tx.objectStore("assignments").put(current));
      writes.push(
        tx
          .objectStore("operations")
          .add({ id: operation.id, sequence: current.sequence, operation }),
      );
      await Promise.all([...writes, done]);
    } catch (error) {
      // Synchronous exceptions must also abort, so an earlier queued write
      // cannot commit a suppression without its accompanying visit operation.
      try {
        tx.abort();
      } catch {
        /* Already aborted or completed. */
      }
      await Promise.allSettled([...writes, done]);
      throw error;
    }
  } finally {
    db.close();
  }
}
async function updateRecord(id: string, update: (record: LocalRecord) => void) {
  const db = await localDatabase();
  try {
    const tx = db.transaction("operations", "readwrite", {
      durability: "strict",
    });
    const record = await tx.store.get(id);
    if (record) {
      update(record);
      await tx.store.put(record);
    }
    await tx.done;
  } finally {
    db.close();
  }
}
export async function syncLocal(onProgress: () => void) {
  const snapshot = await readLocal();
  if (!snapshot.assignment) throw new Error("No active assignment is stored.");
  const token = snapshot.assignment.token;
  await syncCompletion();
  onProgress();
  let rejected = 0;
  for (const row of snapshot.records) {
    if (row.receipt || row.rejection) continue;
    let response: Response;
    try {
      response = await fetch("/api/operations", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(row.operation),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        "Upload interrupted. Your work is still saved on this device. Retry when connected.",
      );
    }
    const payload = await response.json();
    if (!response.ok) {
      if (response.status >= 500 || [408, 424, 429].includes(response.status))
        throw new Error(
          "Upload interrupted. Your work is still saved on this device. Retry later.",
        );
      await updateRecord(row.id, (record) => {
        if (!record.receipt)
          record.rejection =
            payload.error ?? "Record rejected. Contact your organizer.";
      });
      rejected++;
      onProgress();
      continue;
    }
    if (
      payload.operationId !== row.id ||
      typeof payload.receivedAt !== "string"
    )
      throw new Error(
        "Server receipt could not be verified. Work remains saved on this device.",
      );
    await updateRecord(row.id, (record) => {
      record.receipt = payload;
      delete record.rejection;
    });
    onProgress();
  }
  await syncCompletion();
  onProgress();
  return { rejected };
}

export async function prepareOfflineShell() {
  if (!window.isSecureContext || !("serviceWorker" in navigator))
    throw new Error(
      "Offline setup needs HTTPS or localhost in a supported browser.",
    );
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const changed = () => {
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          changed,
        );
        resolve();
      };
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          changed,
        );
        reject(
          new Error(
            "The offline worker is not controlling this page yet. Reload while online and retry.",
          ),
        );
      }, 10000);
      navigator.serviceWorker.addEventListener("controllerchange", changed);
    });
  }
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(
        new Error(
          "Offline shell could not be confirmed. Retry while connected.",
        ),
      );
    }, 20000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ready) resolve();
      else
        reject(
          new Error(
            "Offline shell could not be stored. Do not begin field work yet.",
          ),
        );
    };
    registration.active?.postMessage({ type: "PREPARE_OFFLINE" }, [
      channel.port2,
    ]);
  });
  // A persistence grant is best effort, not a prerequisite or a permanent-storage guarantee.
  await navigator.storage?.persist?.().catch(() => false);
}
