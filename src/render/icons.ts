// SVG icon factory functions used across the render sub-modules.

export const SVG_NS = "http://www.w3.org/2000/svg" as const;

type SvgIconElementSpec = {
  tag: "circle" | "path";
  attrs: Record<string, string>;
};

function createSvgIcon(options: {
  className: string;
  viewBox: string;
  elements: readonly SvgIconElementSpec[];
}): SVGSVGElement {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add(options.className);
  icon.setAttribute("viewBox", options.viewBox);
  icon.setAttribute("fill", "none");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  for (const elementSpec of options.elements) {
    const element = document.createElementNS(SVG_NS, elementSpec.tag);
    for (const [name, value] of Object.entries(elementSpec.attrs)) {
      element.setAttribute(name, value);
    }
    icon.appendChild(element);
  }

  return icon;
}

export function createSubcategoryAddIcon(): SVGSVGElement {
  return createSvgIcon({
    className: "subcategory-add-icon",
    viewBox: "0 0 16 16",
    elements: [
      {
        tag: "path",
        attrs: {
          d: "M8 3.25v9.5",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M3.25 8h9.5",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
        },
      },
    ],
  });
}

export function createSubcategoryConfirmIcon(): SVGSVGElement {
  return createSvgIcon({
    className: "subcategory-confirm-icon",
    viewBox: "0 0 16 16",
    elements: [
      {
        tag: "path",
        attrs: {
          d: "M3.5 8.25 6.5 11.25 12.5 4.75",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
      },
    ],
  });
}

export function createZoomIcon(kind: "in" | "out"): SVGSVGElement {
  const elements: SvgIconElementSpec[] = [
    {
      tag: "circle",
      attrs: {
        cx: "6.75",
        cy: "6.75",
        r: "3.75",
        stroke: "currentColor",
        "stroke-width": "1.5",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M9.5 9.5 13 13",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
      },
    },
    {
      tag: "path",
      attrs: {
        d: "M5 6.75h3.5",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
      },
    },
  ];

  if (kind === "in") {
    elements.push({
      tag: "path",
      attrs: {
        d: "M6.75 5v3.5",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "stroke-linecap": "round",
      },
    });
  }

  return createSvgIcon({
    className: "spa-zoom-icon",
    viewBox: "0 0 16 16",
    elements,
  });
}

export function createSequencerHomeIcon(): SVGSVGElement {
  return createSvgIcon({
    className: "seq-home-icon",
    viewBox: "0 0 16 16",
    elements: [
      {
        tag: "path",
        attrs: {
          d: "M4.5 3v10",
          stroke: "currentColor",
          "stroke-width": "1.8",
          "stroke-linecap": "round",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M12.5 3.5 6.5 8l6 4.5z",
          fill: "currentColor",
        },
      },
    ],
  });
}

export function createSequencerPlayIcon(): SVGSVGElement {
  return createSvgIcon({
    className: "seq-play-icon",
    viewBox: "0 0 16 16",
    elements: [
      {
        tag: "path",
        attrs: {
          d: "M4.5 3.75 12.5 8l-8 4.25z",
          fill: "currentColor",
        },
      },
    ],
  });
}

export function createSequencerPauseIcon(): SVGSVGElement {
  return createSvgIcon({
    className: "seq-pause-icon",
    viewBox: "0 0 16 16",
    elements: [
      {
        tag: "path",
        attrs: {
          d: "M5.25 3.5v9",
          stroke: "currentColor",
          "stroke-width": "2.4",
          "stroke-linecap": "round",
        },
      },
      {
        tag: "path",
        attrs: {
          d: "M10.75 3.5v9",
          stroke: "currentColor",
          "stroke-width": "2.4",
          "stroke-linecap": "round",
        },
      },
    ],
  });
}

export function createSequencerStopIcon(): SVGSVGElement {
  return createSvgIcon({
    className: "seq-stop-icon",
    viewBox: "0 0 16 16",
    elements: [
      {
        tag: "path",
        attrs: {
          d: "M4.5 4.5h7v7h-7z",
          fill: "currentColor",
        },
      },
    ],
  });
}
