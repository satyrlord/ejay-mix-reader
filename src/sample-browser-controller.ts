import { buildVisibleSamples } from "./main-helpers/filter-sort.js";
import type { Sample } from "./data.js";
import type { SampleFilteringInput } from "./main-controller-types.js";

export interface SampleBrowserControllerResult {
  visibleSamples: Sample[];
}

export function computeSampleBrowserResult(input: SampleFilteringInput): SampleBrowserControllerResult {
  return {
    visibleSamples: buildVisibleSamples(input),
  };
}
