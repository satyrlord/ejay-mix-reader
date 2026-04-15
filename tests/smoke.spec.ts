import { test, expect } from "./baseFixtures.js";

test("homepage loads and shows title", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("eJay Sound Browser");
});

test("homepage shows folder picker button", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#pick-folder-btn")).toBeVisible();
  await expect(page.locator("#pick-folder-btn")).toHaveText(/Choose output folder/);
});

test("folder picker button has tooltip describing expected folder structure", async ({ page }) => {
  await page.goto("/");
  const tip = await page.locator("[data-tip]").getAttribute("data-tip");
  expect(tip).toMatch(/metadata\.json/);
  expect(tip).toMatch(/\.wav/);
});

test("homepage shows dev library shortcut in dev mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#dev-library-btn")).toBeVisible();
});

test("product cards are displayed after selecting dev library", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dev-library-btn").click();
  const cards = page.locator("[data-product-id]");
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
});

test("product browser shows a back to home button", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dev-library-btn").click();

  const backBtn = page.locator("#back-btn");
  await expect(backBtn).toBeVisible();
  await expect(backBtn).toHaveText("\u2190 Back to Home");

  await backBtn.click();
  await expect(page.locator("#home-page")).toBeVisible();
  await expect(page.locator("#pick-folder-btn")).toBeVisible();
});

test("search input is present", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dev-library-btn").click();
  await expect(page.locator("#search-input")).toBeVisible();
});

test("transport bar is present", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dev-library-btn").click();
  await expect(page.locator("#transport")).toBeVisible();
  await expect(page.locator("#transport-name")).toHaveText("No sample playing");
});
