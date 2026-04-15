// Types and data-loading helpers for the Sound Browser.

export interface ProductEntry {
  id: string;
  name: string;
  channels: string[];
  sampleCount: number;
}

export interface IndexData {
  products: ProductEntry[];
}

export interface Sample {
  filename: string;
  alias?: string;
  category?: string;
  channel?: string;
  duration_sec?: number;
  beats?: number;
  detail?: string;
}

export interface ProductMetadata {
  samples: Sample[];
}

export type SampleSortKey = "name" | "category" | "beats" | "duration";
export type SortDirection = "asc" | "desc";

export interface SampleSort {
  key: SampleSortKey | null;
  direction: SortDirection;
}

export function sampleAudioPath(productId: string, sample: Sample): string {
  // Gen 1 metadata includes the channel folder in filename (e.g. "rap/Come on!.wav")
  if (sample.filename.includes("/")) {
    return `output/${productId}/${sample.filename}`;
  }
  // Gen 2/3 metadata has flat filenames; the channel folder is separate
  const channel = sample.channel ?? sample.category ?? "unknown";
  return `output/${productId}/${channel}/${sample.filename}`;
}

export function sampleChannel(sample: Sample): string {
  if (sample.channel) return sample.channel.toLowerCase();
  if (sample.category) return sample.category.toLowerCase();
  // Derive from filename path if present
  const slash = sample.filename.indexOf("/");
  if (slash > 0) return sample.filename.slice(0, slash).toLowerCase();
  return "unknown";
}

export function sampleDisplayName(sample: Sample): string {
  const alias = sample.alias?.trim();
  return alias && alias.length > 0 ? alias : sample.filename;
}

export function sampleMergedName(sample: Sample): string {
  const categoryLabel = sample.category?.trim();
  const displayName = sampleDisplayName(sample);
  return categoryLabel ? `${categoryLabel} - ${displayName}` : displayName;
}

/** Derive unique sorted channel names from a sample array. */
export function deriveChannels(samples: Sample[]): string[] {
  const set = new Set<string>();
  for (const s of samples) set.add(sampleChannel(s));
  return [...set].sort();
}

export function filterSamples(
  samples: Sample[],
  channel: string | null,
  query: string,
): Sample[] {
  let result = samples;

  if (channel) {
    result = result.filter(s => sampleChannel(s) === channel);
  }

  if (query) {
    const lower = query.toLowerCase();
    result = result.filter(s => {
      const alias = s.alias?.toLowerCase() ?? "";
      const detail = s.detail?.toLowerCase() ?? "";
      const cat = s.category?.toLowerCase() ?? "";
      const filename = s.filename.toLowerCase();
      return alias.includes(lower) || detail.includes(lower) || cat.includes(lower) || filename.includes(lower);
    });
  }

  return result;
}

export function sortSamples(samples: Sample[], sort: SampleSort): Sample[] {
  if (!sort.key) return samples;

  // Array.prototype.sort is stable in the browsers we target, so sorting a
  // shallow copy avoids per-item wrapper allocations for large sample sets.
  const sorted = [...samples];
  sorted.sort((left, right) => compareSamples(left, right, sort));
  return sorted;
}

function compareSamples(left: Sample, right: Sample, sort: SampleSort): number {
  const compareNameAsc = () => compareText(sampleMergedName(left), sampleMergedName(right), "asc");

  switch (sort.key) {
    case "name":
      return compareText(sampleMergedName(left), sampleMergedName(right), sort.direction);
    case "category": {
      const cmp = compareText(sampleChannel(left), sampleChannel(right), sort.direction);
      return cmp !== 0 ? cmp : compareNameAsc();
    }
    case "beats": {
      const cmp = compareNumber(left.beats, right.beats, sort.direction);
      return cmp !== 0 ? cmp : compareNameAsc();
    }
    case "duration": {
      const cmp = compareNumber(left.duration_sec, right.duration_sec, sort.direction);
      return cmp !== 0 ? cmp : compareNameAsc();
    }
    default:
      return 0;
  }
}

function compareText(left: string, right: string, direction: SortDirection): number {
  const cmp = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? cmp : -cmp;
}

function compareNumber(left: number | undefined, right: number | undefined, direction: SortDirection): number {
  const leftMissing = left == null;
  const rightMissing = right == null;

  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  const cmp = left - right;
  return direction === "asc" ? cmp : -cmp;
}
