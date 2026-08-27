/*
Render a pen element.
*/

import { useEffect, useRef } from "react";
import type { Element, PenNib, Point } from "../types";
import { decompressPath, midPoint } from "../math";

interface Props {
  element: Element;
  renderStatic?: boolean; // if rendering in context of SSR and next.js; forces use of DPI
  // factor = 2 in both frontend and backend, since changing
  // between them breaks hydration badly.
}

// This is enforced by iPad/iOS... but is probably a good idea in general
// to avoid using too much memory and making things slow.
const MAX_CANVAS_SIZE = 4096;

export default function Pen({ element, renderStatic }: Props) {
  const DPIFactor = renderStatic ? 2 : window.devicePixelRatio;
  const canvasRef = useRef<any>(null);
  const scaleRef = useRef<number>(1);
  // We pad to shift things just a little so that parts of the curve that
  // are right on the edge of the canvas don't get partially truncated.
  // I tried doing this at various points in "the pipeline", and here at
  // the renderer is optimal.
  const pad = Math.round(
    2 * (element.data?.["radius"] ?? 1) * scaleRef.current,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const ctx = canvas.getContext("2d");
    if (ctx == null) return;

    const data:
      | {
          path?: number[];
          color?: string;
          radius?: number;
          opacity?: number;
          nib?: PenNib;
        }
      | undefined = element.data;
    if (data == null) return;

    const { path, radius, color, opacity, nib } = data;
    if (path == null) return;

    // Clear with the identity transform: clearRect is in user space, so
    // clearing *after* the translate below would leave the pad wide strip
    // along the top and left edges of the canvas untouched.  That strip is
    // where the top half of a wide stroke lives, so with a translucent pen
    // each re-render used to composite it on top of itself and the stroke
    // got darker and darker.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    clearCanvas({ ctx });
    ctx.setTransform(
      DPIFactor,
      0,
      0,
      DPIFactor,
      DPIFactor * pad,
      DPIFactor * pad,
    );

    drawCurve({
      ctx,
      path: decompressPath(path, scaleRef.current),
      color: color ?? "black",
      radius: (radius ?? 1) * scaleRef.current,
      opacity,
      nib,
    });
  }, [pad, element]);

  const w = (element.w ?? 100) + 2 * pad;
  const h = (element.h ?? 100) + 2 * pad;
  scaleRef.current = getMaxCanvasSizeScale(w * DPIFactor, h * DPIFactor);
  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={scaleRef.current * w * DPIFactor}
        height={scaleRef.current * h * DPIFactor}
        style={{
          width: `${w}px`,
          height: `${h}px`,
          position: "absolute",
          top: -pad,
          left: -pad,
        }}
      />
    </div>
  );
}

export function clearCanvas({ ctx }) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawCurve({
  ctx,
  path,
  color,
  radius,
  opacity,
  nib,
}: {
  ctx;
  path: Point[];
  color?: string;
  radius?: number;
  opacity?: number;
  nib?: PenNib;
}) {
  if (path.length == 0) {
    // empty path -- nothing to draw
    return;
  }
  // NOTE: the entire curve is always drawn using a *single* stroke or fill
  // operation.  This matters when opacity < 1 (e.g., the highlighter): if we
  // instead drew it segment by segment, the overlapping ends of consecutive
  // segments would each be composited separately, so the stroke would build up
  // to fully opaque instead of staying translucent.
  ctx.globalAlpha = opacity ?? 1;
  ctx.strokeStyle = color ?? "#000";
  ctx.fillStyle = color ?? "#000";

  if (nib == "chisel") {
    drawChiselCurve({ ctx, path, radius });
    return;
  }

  // There's some useful MIT licensed code at https://github.com/embiem/react-canvas-draw
  // that inspired this.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.lineWidth = 2 * (radius ?? 0.5);

  if (path.length <= 1) {
    const p = path[0];
    // draw a circle of the given radius at p.
    ctx.moveTo(p.x, p.y);
    ctx.beginPath();
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    return;
  }

  let p1 = path[0];
  let p2 = path[1];

  ctx.moveTo(p2.x, p2.y);
  ctx.beginPath();

  for (let i = 1, len = path.length; i < len; i++) {
    // we pick the point between pi+1 & pi+2 as the
    // end point and p1 as our control point
    const { x, y } = midPoint(p1, p2);
    ctx.quadraticCurveTo(p1.x, p1.y, x, y);
    p1 = path[i];
    p2 = path[i + 1];
  }
  // Draw last line as a straight line.
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

// A chisel nib is an upright rectangle that is 2*radius tall and
// CHISEL_NIB_RATIO*radius wide, i.e., what a real highlighter looks like:
// sweeping horizontally paints a wide band, and moving vertically paints a
// thin line.  The stroke is the region swept out by that rectangle along the
// path, which we build as one path out of the convex hull of the nib at each
// pair of consecutive points, then fill in a single operation.
const CHISEL_NIB_RATIO = 0.3;

function drawChiselCurve({
  ctx,
  path,
  radius,
}: {
  ctx;
  path: Point[];
  radius?: number;
}) {
  const r = Math.max(radius ?? 0.5, 0.5);
  const hw = Math.max(r * CHISEL_NIB_RATIO, 0.5);
  ctx.beginPath();
  if (path.length <= 1) {
    const p = path[0];
    ctx.rect(p.x - hw, p.y - r, 2 * hw, 2 * r);
  } else {
    for (let i = 1; i < path.length; i++) {
      addSweptNib(ctx, path[i - 1], path[i], hw, r);
    }
  }
  // "nonzero" (the default) unions the subpaths -- they all have the same
  // orientation -- so overlaps are filled exactly once.
  ctx.fill();
}

// Add the convex hull of the nib rectangle placed at p and at q.  Since the
// nib is axis aligned and the same at both ends, the hull is just the two
// rectangles joined along the direction of travel, so no general hull
// computation is needed.  The vertices are always emitted in the same
// rotational order, which is what makes the nonzero fill above work.
function addSweptNib(ctx, p: Point, q: Point, hw: number, r: number) {
  // normalize so that we always sweep left to right
  const [a, b] = p.x <= q.x ? [p, q] : [q, p];
  const poly: Point[] =
    b.y >= a.y
      ? [
          { x: a.x - hw, y: a.y - r },
          { x: a.x + hw, y: a.y - r },
          { x: b.x + hw, y: b.y - r },
          { x: b.x + hw, y: b.y + r },
          { x: b.x - hw, y: b.y + r },
          { x: a.x - hw, y: a.y + r },
        ]
      : [
          { x: a.x - hw, y: a.y - r },
          { x: b.x - hw, y: b.y - r },
          { x: b.x + hw, y: b.y - r },
          { x: b.x + hw, y: b.y + r },
          { x: a.x + hw, y: a.y + r },
          { x: a.x - hw, y: a.y + r },
        ];
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }
  ctx.closePath();
}

// Return a single scalar so that multiplying by it transforms
// coordinates
export function getMaxCanvasSizeScale(w: number, h: number): number {
  if (w <= MAX_CANVAS_SIZE && w <= MAX_CANVAS_SIZE) {
    return 1;
  } else {
    if (w >= h) {
      return MAX_CANVAS_SIZE / w;
    } else {
      return MAX_CANVAS_SIZE / h;
    }
  }
}
