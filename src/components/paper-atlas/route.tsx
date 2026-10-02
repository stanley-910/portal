import { cn } from "@/lib/utils";

export interface RouteProps {
  width?: number;
  height?: number;
  /** 0 is flat, 1 a full arc. Default 1. */
  lift?: number;
  /** Dashes march forward (a search is running). */
  marching?: boolean;
  className?: string;
}

/** A dashed ink arc between two places, for flat layouts such as the ticket and lists. */
export function Route({ width = 96, height = 28, lift = 1, marching = false, className }: RouteProps) {
  const y0 = height - 5;
  const top = y0 - (height + 4) * lift;
  return (
    <svg
      className={cn("pa-route", marching && "pa-route-marching", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <path d={`M3 ${y0} Q${width / 2} ${top.toFixed(1)} ${width - 3} ${y0}`} />
    </svg>
  );
}
