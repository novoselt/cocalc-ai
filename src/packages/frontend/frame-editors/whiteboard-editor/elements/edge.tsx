/*
Render an edge from one node to another.
*/

import type { Element, ElementsMap, Point, Rect } from "../types";
import DirectedEdgePath from "./edge-path";
import {
  centerOfRect,
  getEdgeEndpoints,
  getPosition,
  getRectAnchorToward,
  type RectSide,
  Transforms,
} from "../math";

interface Props {
  element: Element;
  elementsMap: ElementsMap;
  transforms: Transforms;
  cursors?: { [account_id: string]: any[] };
  selected?: boolean;
  previewMode?: boolean;
  onClick?: (any) => void;
  zIndex?: number; // override element.z
}

export default function Edge({
  element,
  elementsMap,
  transforms,
  cursors,
  selected,
  previewMode,
  onClick,
  zIndex,
}: Props) {
  cursors = cursors; // Not using *yet*.

  const endpoints = getEndpoints(element, elementsMap, transforms, zIndex);
  if (endpoints == null) {
    return null;
  }
  const { start, end } = endpoints;

  const thickness = (element.data?.radius ?? 0.5) * 2;

  return (
    <DirectedEdgePath
      start={start}
      end={end}
      startSide={endpoints.startSide}
      endSide={endpoints.endSide}
      arrowSize={thickness * 5 + 14}
      thickness={thickness}
      color={previewMode ? "#9fc3ff" : element.data?.color}
      opacity={element.data?.opacity}
      zIndex={endpoints.zIndex}
      onClick={onClick}
      preview={element.data?.previewTo != null}
      selected={selected}
      ariaLabel="Select directed edge"
    />
  );
}

function toWindowRectNoScale(
  transforms: Transforms,
  element: Element,
): { rect: Rect; zIndex: number } {
  const { x, y, z, w, h } = getPosition(element);
  const transformed = transforms.dataToWindowNoScale(x, y, z);
  return {
    rect: { x: transformed.x, y: transformed.y, w, h },
    zIndex: transformed.z,
  };
}

function getEndpoints(
  element,
  elementsMap,
  transforms,
  zIndex,
): {
  start: Point;
  end: Point;
  startSide: RectSide;
  endSide: RectSide;
  zIndex: number;
} | null {
  const { from: fromId } = element.data ?? {};
  if (fromId == null) return null; // invalid data
  const fromElt = elementsMap.get(fromId)?.toJS();
  if (fromElt == null || fromElt.hide != null) {
    // TODO: maybe delete edge -- it is no longer valid?
    return null;
  }

  // We use a heuristic about where to draw the edge.
  // Basically, we want it to go between the middles of
  // the closest edges.   TODO: Sometimes a longer path that avoids
  // overlapping exists... or maybe curve the line?
  const from = toWindowRectNoScale(transforms, fromElt);

  let start: Point;
  let end: Point;
  let startSide: RectSide;
  let endSide: RectSide;
  if (element.data?.previewTo != null) {
    const { x, y } = element.data?.previewTo;
    end = transforms.dataToWindowNoScale(x, y);
    const startAnchor = getRectAnchorToward(from.rect, end);
    const endAnchor = getRectAnchorToward(
      { x: end.x, y: end.y, w: 0, h: 0 },
      centerOfRect(from.rect),
    );
    start = startAnchor.point;
    startSide = startAnchor.side;
    endSide = endAnchor.side;
    zIndex ??= 0;
  } else {
    const { to: toId } = element.data ?? {};
    if (toId == null) return null; // invalid data
    const toElt = elementsMap.get(toId)?.toJS();
    if (toElt == null || toElt.hide != null) {
      return null;
    }
    const to = toWindowRectNoScale(transforms, toElt);
    ({ start, end, startSide, endSide } = getEdgeEndpoints(from.rect, to.rect));
    zIndex ??= Math.max(0, Math.min(from.zIndex, to.zIndex) - 1);
  }

  return { start, end, startSide, endSide, zIndex };
}
