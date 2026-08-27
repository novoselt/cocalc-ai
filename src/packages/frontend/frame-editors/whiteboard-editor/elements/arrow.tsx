import { CSSProperties } from "react";
import type { Point } from "../types";

interface Props {
  start: Point;
  end: Point;
  arrowSize?: number;
  thickness?: number;
  color?: string;
  opacity?: number;
  style?: CSSProperties;
  onClick?: (evt: any) => void;
  preview?: boolean;
  // Accessible name for the selection control; only used when onClick is set.
  ariaLabel?: string;
}

export default function Arrow({
  start,
  end,
  arrowSize = 24,
  thickness = 1,
  color = "black",
  opacity,
  style,
  onClick,
  preview,
  ariaLabel = "Edge",
}: Props) {
  const { x: x0, y: y0 } = start;
  const { x: x1, y: y1 } = end;
  const a = x1 - x0;
  const b = y1 - y0;
  const len = Math.sqrt(a * a + b * b);
  const theta = Math.atan(b / a) - (a < 0 ? Math.PI : 0);

  // Sharp arrowhead: length along the arrow direction, width perpendicular.
  // Scaled down for edges shorter than the head, otherwise the line collapses
  // to zero width and the head sticks out past the element it points at.
  const fullTipLength = arrowSize * 0.7;
  const fullTipWidth = arrowSize * 0.45;
  const tipScale =
    fullTipLength > 0 ? Math.min(1, Math.max(len, 0) / fullTipLength) : 0;
  const tipLength = fullTipLength * tipScale;
  const tipWidth = fullTipWidth * tipScale;

  // The endpoints lie on y=0 of the rotated frame, so the line has to straddle
  // that axis. A borderTop alone hangs entirely below it, which is invisible at
  // thickness 1 but puts a thick line half its width off-axis, and off-centre
  // from the arrowhead.
  const lineThickness = Math.max(thickness, 1);

  // Extract layout-safe styles from caller (e.g. Edge passes selection border,
  // preview background, zIndex). We use outline instead of border so the
  // selection indicator doesn't shift the rotation pivot.
  const outerStyle: CSSProperties = {
    position: "absolute",
    left: x0,
    top: y0,
    width: `${len}px`,
    transformOrigin: "0 0",
    transform: `rotate(${theta}rad)`,
    zIndex: style?.zIndex as any,
    cursor: onClick ? "pointer" : undefined,
    outline: style?.border as any,
    background: style?.background,
  };

  return (
    <div style={outerStyle}>
      {/* Selection surface: wider than the line so it is easy to hit, and a
          real button so it is reachable by Tab and activated by Enter/Space
          rather than being pointer-only. Left visually transparent; the
          browser's own focus ring is deliberately not suppressed. */}
      {onClick && (
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={onClick}
          style={{
            position: "absolute",
            top: "-10px",
            left: 0,
            right: 0,
            height: "20px",
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        />
      )}
      {/* Shortened by tipLength so the line doesn't poke past the head's tip.
          opacity lives here so it applies once to line and head together. */}
      <div
        style={{
          position: "relative",
          marginRight: `${tipLength}px`,
          opacity,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `-${lineThickness / 2}px`,
            borderTop: `${lineThickness}px ${preview ? "dashed" : "solid"} ${color}`,
          }}
        />
        {/* Sharp SVG arrowhead, centred on the same axis as the line */}
        {tipLength > 0 && (
          <svg
            style={{
              position: "absolute",
              right: `-${tipLength}px`,
              top: `-${tipWidth / 2}px`,
            }}
            width={tipLength}
            height={tipWidth}
            viewBox={`0 0 ${tipLength} ${tipWidth}`}
          >
            <polygon
              points={`0,0 ${tipLength},${tipWidth / 2} 0,${tipWidth}`}
              fill={color}
            />
          </svg>
        )}
      </div>
    </div>
  );
}
