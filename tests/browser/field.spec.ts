import { test, expect, type Page } from "@playwright/test";
import { createServer, request as proxyRequest } from "node:http";
import type { AddressInfo } from "node:net";

async function openAssignment(page: Page, origin = "") {
  const response = await page.request.post(`${origin}/api/demo`, {
    headers: { "X-JCO-Demo": "1" },
  });
  expect(response.ok()).toBeTruthy();
  const { token } = await response.json();
  await page.goto(`${origin}/field#key=${token}`);
  await page
    .getByRole("button", { name: "Download assignment", exact: true })
    .click();
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/field$/);
  return token as string;
}

test("offline saved visit and help survive closing the page, sync and appear in admin", async ({
  page,
  context,
}) => {
  // A real disconnected loopback proxy exercises native service workers on BOTH engines.
  // Playwright's service-worker network controls are Chromium-only:
  // https://playwright.dev/docs/service-workers
  let disconnected = false;
  const proxy = createServer((req, res) => {
    if (disconnected) {
      req.socket.destroy();
      return;
    }
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3100,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.destroy();
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    await openAssignment(page, origin);
    disconnected = true;
    expect(
      await page.evaluate(async () => {
        try {
          await fetch("/api/assignment", { cache: "no-store" });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBeTruthy();
    await page.reload();
    await expect(
      page.getByText("Ready offline", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Unit 10B/ }).click();
    await page.getByLabel("Spoke with resident", { exact: true }).check();
    await page.getByLabel("Wants application help").check();
    await page.getByRole("button", { name: "Save & next" }).click();
    await expect(
      page.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/field`);
    await expect(
      reopened.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    disconnected = false;
    await reopened.getByRole("button", { name: "Sync now" }).click();
    await expect(
      reopened.getByText("All records received", { exact: true }),
    ).toBeVisible();
    const admin = await context.newPage();
    await admin.goto("/");
    await expect(
      admin.getByText("100 FIXTURE WALK · 10B").first(),
    ).toBeVisible();
    await expect(
      admin.getByText("Spoke with resident", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("lost acknowledgment retries safely; a saved edit is a revision, not another visit", async ({
  page,
}) => {
  await openAssignment(page);
  const beforeResponse = await page.request.get("/api/demo", {
    headers: { "X-JCO-Demo": "1" },
  });
  const before = await beforeResponse.json();
  await page.getByRole("button", { name: /Unit 10B/ }).click();
  await page.getByLabel("No answer", { exact: true }).check();
  await page.getByRole("button", { name: "Save & next" }).click();
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window);
    let lost = false;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (!lost && args[0] === "/api/operations" && response.ok) {
        lost = true;
        throw new TypeError(
          "Synthetic lost acknowledgment after actual server commit",
        );
      }
      return response;
    };
  });
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Upload interrupted" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All households" }).click();
  await page.getByRole("button", { name: /Unit 10B/ }).click();
  await page.getByRole("button", { name: "Edit result" }).click();
  await page.getByLabel("Spoke with resident", { exact: true }).check();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByText("2 waiting to sync", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    page.getByText("All records received", { exact: true }),
  ).toBeVisible();
  const after = await (
    await page.request.get("/api/demo", { headers: { "X-JCO-Demo": "1" } })
  ).json();
  expect(after.visits.length).toBe(before.visits.length + 1);
  expect(after.visits[0].result).toBe("resident");
});

test("blocked building does not mark household doors attempted", async ({
  page,
}) => {
  await openAssignment(page);
  const before = await (
    await page.request.get("/api/demo", { headers: { "X-JCO-Demo": "1" } })
  ).json();
  await page
    .getByRole("button", { name: "Cannot access building", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Locked lobby / entrance", exact: true })
    .click();
  await expect(page.getByText("0 of 3 households recorded")).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    page.getByText("All records received", { exact: true }),
  ).toBeVisible();
  const after = await (
    await page.request.get("/api/demo", { headers: { "X-JCO-Demo": "1" } })
  ).json();
  expect(after.counts.attempts).toBe(before.counts.attempts);
  expect(after.counts.buildings).toBe(before.counts.buildings + 1);
});

test("phone without consent can be removed without losing the underlying help request", async ({
  page,
}) => {
  await openAssignment(page);
  await page.getByRole("button", { name: /Unit 10B/ }).click();
  await page.getByLabel("Spoke with resident", { exact: true }).check();
  await page.getByLabel("Wants application help").check();
  await page.getByLabel("Phone number — optional").fill("555-0100");
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Remove the phone number" }),
  ).toBeVisible();
  await expect(
    page.getByText("No pending records", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove phone number", exact: true })
    .click();
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(
    page.getByText("1 waiting to sync", { exact: true }),
  ).toBeVisible();
});

test("permanent server rejection is visible and pending work survives reload", async ({
  page,
}) => {
  const token = await openAssignment(page);
  await page.getByRole("button", { name: /Unit 10B/ }).click();
  await page.getByLabel("No answer", { exact: true }).check();
  await page.getByRole("button", { name: "Save & next" }).click();
  const revoked = await page.request.delete("/api/demo", {
    headers: { "X-JCO-Demo": "1", Authorization: `Bearer ${token}` },
  });
  expect(revoked.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "revoked" })
      .filter({ hasText: "Saved on this device; not received" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText: "This link is revoked or the report is outside its assignment",
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("1 waiting to sync", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Saved on this device; not received" }),
  ).toBeVisible();
});

test("local storage failure does not claim offline readiness", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get: () => {
        throw new Error("Synthetic storage failure");
      },
    });
  });
  const response = await page.request.post("/api/demo", {
    headers: { "X-JCO-Demo": "1" },
  });
  const { token } = await response.json();
  await page.goto(`/field#key=${token}`);
  await page
    .getByRole("button", { name: "Download assignment", exact: true })
    .click();
  await expect(
    page.getByText("Ready offline", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Synthetic storage failure" }),
  ).toBeVisible();
});

test("generic shell has no resident payload and mobile page has no horizontal overflow", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const html = await (await page.request.get("/field")).text();
  expect(html).not.toContain("Resident A");
  expect(html).not.toContain("SYNTHETIC OWNER");
  const token = await openAssignment(page);
  const payload = await (
    await page.request.get("/api/assignment", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).text();
  for (const field of ["Match Rationale", "Owner of Record", "Score", "VANID"])
    expect(payload).not.toContain(field);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/field-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("failed local operation write rolls back suppression and keeps the draft", async ({
  page,
}) => {
  await openAssignment(page);
  await page.getByRole("button", { name: /Unit 10B/ }).click();
  await page.getByLabel("Spoke with resident", { exact: true }).check();
  await page
    .getByText("Resident-reported corrections or requests", { exact: true })
    .click();
  await page.getByLabel("Explicit do-not-contact request").check();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "operations") {
        IDBObjectStore.prototype.add = original;
        throw new DOMException(
          "Synthetic local transaction failure",
          "QuotaExceededError",
        );
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic local transaction failure" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Unit 10B", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No pending records", { exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(
    () =>
      new Promise<{ sequence: number; suppressed: boolean }>(
        (resolve, reject) => {
          const opening = indexedDB.open("jco-field-v1", 1);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const read = db
              .transaction("assignments")
              .objectStore("assignments")
              .get("active");
            read.onsuccess = () => {
              const value = read.result;
              db.close();
              resolve({
                sequence: value.sequence,
                suppressed: value.assignment.households.find(
                  (h: { unit: string }) => h.unit === "10B",
                ).suppressed,
              });
            };
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
          };
        },
      ),
  );
  expect(stored).toEqual({ sequence: 0, suppressed: false });
  await page.getByRole("button", { name: "Save & next" }).click();
  await expect(
    page.getByText("1 waiting to sync", { exact: true }),
  ).toBeVisible();
});
