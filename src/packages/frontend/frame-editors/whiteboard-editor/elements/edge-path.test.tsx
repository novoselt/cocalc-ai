/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

import DirectedEdgePath, { getDirectedEdgePathGeometry } from "./edge-path";

const start = { x: 100, y: 80 };
const end = { x: 400, y: 240 };

function draw(props: any = {}) {
  const result = render(
    <DirectedEdgePath
      start={start}
      end={end}
      startSide="right"
      endSide="left"
      {...props}
    />,
  );
  return {
    ...result,
    svg: result.container.querySelector("svg")!,
    visible: result.container.querySelector(
      '[data-edge-path="visible"]',
    ) as SVGPathElement,
  };
}

describe("directed edge path geometry", () => {
  it("extends controls outward from the attached rectangle sides", () => {
    const geometry = getDirectedEdgePathGeometry({
      start,
      end,
      startSide: "right",
      endSide: "left",
      padding: 20,
    });

    expect(geometry.controlStart.x).toBeGreaterThan(start.x);
    expect(geometry.controlStart.y).toBe(start.y);
    expect(geometry.controlEnd.x).toBeLessThan(end.x);
    expect(geometry.controlEnd.y).toBe(end.y);
    expect(geometry.path).toContain(" C ");
  });

  it("uses the vertical attachment normals for top and bottom sides", () => {
    const geometry = getDirectedEdgePathGeometry({
      start,
      end,
      startSide: "bottom",
      endSide: "top",
      padding: 20,
    });

    expect(geometry.controlStart.y).toBeGreaterThan(start.y);
    expect(geometry.controlEnd.y).toBeLessThan(end.y);
  });

  it("includes endpoints and controls in the SVG bounds", () => {
    const geometry = getDirectedEdgePathGeometry({
      start,
      end,
      startSide: "left",
      endSide: "right",
      padding: 20,
    });
    const points = [start, end, geometry.controlStart, geometry.controlEnd].map(
      geometry.toLocal,
    );

    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(20);
      expect(point.y).toBeGreaterThanOrEqual(20);
      expect(point.x).toBeLessThanOrEqual(geometry.bounds.width - 20);
      expect(point.y).toBeLessThanOrEqual(geometry.bounds.height - 20);
    }
  });
});

describe("DirectedEdgePath", () => {
  it("renders a cubic SVG path with an arrowhead at the target", () => {
    const { container, visible } = draw({ arrowSize: 24 });
    const marker = container.querySelector("marker")!;
    const markerPath = marker.querySelector("path")!;

    expect(visible.getAttribute("d")).toContain(" C ");
    expect(visible.getAttribute("marker-end")).toMatch(/^url\(#directed-edge-/);
    expect(Number(marker.getAttribute("refX"))).toBeCloseTo(24 * 0.7, 5);
    expect(markerPath.getAttribute("d")).toContain(`${24 * 0.7}`);
  });

  it("scales the arrowhead down for a short edge", () => {
    const { container } = render(
      <DirectedEdgePath
        start={{ x: 0, y: 0 }}
        end={{ x: 5, y: 0 }}
        startSide="right"
        endSide="left"
        arrowSize={24}
      />,
    );
    const marker = container.querySelector("marker")!;

    expect(Number(marker.getAttribute("markerWidth"))).toBeLessThanOrEqual(5);
    expect(Number(marker.getAttribute("markerWidth"))).toBeGreaterThan(0);
  });

  it("omits the arrowhead for a zero-length edge", () => {
    const { container } = render(
      <DirectedEdgePath
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0 }}
        startSide="right"
        endSide="left"
      />,
    );

    expect(container.querySelector("marker")).toBeNull();
  });

  it("uses the actual curve for selected highlighting", () => {
    const { container, visible } = draw({ selected: true });
    const highlight = container.querySelector('[data-edge-path="highlight"]')!;

    expect(highlight.getAttribute("d")).toBe(visible.getAttribute("d"));
    expect(Number(highlight.getAttribute("stroke-width"))).toBeGreaterThan(
      Number(visible.getAttribute("stroke-width")),
    );
  });

  it("provides a wider transparent hit path", () => {
    const { container } = draw({ onClick: () => {}, thickness: 2 });
    const target = screen.getByRole("button", { name: "Directed edge" });
    const visible = container.querySelector('[data-edge-path="visible"]')!;

    expect(target.getAttribute("stroke")).toBe("transparent");
    expect(Number(target.getAttribute("stroke-width"))).toBeGreaterThan(
      Number(visible.getAttribute("stroke-width")),
    );
    expect(target.getAttribute("pointer-events")).toBe("stroke");
  });

  it("supports pointer and keyboard selection", () => {
    const onClick = jest.fn();
    draw({ onClick, ariaLabel: "Select directed edge" });
    const target = screen.getByRole("button", {
      name: "Select directed edge",
    });

    fireEvent.click(target);
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.keyDown(target, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("shows curve highlighting for keyboard focus", () => {
    const { container } = draw({ onClick: () => {} });
    const target = screen.getByRole("button", { name: "Directed edge" });

    fireEvent.focus(target);
    expect(
      container.querySelector('[data-edge-path="highlight"]'),
    ).not.toBeNull();
    fireEvent.blur(target);
    expect(container.querySelector('[data-edge-path="highlight"]')).toBeNull();
  });

  it("keeps visible geometry from intercepting pointer selection", () => {
    const { visible } = draw({ onClick: () => {} });
    expect(visible.parentElement?.getAttribute("pointer-events")).toBe("none");
  });

  it("renders previews as dashed directed edges", () => {
    const { visible } = draw({ preview: true });
    expect(visible.getAttribute("stroke-dasharray")).toBe("8 6");
  });

  it("renders no selection control for a noninteractive edge", () => {
    draw();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
