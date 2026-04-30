import type { GridSortDir, GridSortKey, Sample } from "./data.js";

export type SubcategoryOperation = "add" | "remove";

export interface SampleFilteringInput {
  samples: Sample[];
  categoryId: string;
  subcategory: string;
  bpm: number | null;
  availableSubcategories: string[];
  searchQuery: string;
  gridSortKey: GridSortKey;
  gridSortDir: GridSortDir;
  allowedProducts: Set<string> | null;
}
