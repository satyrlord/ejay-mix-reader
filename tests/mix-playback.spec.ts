import { test, expect } from "./baseFixtures.js";

test.describe("MIX playback (prerequisite 13)", () => {
  test("serves a MIX file through the /mix/ dev-server middleware", async ({ page }) => {
    const response = await page.request.get("/mix/Dance_eJay1/START.MIX").catch(() => null);
    if (!response) test.skip(true, "Dance_eJay1/START.MIX not present in archive/");
    expect(response!.status()).toBe(200);
    expect(response!.headers()["content-type"]).toContain("application/octet-stream");
    const body = await response!.body();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("rejects path-traversal attempts", async ({ page }) => {
    const response = await page.request.get("/mix/Dance_eJay1/..%2Fsecrets.mix");
    expect(response.status()).toBe(404);
  });

  test("returns 404 for unknown products", async ({ page }) => {
    const response = await page.request.get("/mix/NotAProduct/anything.mix");
    expect(response.status()).toBe(404);
  });
});