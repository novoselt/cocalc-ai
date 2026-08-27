/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useId, useState } from "react";
import type { KeyboardEvent } from "react";

import type { Point } from "../types";
import type { RectSide } from "../math";
import { SELECTED_BORDER_COLOR, SELECTED_BORDER_WIDTH } from "./style";

interface Props {
  start: Point;
  end: Point;
  startSide: RectSide;
  endSide: RectSide;
  arrowSize?: number;
  thickness?: number;
  color?: string;
  opacity?: number;
  zIndex?: number;
  onClick?: (evt: any) => void;
  preview?: boolean;
  selected?: boolean;
  ariaLabel?: string;
}

interface DirectedEdgePathGeometry {
  path: string;
  controlStart: Point;
  controlEnd: Point;
  bounds: { x: number; y: number; width: number; height: number };
  toLocal: (point: Point) => Point;
}

const SIDE_NORMAL: Record<RectSide, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const MAX_CONTROL_DISTANCE = 180;
const MIN_CONTROL_DISTANCE = 24;

export function getDirectedEdgePathGeometry({
  start,
  end,
  startSide,
  endSide,
  padding,
}: {
  start: Point;
  end: Point;
  startSide: RectSide;
  endSide: RectSide;
  padding: number;
}): DirectedEdgePathGeometry {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const controlDistance =
    distance === 0
      ? 0
      : Math.min(
          MAX_CONTROL_DISTANCE,
          Math.max(MIN_CONTROL_DISTANCE, distance * 0.4),
        );
  const startNormal = SIDE_NORMAL[startSide];
  const endNormal = SIDE_NORMAL[endSide];
  const controlStart = {
    x: start.x + startNormal.x * controlDistance,
    y: start.y + startNormal.y * controlDistance,
  };
  const controlEnd = {
    x: end.x + endNormal.x * controlDistance,
    y: end.y + endNormal.y * controlDistance,
  };
  const x = Math.min(start.x, end.x, controlStart.x, controlEnd.x) - padding;
  const y = Math.min(start.y, end.y, controlStart.y, controlEnd.y) - padding;
  const xMax = Math.max(start.x, end.x, controlStart.x, controlEnd.x) + padding;
  const yMax = Math.max(start.y, end.y, controlStart.y, controlEnd.y) + padding;
  const toLocal = (point: Point): Point => ({
    x: point.x - x,
    y: point.y - y,
  });
  const localStart = toLocal(start);
  const localControlStart = toLocal(controlStart);
  const localControlEnd = toLocal(controlEnd);
  const localEnd = toLocal(end);

  return {
    path: `M ${localStart.x} ${localStart.y} C ${localControlStart.x} ${localControlStart.y}, ${localControlEnd.x} ${localControlEnd.y}, ${localEnd.x} ${localEnd.y}`,
    controlStart,
    controlEnd,
    bounds: {
      x,
      y,
      width: Math.max(1, xMax - x),
      height: Math.max(1, yMax - y),
    },
    toLocal,
  };
}

export default function DirectedEdgePath({
  start,
  end,
  startSide,
  endSide,
  arrowSize = 24,
  thickness = 1,
  color = "black",
  opacity,
  zIndex,
  onClick,
  preview,
  selected,
  ariaLabel = "Directed edge",
}: Props) {
  const [focused, setFocused] = useState(false);
  const markerId = `directed-edge-${useId().replaceAll(":", "")}`;
  const lineThickness = Math.max(thickness, 1);
  const hitWidth = Math.max(18, lineThickness + 12);
  const fullTipLength = arrowSize * 0.7;
  const fullTipWidth = arrowSize * 0.45;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const tipScale =
    fullTipLength > 0 ? Math.min(1, distance / fullTipLength) : 0;
  const tipLength = fullTipLength * tipScale;
  const tipWidth = fullTipWidth * tipScale;
  const padding =
    Math.max(hitWidth, tipLength, tipWidth, SELECTED_BORDER_WIDTH * 2) + 2;
  const geometry = getDirectedEdgePathGeometry({
    start,
    end,
    startSide,
    endSide,
    padding,
  });
  const highlighted = selected || focused;

  const activateFromKeyboard = (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.(event);
  };

  return (
    <svg
      width={geometry.bounds.width}
      height={geometry.bounds.height}
      viewBox={`0 0 ${geometry.bounds.width} ${geometry.bounds.height}`}
      style={{
        position: "absolute",
        left: geometry.bounds.x,
        top: geometry.bounds.y,
        overflow: "visible",
        zIndex,
        pointerEvents: "none",
      }}
    >
      {tipLength > 0 && (
        <defs>
          <marker
            id={markerId}
            markerWidth={tipLength}
            markerHeight={tipWidth}
            refX={tipLength}
            refY={tipWidth / 2}
            markerUnits="userSpaceOnUse"
            orient="auto"
            viewBox={`0 0 ${tipLength} ${tipWidth}`}
          >
            <path
              d={`M 0 0 L ${tipLength} ${tipWidth / 2} L 0 ${tipWidth} Z`}
              fill={color}
            />
          </marker>
        </defs>
      )}
      {highlighted && (
        <path
          data-edge-path="highlight"
          d={geometry.path}
          fill="none"
          stroke={SELECTED_BORDER_COLOR}
          strokeWidth={lineThickness + SELECTED_BORDER_WIDTH * 2}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
      <g opacity={opacity} pointerEvents="none">
        <path
          data-edge-path="visible"
          d={geometry.path}
          fill="none"
          stroke={color}
          strokeWidth={lineThickness}
          strokeLinecap="round"
          strokeDasharray={preview ? "8 6" : undefined}
          markerEnd={tipLength > 0 ? `url(#${markerId})` : undefined}
        />
      </g>
      {onClick && (
        <path
          data-edge-path="hit-target"
          d={geometry.path}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          pointerEvents="stroke"
          cursor="pointer"
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          onClick={onClick}
          onKeyDown={activateFromKeyboard}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      )}
    </svg>
  );
}
