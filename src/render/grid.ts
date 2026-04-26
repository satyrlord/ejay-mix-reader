// Sample grid rendering and duplicate-presentation logic.

import type { Sample } from "../data.js";
import {
  sampleCategory,
  sampleDisambiguationLine,
  sampleDisplayKey,
  sampleDisplayName,
  sampleMetadataLine,
} from "../data.js";
import type { Library } from "../library.js";
import type { Player } from "../player.js";
import { showErrorToast } from "./transport.js";

interface DuplicatePresentation {
  visibleName: string;
  includesDetail: boolean;
  includesProduct: boolean;
  includesInternalName: boolean;
  includesSampleId: boolean;
}

interface DuplicatePresentationState {
  sample: Sample;
  tokens: string[];
  includesDetail: boolean;
  includesProduct: boolean;
  includesInternalName: boolean;
  includesSampleId: boolean;
}

function trimLabelToken(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function productLabel(product: unknown): string {
  return trimLabelToken(product).replace(/_/g, " ");
}

function sampleIdLabel(sampleId: unknown): string {
  return typeof sampleId === "number" && Number.isFinite(sampleId) ? `#${sampleId}` : "";
}

function composeVisibleName(baseName: string, tokens: readonly string[]): string {
  return tokens.length > 0 ? `${baseName} - ${tokens.join(" - ")}` : baseName;
}

function defaultDuplicatePresentation(sample: Sample): DuplicatePresentation {
  return {
    visibleName: sampleDisplayName(sample),
    includesDetail: false,
    includesProduct: false,
    includesInternalName: false,
    includesSampleId: false,
  };
}

function arePresentationLabelsUnique(states: readonly DuplicatePresentationState[]): boolean {
  const seen = new Set<string>();

  for (const state of states) {
    const label = composeVisibleName(sampleDisplayName(state.sample), state.tokens).toLowerCase();
    if (seen.has(label)) {
      return false;
    }
    seen.add(label);
  }

  return true;
}

function stageAddsUsefulVariance(values: readonly string[]): boolean {
  const nonEmptyValues = values.filter((value) => value.length > 0);
  const distinct = new Set(nonEmptyValues);
  return distinct.size > 1 || (distinct.size === 1 && nonEmptyValues.length < values.length);
}

function buildDuplicatePresentations(samples: readonly Sample[]): Map<Sample, DuplicatePresentation> {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const displayKey = sampleDisplayKey(sample);
    const group = groups.get(displayKey) ?? [];
    group.push(sample);
    groups.set(displayKey, group);
  }

  const presentations = new Map<Sample, DuplicatePresentation>();

  for (const group of groups.values()) {
    if (group.length <= 1) {
      const [sample] = group;
      if (sample) {
        presentations.set(sample, defaultDuplicatePresentation(sample));
      }
      continue;
    }

    const states: DuplicatePresentationState[] = group.map((sample) => ({
      sample,
      tokens: [],
      includesDetail: false,
      includesProduct: false,
      includesInternalName: false,
      includesSampleId: false,
    }));

    const stages: Array<{
      values: (state: DuplicatePresentationState) => string;
      apply: (state: DuplicatePresentationState, value: string) => void;
    }> = [
      {
        values: (state) => trimLabelToken(state.sample.detail),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesDetail = true;
        },
      },
      {
        values: (state) => productLabel(state.sample.product),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesProduct = true;
        },
      },
      {
        values: (state) => trimLabelToken(state.sample.internal_name),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesInternalName = true;
        },
      },
      {
        values: (state) => sampleIdLabel(state.sample.sample_id),
        apply: (state, value) => {
          state.tokens.push(value);
          state.includesSampleId = true;
        },
      },
      {
        values: (state) => trimLabelToken(state.sample.source),
        apply: (state, value) => {
          state.tokens.push(value);
        },
      },
      {
        values: (state) => state.sample.filename.replace(/^.*[\\/]/, "").replace(/\.wav$/i, ""),
        apply: (state, value) => {
          state.tokens.push(value);
        },
      },
    ];

    for (const stage of stages) {
      if (arePresentationLabelsUnique(states)) {
        break;
      }

      const values = states.map((state) => stage.values(state));
      if (!stageAddsUsefulVariance(values)) {
        continue;
      }

      for (let index = 0; index < states.length; index += 1) {
        const value = values[index];
        if (!value) {
          continue;
        }
        stage.apply(states[index], value);
      }
    }

    for (const state of states) {
      presentations.set(state.sample, {
        visibleName: composeVisibleName(sampleDisplayName(state.sample), state.tokens),
        includesDetail: state.includesDetail,
        includesProduct: state.includesProduct,
        includesInternalName: state.includesInternalName,
        includesSampleId: state.includesSampleId,
      });
    }
  }

  return presentations;
}

