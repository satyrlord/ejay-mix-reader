import type { SubcategoryOperation } from "../main-controller-types.js";

export interface SubcategoryOperationTracker {
  isInFlight: (operation: SubcategoryOperation) => boolean;
  begin: (operation: SubcategoryOperation) => void;
  complete: (operation: SubcategoryOperation) => void;
}

export function createSubcategoryOperationTracker(): SubcategoryOperationTracker {
  const operationsInFlight = new Set<SubcategoryOperation>();

  return {
    isInFlight: (operation) => operationsInFlight.has(operation),
    begin: (operation) => {
      operationsInFlight.add(operation);
    },
    complete: (operation) => {
      operationsInFlight.delete(operation);
    },
  };
}
