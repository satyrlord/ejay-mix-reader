import { test, expect } from "./baseFixtures.js";

test("homepage loads and shows title", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("eJay Sound Browser");
});
