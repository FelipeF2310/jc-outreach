import { test, expect, type Page } from "@playwright/test";
import { createServer, request as proxyRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";

async function localRecords(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jco-field-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const request = db
          .transaction("operations")
          .objectStore("operations")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test("refresh detects updates; storage failures, rejected work and incompatible schemas block reload", async ({
  page,
}) => {
  const current = await (await page.request.get("/api/app-version")).json();
  let advertised = current;
  let rejectOperations = false;
  const proxy = createServer((req, res) => {
    if (
      req.url === "/api/app-version" ||
      (req.url === "/api/operations" && rejectOperations)
    ) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.statusCode = req.url === "/api/operations" ? 403 : 200;
      res.end(
        JSON.stringify(
          req.url === "/api/operations"
            ? { error: "Synthetic revoked credential" }
            : advertised,
        ),
      );
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
    const created = await page.request.post(`${origin}/api/demo`, {
      headers: { "X-JCO-Demo": "1" },
    });
    const { token } = await created.json();
    await page.goto(`${origin}/field#key=${token}`);
    await page
      .getByRole("button", { name: "Download assignment", exact: true })
      .click();
    await expect(
      page.getByText("Ready offline", { exact: true }),
    ).toBeVisible();
    advertised = { ...current, version: randomBytes(32).toString("hex") };
    await page
      .getByRole("button", { name: "Refresh assignment", exact: true })
      .click();
    const notice = page.getByRole("region", { name: "App update" });
    const update = notice.getByRole("button", {
      name: "Reload to update",
      exact: true,
    });
    await expect(update).toBeEnabled();
    // A saved completion marker is pending work even without a single visit.
    await page
      .getByRole("button", { name: "Field work finished", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm field work finished", exact: true })
      .click();
    await expect(
      page.getByText("Walk status waiting to sync", { exact: true }),
    ).toBeVisible();
    await expect(update).toBeDisabled();
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(update).toBeEnabled();
    await page.evaluate(() => {
      const original = IDBFactory.prototype.open;
      Object.defineProperty(window, "restoreUpdateTestStorage", {
        value: () => {
          IDBFactory.prototype.open = original;
        },
        configurable: true,
      });
      IDBFactory.prototype.open = () => {
        throw new Error("Synthetic storage failure");
      };
    });
    await update.click();
    await expect(notice.getByRole("alert")).toBeVisible();
    await page.evaluate(() => {
      Reflect.get(window, "restoreUpdateTestStorage")();
      Reflect.deleteProperty(window, "restoreUpdateTestStorage");
    });
    expect(await localRecords(page)).toEqual([]);
    await page.getByRole("button", { name: /Unit 2A/ }).click();
    await page.getByLabel("No answer", { exact: true }).check();
    await page.getByRole("button", { name: "Save & next" }).click();
    if (
      await page.getByRole("button", { name: "← All households" }).isVisible()
    )
      await page.getByRole("button", { name: "← All households" }).click();
    rejectOperations = true;
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(page.getByText(/Synthetic revoked credential/)).toBeVisible();
    await expect(update).toBeDisabled();
    const saved = await localRecords(page);
    advertised = { ...advertised, storageVersion: 2 };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(notice.getByText(/needs organizer assistance/)).toBeVisible();
    await expect(update).toBeDisabled();
    expect(await localRecords(page)).toEqual(saved);
  } finally {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("safe update notice gates drafts and shared pending work; verified reload preserves records and offline shell (simulated release transport)", async ({
  page,
  context,
}) => {
  const baseline = await page.request.get("/api/app-version");
  expect(baseline.headers()["cache-control"]).toContain("no-store");
  const original = await baseline.json();
  expect(Object.keys(original).sort()).toEqual([
    "operationVersion",
    "storageVersion",
    "version",
  ]);
  let version = original.version as string;
  let disconnected = false,
    versionFailure = false,
    shellFailure = false,
    wrongShell = false;
  let holdShell = false;
  let releaseShell: (() => void) | undefined;
  let shellStarted = false;
  let versionReads = 0;
  // Native proxy works with service-worker fetches in both engines. Only release
  // marker + immutable asset URLs change; this is not a second production deploy.
  const proxy = createServer(async (req, res) => {
    if (disconnected) {
      req.socket.destroy();
      return;
    }
    if (req.url === "/api/app-version") {
      versionReads++;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.statusCode = versionFailure ? 503 : 200;
      res.end(JSON.stringify({ ...original, version }));
      return;
    }
    if (req.url === "/field" && holdShell) {
      shellStarted = true;
      await new Promise<void>((resolve) => {
        releaseShell = resolve;
      });
    }
    if (req.url === "/field" && shellFailure) {
      res.writeHead(503);
      res.end();
      return;
    }
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3100,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "accept-encoding": "identity" },
      },
      (response) => {
        if (req.url === "/field" || req.url?.startsWith("/_next/static/")) {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            const target = wrongShell ? original.version : version;
            let text = Buffer.concat(chunks)
              .toString()
              .replaceAll(original.version, target);
            if (req.url === "/field")
              text = text.replace(
                /((?:src|href)=")([^"<>]*\/_next\/static\/[^"<>]+)(")/g,
                (_whole, start, path, end) =>
                  `${start}${path}?jco_release=${target}${end}`,
              );
            const headers = {
              ...response.headers,
              "cache-control": "no-store",
            };
            delete headers["content-length"];
            delete headers["content-encoding"];
            res.writeHead(response.statusCode ?? 502, headers);
            res.end(text);
          });
        } else {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        }
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    const created = await page.request.post(`${origin}/api/demo`, {
      headers: { "X-JCO-Demo": "1" },
    });
    expect(created.ok()).toBeTruthy();
    const { token } = await created.json();
    await page.goto(`${origin}/field#key=${token}`);
    await page
      .getByRole("button", { name: "Download assignment", exact: true })
      .click();
    await expect(
      page.getByText("Ready offline", { exact: true }),
    ).toBeVisible();
    expect(
      await page
        .locator('meta[name="jco-app-version"]')
        .getAttribute("content"),
    ).toBe(original.version);
    await expect.poll(() => versionReads).toBeGreaterThan(0);
    await expect(page.getByRole("region", { name: "App update" })).toHaveCount(
      0,
    );

    await page.getByRole("button", { name: /Unit 2A/ }).click();
    await page.getByLabel("No answer", { exact: true }).check();
    version = randomBytes(32).toString("hex");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const notice = page.getByRole("region", { name: "App update" });
    const update = notice.getByRole("button", {
      name: "Reload to update",
      exact: true,
    });
    await expect(notice).toBeVisible();
    await expect(update).toBeDisabled();
    await expect(page.getByLabel("No answer", { exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Save & next" }).click();
    if (
      await page.getByRole("button", { name: "← All households" }).isVisible()
    )
      await page.getByRole("button", { name: "← All households" }).click();
    await expect(
      page.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    await expect(update).toBeDisabled();
    versionFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(notice).toBeVisible();
    versionFailure = false;
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(
      page.getByText("All records received", { exact: true }),
    ).toBeVisible();
    await expect(update).toBeEnabled();
    const saved = await localRecords(page);
    shellFailure = true;
    await update.click();
    await expect(notice.getByRole("alert")).toBeVisible();
    expect(await localRecords(page)).toEqual(saved);
    shellFailure = false;
    wrongShell = true;
    await update.click();
    await expect(notice.getByRole("alert")).toBeVisible();
    expect(await localRecords(page)).toEqual(saved);
    wrongShell = false;

    // A late save from another tab must stop the first tab's reload.
    const other = await context.newPage();
    await other.goto(`${origin}/field`);
    await other.getByRole("button", { name: /Unit 10B/ }).click();
    await other.getByLabel("No answer", { exact: true }).check();
    holdShell = true;
    await update.click();
    await expect.poll(() => shellStarted).toBe(true);
    await other.getByRole("button", { name: "Save & next" }).click();
    await expect(
      other.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    holdShell = false;
    releaseShell?.();
    await expect(notice.getByRole("alert")).toBeVisible();
    expect((await localRecords(page)).length).toBe(2);
    await other.close();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByText("1 waiting to sync", { exact: true }),
    ).toBeVisible();
    await expect(update).toBeDisabled();
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(update).toBeEnabled();
    const received = await localRecords(page);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await notice.screenshot({
      path: `test-results/app-update-${test.info().project.name}.png`,
    });
    await update.click();
    await expect(page.locator('meta[name="jco-app-version"]')).toHaveAttribute(
      "content",
      version,
    );
    await expect(
      page.getByText("All records received", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("2 received by server", { exact: true }),
    ).toBeVisible();
    await expect(notice).toHaveCount(0);
    expect(await localRecords(page)).toEqual(received);
    disconnected = true;
    await page.reload();
    await expect(
      page.getByText("Ready offline", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("2 received by server", { exact: true }),
    ).toBeVisible();
    expect(await localRecords(page)).toEqual(received);
  } finally {
    releaseShell?.();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