function buildVisibleMeta(sample: Sample, presentation: DuplicatePresentation): string {
  const meta = sampleMetadataLine({
    product: presentation.includesProduct ? "" : sample.product,
    bpm: sample.bpm,
    beats: sample.beats,
    detail: presentation.includesDetail ? "" : sample.detail,
  });
  const disambiguation = sampleDisambiguationLine({
    internal_name: presentation.includesInternalName ? "" : sample.internal_name,
    sample_id: presentation.includesSampleId ? undefined : sample.sample_id,
  });
  return [meta, disambiguation].filter((part) => part.length > 0).join(" \u00B7 ");
}

function buildBlockTitle(sample: Sample, presentation: DuplicatePresentation): string {
  const lines = [presentation.visibleName];
  const meta = buildVisibleMeta(sample, presentation);
  if (meta) {
    lines.push(meta);
  }

  const source = trimLabelToken(sample.source);
  if (source) {
    lines.push(`Source: ${source}`);
  }

  return lines.join("\n");
}

/** Maximum number of CSS grid columns per sample lane (matches the 24-column layout). */
const MAX_LANE_SPAN = 24;

function buildLanes(samples: Sample[]): Sample[][] {
  const lanes: Sample[][] = [];
  let currentLane: Sample[] = [];
  let currentSpan = 0;

  for (const sample of samples) {
    const span = blockSpanFromBeats(sample.beats);
    if (currentLane.length > 0 && currentSpan + span > MAX_LANE_SPAN) {
      lanes.push(currentLane);
      currentLane = [];
      currentSpan = 0;
    }

    currentLane.push(sample);
    currentSpan += span;
  }

  if (currentLane.length > 0) {
    lanes.push(currentLane);
  }

  return lanes;
}

/**
 * Map a sample's beat count to a CSS grid column span within a MAX_LANE_SPAN (24) column grid.
 *
 * Thresholds follow the native eJay beat sizes (4, 8, 16, 32) and the span
 * values are proportional powers-of-2 so that relative durations are visually
 * apparent at a glance:
 *   invalid / ≤4  beats →  1 column   (shortest, single block)
 *          ≤8  beats →  2 columns
 *          ≤16 beats →  4 columns
 *          ≤32 beats →  8 columns
 *         >32  beats → 12 columns  (half the lane, longest loops)
 */
function blockSpanFromBeats(beats: number | undefined): number {
  if (typeof beats !== "number" || !Number.isFinite(beats) || beats <= 0) return 1;
  if (beats <= 4) return 1;
  if (beats <= 8) return 2;
  if (beats <= 16) return 4;
  if (beats <= 32) return 8;
  return 12;
}

function categoryColor(category: string): string {
  const token = category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `var(--channel-${token || "unknown"}, #4a90d9)`;
}

export function renderSampleGrid(
  container: HTMLElement,
  samples: Sample[],
  player: Player,
  library: Library,
): void {
  container.classList.add("sample-grid");
  container.setAttribute("role", "grid");
  container.replaceChildren();

  if (samples.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sample-grid-empty";
    empty.textContent = "No samples in this selection.";
    container.appendChild(empty);
    return;
  }

  const duplicatePresentations = buildDuplicatePresentations(samples);

  for (const lane of buildLanes(samples)) {
    const laneEl = document.createElement("div");
    laneEl.className = "sample-lane";

    for (const sample of lane) {
      const block = document.createElement("button");
      block.type = "button";
      block.className = "sample-block";
      block.dataset.filename = sample.filename;
      block.style.setProperty("--block-color", categoryColor(sampleCategory(sample)));
      block.style.setProperty("--block-span", String(blockSpanFromBeats(sample.beats)));

      const presentation = duplicatePresentations.get(sample) ?? defaultDuplicatePresentation(sample);
      const visibleMeta = buildVisibleMeta(sample, presentation);

      const label = document.createElement("span");
      label.className = "sample-block-label";
      label.textContent = presentation.visibleName;
      block.appendChild(label);

      if (visibleMeta) {
        const metaEl = document.createElement("span");
        metaEl.className = "sample-block-meta";
        metaEl.textContent = visibleMeta;
        block.appendChild(metaEl);
      }

      block.title = buildBlockTitle(sample, presentation);

      block.addEventListener("click", () => {
        library.resolveAudioUrl(sample)
          .then((url) => {
            block.dataset.path = url;
            player.toggle(url);
          })
          .catch((error: unknown) => {
            console.error("Failed to resolve audio URL:", error);
            showErrorToast("Could not play this sample - audio file not found.");
          });
      });

      laneEl.appendChild(block);
    }

    container.appendChild(laneEl);
  }
}
