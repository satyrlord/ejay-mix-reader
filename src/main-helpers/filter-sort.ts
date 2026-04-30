import { filterSamples, filterSamplesBySearchQuery, sortSamplesByKey } from "../data.js";
import type { Sample } from "../data.js";
import type { SampleFilteringInput } from "../main-controller-types.js";

export function buildVisibleSamples(input: SampleFilteringInput): Sample[] {
  const allowedProducts = input.allowedProducts;
  const baseSamples = allowedProducts
    ? input.samples.filter((sample) => {
        const product = typeof sample.product === "string" ? sample.product : "";
        return product.length > 0 && allowedProducts.has(product);
      })
    : input.samples;

  const filtered = sortSamplesByKey(
    filterSamples(baseSamples, {
      category: input.categoryId,
      subcategory: input.subcategory,
      product: null,
      bpm: input.bpm,
      availableSubcategories: input.availableSubcategories,
    }),
    input.gridSortKey,
    input.gridSortDir,
  );

  return filterSamplesBySearchQuery(filtered, input.searchQuery);
}
