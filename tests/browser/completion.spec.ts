import { test, expect, type Page } from "@playwright/test";
import { createServer, request as proxyRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { StoredAssignment } from "../../src/lib/local-store";
import type { CompletionSnapshot } from "../../src/lib/completion-contracts";

async function stored(page: Page): Promise<StoredAssignment> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("jco-field-v1", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            read = db
              .transaction("assignments")
              .objectStore("assignments")
              .get("active");
          read.onsuccess = () => {
            db.close();
            resolve(read.result);
          };
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
        };
      }),
  );
}
async function open(page: Page, origin = "") {
  const issued = await page.request.post(`${origin}/api/demo`, {
    headers: { "X-JCO-Demo": "1" },
  });
  expect(issued.ok()).toBeTruthy();
  const { token } = await issued.json();
  await page.goto(`${origin}/field#key=${token}`);
  await page
    .getByRole("button", { name: "Download assignment", exact: true })
    .click();
  await expect(page.getByText("Ready offline", { exact: true })).toBeVisible();
}
async function finish(page: Page) {
  const back = page.getByRole("button", { name: "← All households" });
  if (await back.isVisible()) await back.click();
  await page
    .getByRole("button", { name: "Field work finished", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm field work finished", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Field work finished — waiting to sync",
      exact: true,
    }),
  ).toBeVisible();
}
async function serverDevice(page: Page, current: StoredAssignment) {
  const response = await page.request.get("/api/demo", {
    headers: { "X-JCO-Demo": "1" },
  });
  const body = await response.json();
  const row = body.completion.find(
    (r: { assignmentId: string }) => r.assignmentId === current.assignment.id,
  );
  return (row.snapshot as CompletionSnapshot).devices.find(
    (d) => d.deviceId === current.deviceId,
  )!;
}

