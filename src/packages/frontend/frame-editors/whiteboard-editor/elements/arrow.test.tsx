/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Arrow geometry. The endpoints lie on y=0 of the rotated frame, so both the
stem and the head have to straddle that axis, and the head must never extend
past the endpoint it points at.
*/

import { render } from "@testing-library/react";

import Arrow from "./arrow";

function draw(props: any) {
  const { container } = render(
    <Arrow start={{ x: 0, y: 0 }} end={{ x: 100, y: 0 }} {...props} />,
  );
  const outer = container.firstElementChild as HTMLElement;
  // the stem is the div carrying the borderTop; its parent holds the opacity
  const stem = [...outer.querySelectorAll("div")].find(
    (d) => (d as HTMLElement).style.borderTop,
  ) as HTMLElement;
  const svg = outer.querySelector("svg") as SVGElement | null;
  return { outer, stem, group: stem?.parentElement as HTMLElement, svg };
}

const num = (v: string) => Number.parseFloat(v);

describe("Arrow geometry", () => {
  it("centres a thick stem on the endpoint axis", () => {
    const { stem } = draw({ thickness: 30, arrowSize: 24 });
    // borderTop hangs downward from the element's top edge, so the element
    // must start half a thickness above the axis for the line to straddle it.
    expect(num(stem.style.top)).toBeCloseTo(-15, 5);
    expect(stem.style.borderTop).toContain("30px");
  });

  it("keeps a hairline stem effectively on the axis", () => {
    const { stem } = draw({ thickness: 1, arrowSize: 24 });
    expect(num(stem.style.top)).toBeCloseTo(-0.5, 5);
  });

  it("centres the head on the same axis as the stem", () => {
    const { svg } = draw({ thickness: 30, arrowSize: 24 });
    const height = Number(svg!.getAttribute("height"));
    // top = -height/2 puts the head's midline on y=0, matching the stem.
    expect(num((svg as any).style.top)).toBeCloseTo(-height / 2, 5);
  });

  it("does not let the head overshoot a short edge", () => {
    // Head would be 0.7 * 24 = 16.8 long, but the edge is only 5.
    const { container } = render(
      <Arrow start={{ x: 0, y: 0 }} end={{ x: 5, y: 0 }} arrowSize={24} />,
    );
    const svg = container.querySelector("svg")!;
    const width = Number(svg.getAttribute("width"));
    expect(width).toBeLessThanOrEqual(5);
    expect(width).toBeGreaterThan(0);
  });

  it("keeps the head's proportions when shortened", () => {
    const { container } = render(
      <Arrow start={{ x: 0, y: 0 }} end={{ x: 5, y: 0 }} arrowSize={24} />,
    );
    const svg = container.querySelector("svg")!;
    const w = Number(svg.getAttribute("width"));
    const h = Number(svg.getAttribute("height"));
    // same aspect ratio as the unshortened head: 0.45 / 0.7
    expect(h / w).toBeCloseTo(0.45 / 0.7, 5);
  });

  it("uses the full head once the edge is long enough", () => {
    const { svg } = draw({ arrowSize: 24 });
    expect(Number(svg!.getAttribute("width"))).toBeCloseTo(24 * 0.7, 5);
  });

  it("omits the head entirely for a zero-length edge", () => {
    const { container } = render(
      <Arrow start={{ x: 0, y: 0 }} end={{ x: 0, y: 0 }} arrowSize={24} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("applies opacity once, not once per layer", () => {
    const { group, svg } = draw({ opacity: 0.5, arrowSize: 24 });
    // opacity belongs to the shared parent; a polygon carrying it as well
    // would render the head at 0.25 while the stem stayed at 0.5.
    expect(group.style.opacity).toBe("0.5");
    expect(svg!.querySelector("polygon")!.getAttribute("opacity")).toBeNull();
  });
});
