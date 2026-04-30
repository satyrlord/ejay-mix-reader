import { describe, expect, it } from "vitest";

import { createCategoryConfigController } from "../category-config-controller.js";

describe("category-config-controller", () => {
  it("tracks subcategory operations in flight", () => {
    const controller = createCategoryConfigController();

    expect(controller.isSubcategoryOperationInFlight("add")).toBe(false);
    controller.beginSubcategoryOperation("add");
    expect(controller.isSubcategoryOperationInFlight("add")).toBe(true);
    controller.completeSubcategoryOperation("add");
    expect(controller.isSubcategoryOperationInFlight("add")).toBe(false);
  });

  it("tracks category config refresh in flight", () => {
    const controller = createCategoryConfigController();

    expect(controller.isCategoryConfigRefreshInFlight()).toBe(false);
    controller.beginCategoryConfigRefresh();
    expect(controller.isCategoryConfigRefreshInFlight()).toBe(true);
    controller.completeCategoryConfigRefresh();
    expect(controller.isCategoryConfigRefreshInFlight()).toBe(false);
  });
});
