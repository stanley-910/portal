import { cn } from "@/lib/utils";

// Pip's pixels for the interface's small marks: a glyph drawn cell by cell, and the pixel close button. A glyph is a
// list of rows, one character a cell: `#` in the ink (currentColor), `o` cut out to the surface it sits on, space empty.

/** `scale` is CSS px a cell: 1 for fine marks, 2 for Pip's chunkier ones. */
export function PixelIcon({ rows, scale = 1, className }: { rows: readonly string[]; scale?: 1 | 2; className?: string }) {
  const w = Math.max(...rows.map((r) => r.length));
  return (
    <svg className={cn("pa-px-icon", className)} width={w * scale} height={rows.length * scale} viewBox={`0 0 ${w} ${rows.length}`} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === " " ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} className={c === "#" ? "pa-px-ink" : "pa-px-cut"} />)),
      )}
    </svg>
  );
}

// a 7×7 cross, drawn at 2 px a cell
const CROSS = ["#     #", " #   # ", "  # #  ", "   #   ", "  # #  ", " #   # ", "#     #"];

/** A close button in Pip's pixels: the bare cross in ink-muted, filling with control-hover on hover. */
export function PixelClose({ label = "Close", onClick, className }: { label?: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={cn("pa-px-close", className)} aria-label={label} title={label} onClick={onClick}>
      <svg width={14} height={14} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden>
        {CROSS.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
      </svg>
    </button>
  );
}
