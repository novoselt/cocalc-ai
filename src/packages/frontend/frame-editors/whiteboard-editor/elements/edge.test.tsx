/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, Map as iMap } from "immutable";
import { render, screen } from "@testing-library/react";

import type { Element } from "../types";
import Edge from "./edge";

const source: Element = {
  id: "source",
  type: "note",
  x: 0,
  y: 0,
  w: 100,
  h: 60,
  z: 10,
};
const target: Element = {
  id: "target",
  type: "note",
  x: 300,
  y: 180,
  w: 120,
  h: 80,
  z: 20,
};
const edge: Element = {
  id: "edge",
  type: "edge",
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  z: 30,
  data: { from: source.id, to: target.id, color: "black", radius: 1 },
};

const elementsMap = iMap({
  [source.id]: fromJS(source),
  [target.id]: fromJS(target),
}) as any;

const transforms = {
  dataToWindowNoScale: (x: number, y: number, z = 0) => ({
    x,
    y,
    z: z === source.z ? 3 : z === target.z ? 7 : 9,
  }),
  zMap: { [source.z]: 3, [target.z]: 7, [edge.z]: 9 },
} as any;

describe("Edge", () => {
  it("renders a directed cubic path below both endpoint elements", () => {
    const { container } = render(
      <Edge element={edge} elementsMap={elementsMap} transforms={transforms} />,
    );
    const svg = container.querySelector("svg")!;
    const path = container.querySelector('[data-edge-path="visible"]')!;

    expect(path.getAttribute("d")).toContain(" C ");
    expect(svg.style.zIndex).toBe("2");
  });

  it("highlights the curve rather than a rectangular element box", () => {
    const { container } = render(
      <Edge
        element={edge}
        elementsMap={elementsMap}
        transforms={transforms}
        selected
      />,
    );

    expect(
      container.querySelector('[data-edge-path="highlight"]'),
    ).not.toBeNull();
    expect(container.querySelector("div")).toBeNull();
  });

  it("provides an accessible directed-edge selection control", () => {
    render(
      <Edge
        element={edge}
        elementsMap={elementsMap}
        transforms={transforms}
        onClick={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Select directed edge" }),
    ).toBeInTheDocument();
  });

  it("renders a dashed preview to the live pointer position", () => {
    const preview = {
      ...edge,
      data: { from: source.id, previewTo: { x: 250, y: 150 } },
    };
    const { container } = render(
      <Edge
        element={preview}
        elementsMap={elementsMap}
        transforms={transforms}
        zIndex={0}
      />,
    );
    const svg = container.querySelector("svg")!;
    const path = container.querySelector('[data-edge-path="visible"]')!;

    expect(svg.style.zIndex).toBe("0");
    expect(path.getAttribute("stroke-dasharray")).toBe("8 6");
  });
});
