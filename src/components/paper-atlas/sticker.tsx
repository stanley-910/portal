import { useId, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

export type StickerShape = "plane" | "star";

export interface StickerProps {
  shape: StickerShape;
  /** Rendered size in px. Default 44 for the plane, 28 for the star. */
  size?: number;
  /** Degrees; for the plane, 0 points north (up). */
  rotate?: number;
  /** Accessible name; omit for a decorative sticker. */
  title?: string;
  /** How high it flies, 0 (on the page) to 1. Sets how far off and soft its shadow falls. Default 0.5 for plane, 0 for star. */
  altitude?: number;
  className?: string;
  style?: CSSProperties;
}

export const PLANE_PATH =
  "M0 -20 C3 -20 4 -16 4 -12 L4 -5 L19 3 L19 7.5 L4 3.5 L3 12 L9 16 L9 19.5 L0 17.5 " +
  "L-9 19.5 L-9 16 L-3 12 L-4 3.5 L-19 7.5 L-19 3 L-4 -5 L-4 -12 C-4 -16 -3 -20 0 -20 Z";

/** An eight-pointed star of outer radius R, centred on the origin. */
export function starPath(R: number) {
  let d = "";
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? R : R * 0.34;
    d += (i ? " L" : "M") + (Math.cos(a) * r).toFixed(2) + " " + (Math.sin(a) * r).toFixed(2);
  }
  return d + " Z";
}

const STAR_PATH = starPath(20);

/** A paper cut-out laid on the page: the plane (the traveller) or the star pin (a trip end point). */
export function Sticker({ shape, size, rotate = 0, title, altitude, className, style }: StickerProps) {
  const gradientId = "pa-star-" + useId().replace(/[^A-Za-z0-9_-]/g, "");
  const px = size ?? (shape === "plane" ? 44 : 28);

  return (
    <svg
      className={cn("pa-sticker pa-cast", className)}
      width={px}
      height={px}
      viewBox="-26 -26 52 52"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ "--alt": altitude ?? (shape === "plane" ? 0.5 : 0), ...style } as CSSProperties}
    >
      {/* rotated inside the SVG, so the shadow keeps falling along the light */}
      <g transform={rotate ? `rotate(${rotate})` : undefined}>
      {shape === "plane" ? (
        <>
          <path className="pa-sticker-face" d={PLANE_PATH} />
          <path className="pa-sticker-detail" d="M-2.3 -13.5 Q0 -16.2 2.3 -13.5" />
          <circle className="pa-roundel" cx={-12} cy={3.4} r={1.8} />
          <circle className="pa-roundel" cx={12} cy={3.4} r={1.8} />
        </>
      ) : (
        <>
          <defs>
            <radialGradient id={gradientId} cx={0} cy={0} r={20} gradientUnits="userSpaceOnUse">
              <stop offset="0" className="pa-star-light" />
              <stop offset="1" className="pa-star-edge" />
            </radialGradient>
          </defs>
          <path className="pa-sticker-face" d={STAR_PATH} style={{ fill: `url(#${gradientId})` }} />
        </>
      )}
      </g>
    </svg>
  );
}