test("offline finish survives reopen; missing records and lost status receipts do not falsely finish the walk", async ({
  page,
  context,
}) => {
  let disconnected = false,
    failOperations = true;
  const proxy = createServer((req, res) => {
    if (disconnected) {
      req.socket.destroy();
      return;
    }
    if (req.url === "/api/operations" && failOperations) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Synthetic interruption" }));
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
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    await open(page, origin);
    disconnected = true;
    await page.getByRole("button", { name: /Unit 10B/ }).click();
    await page.getByLabel("No answer", { exact: true }).check();
    await page.getByRole("button", { name: "Save & next" }).click();
    await finish(page);
    const saved = await stored(page);
    expect(saved.report!.payload.operationIds).toHaveLength(1);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/field`);
    await expect(
      reopened.getByRole("heading", {
        name: "Field work finished — waiting to sync",
        exact: true,
      }),
    ).toBeVisible();
    expect((await stored(reopened)).report).toEqual(saved.report);
    disconnected = false;
    // Discard the receipt after a real server commit. A raw connection reset
    // may be retried transparently by the browser before fetch rejects.
    await reopened.evaluate(() => {
      const fetch = window.fetch.bind(window);
      let lost = false;
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (!lost && args[0] === "/api/completion" && response.ok) {
          lost = true;
          throw new TypeError("Synthetic lost completion acknowledgment");
        }
        return response;
      };
    });
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened
        .getByRole("alert")
        .filter({ hasText: "Walk status upload interrupted" }),
    ).toBeVisible();
    let device = await serverDevice(reopened, saved);
    expect(device.state).toBe("finished");
    expect(device.missingCount).toBe(1);
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened.getByRole("alert").filter({ hasText: "Upload interrupted" }),
    ).toBeVisible();
    await expect(
      reopened.getByRole("heading", {
        name: "Finished and synchronized",
        exact: true,
      }),
    ).toHaveCount(0);
    failOperations = false;
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", {
        name: "Finished and synchronized",
        exact: true,
      }),
    ).toBeVisible();
    device = await serverDevice(reopened, await stored(reopened));
    expect(device.missingCount).toBe(0);
    expect(device.pendingReportedCount).toBe(0);
    await expect(
      reopened.getByText("1 received by server", { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByText("1 of 3 households recorded", { exact: true }),
    ).toBeVisible();
    for (const width of [320, 390, 1280]) {
      await reopened.setViewportSize({ width, height: 844 });
      expect(
        await reopened.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await reopened.setViewportSize({ width: 390, height: 844 });
    await reopened
      .getByRole("region", { name: "Walk completion", exact: true })
      .screenshot({
        path: `test-results/completion-${test.info().project.name}.png`,
      });
    await reopened.getByRole("button", { name: /Unit 10B/ }).click();
    await reopened.getByLabel("No answer", { exact: true }).check();
    await reopened.getByRole("button", { name: "Save & next" }).click();
    const back = reopened.getByRole("button", { name: "← All households" });
    if (await back.isVisible()) await back.click();
    await expect(
      reopened.getByRole("heading", {
        name: "Field work finished — waiting to sync",
        exact: true,
      }),
    ).toBeVisible();
    failOperations = true;
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened.getByRole("alert").filter({ hasText: "Upload interrupted" }),
    ).toBeVisible();
    expect(
      (await serverDevice(reopened, await stored(reopened))).missingCount,
    ).toBe(1);
    failOperations = false;
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", {
        name: "Finished and synchronized",
        exact: true,
      }),
    ).toBeVisible();
    await reopened
      .getByRole("button", { name: "Resume field work", exact: true })
      .click();
    await expect(
      reopened.getByRole("heading", { name: "Walk in progress", exact: true }),
    ).toBeVisible();
    await reopened.reload();
    expect((await stored(reopened)).finished).toBe(false);
    await reopened
      .getByRole("button", { name: "Sync now", exact: true })
      .click();
    await expect(
      reopened.getByText("All records received", { exact: true }),
    ).toBeVisible();
    expect((await serverDevice(reopened, await stored(reopened))).state).toBe(
      "working",
    );
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("finishing an empty walk is atomic and adds no door attempts; a failed local save remains unfinished", async ({
  page,
}) => {
  await open(page);
  const before = await stored(page);
  await page
    .getByRole("button", { name: "Field work finished", exact: true })
    .click();
  await expect(
    page.getByText(
      "3 households have no recorded visit on this device. Finish the walk for now?",
      { exact: true },
    ),
  ).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "assignments" && args[0]?.finished) {
        IDBObjectStore.prototype.put = put;
        throw new DOMException(
          "Synthetic completion save failure",
          "QuotaExceededError",
        );
      }
      return put.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "Confirm field work finished", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Walk status could not be saved" }),
  ).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Confirm field work finished", exact: true })
    .click();
  await expect(
    page.getByText("Walk status waiting to sync", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Finished and synchronized",
      exact: true,
    }),
  ).toBeVisible();
  expect((await stored(page)).sequence).toBe(0);
  const device = await serverDevice(page, await stored(page));
  expect(device.declaredCount).toBe(0);
  expect(device.missingCount).toBe(0);
  await expect(
    page.getByText("0 of 3 households recorded", { exact: true }),
  ).toBeVisible();
});

test("a late completion acknowledgment cannot replace a newer status saved in another tab", async ({
  page,
  context,
}) => {
  await open(page);
  await finish(page);
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    let held = false;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      if (args[0] === "/api/completion" && !held) {
        held = true;
        await new Promise<void>((resolve) => {
          Reflect.set(window, "releaseCompletionReceipt", resolve);
        });
      }
      return response;
    };
  });
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof Reflect.get(window, "releaseCompletionReceipt"),
      ),
    )
    .toBe("function");
  const other = await context.newPage();
  await other.goto("/field");
  await other
    .getByRole("button", { name: "Resume field work", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "Walk in progress", exact: true }),
  ).toBeVisible();
  const newer = (await stored(other)).report!.payload;
  await page.evaluate(() => Reflect.get(window, "releaseCompletionReceipt")());
  await expect(
    page.getByRole("heading", { name: "Walk in progress", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => !!(await stored(page)).report?.receipt)
    .toBe(true);
  const latest = await stored(page);
  expect(latest.report!.payload).toEqual(newer);
  expect(latest.report!.receipt!.reportId).toBe(newer.id);
  expect((await serverDevice(page, latest)).state).toBe("working");
});
