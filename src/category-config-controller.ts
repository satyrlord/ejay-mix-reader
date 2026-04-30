import { createSubcategoryOperationTracker } from "./main-helpers/subcategory-ops.js";
import type { SubcategoryOperation } from "./main-controller-types.js";

export interface CategoryConfigController {
  isSubcategoryOperationInFlight: (operation: SubcategoryOperation) => boolean;
  beginSubcategoryOperation: (operation: SubcategoryOperation) => void;
  completeSubcategoryOperation: (operation: SubcategoryOperation) => void;
  isCategoryConfigRefreshInFlight: () => boolean;
  beginCategoryConfigRefresh: () => void;
  completeCategoryConfigRefresh: () => void;
}

export function createCategoryConfigController(): CategoryConfigController {
  const tracker = createSubcategoryOperationTracker();
  let categoryConfigRefreshInFlight = false;

  return {
    isSubcategoryOperationInFlight: (operation) => tracker.isInFlight(operation),
    beginSubcategoryOperation: (operation) => {
      tracker.begin(operation);
    },
    completeSubcategoryOperation: (operation) => {
      tracker.complete(operation);
    },
    isCategoryConfigRefreshInFlight: () => categoryConfigRefreshInFlight,
    beginCategoryConfigRefresh: () => {
      categoryConfigRefreshInFlight = true;
    },
    completeCategoryConfigRefresh: () => {
      categoryConfigRefreshInFlight = false;
    },
  };
}
