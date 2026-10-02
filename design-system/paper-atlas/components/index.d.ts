import type * as React from 'react';

export interface ButtonProps {
  /** primary: ink fill, one per view. secondary: outlined. quiet: text only. Default primary. */
  variant?: 'primary' | 'secondary' | 'quiet';
  /** A 16px inline stroke SVG shown before the label. */
  icon?: React.ReactNode;
  /** Stretch to the container's width. */
  block?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Required when the button has an icon and no label. */
  'aria-label'?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface PanelProps {
  /** Shows a RoundButton in the top-right corner when given. */
  onClose?: () => void;
  /** Accessible name of the close button. Default 'Close'. */
  closeLabel?: string;
  /** Names the panel for screen readers when it has no visible heading. */
  'aria-label'?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Panel(props: PanelProps): React.ReactElement;

export interface PlaceHeaderProps {
  /** Interface text above the place, e.g. 'Flights to'. */
  eyebrow?: string;
  /** The place, set in the atlas serif, e.g. 'Paris'. */
  name: string;
  /** Italic line under the name, e.g. 'Charles de Gaulle · CDG'. */
  detail?: string;
  /** Heading level for the name. Default 'h2'. */
  as?: 'h1' | 'h2' | 'h3' | 'div';
  className?: string;
  style?: React.CSSProperties;
}
export declare function PlaceHeader(props: PlaceHeaderProps): React.ReactElement;

export interface Place { code: string; city: string }

export interface TicketProps {
  /** Origin airport, e.g. { code: 'HKG', city: 'Hong Kong' }. */
  from: Place;
  /** Destination airport. */
  to: Place;
  /** Departure date as shown, e.g. 'Sat 3 Oct' (set in capitals by the style). */
  date: string;
  /** Distance as shown, e.g. '9,624 km'. */
  distance?: string;
  /** Route marches and the three dots bob while true. Default true. */
  searching?: boolean;
  /** Shows the round close button when given. */
  onClose?: () => void;
  /** Accessible name of the close button. Default 'Cancel trip'. */
  closeLabel?: string;
  /** Drop the -1.2deg tilt (for lists, not the globe screen). */
  flat?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Ticket(props: TicketProps): React.ReactElement;

export interface TagProps { children: React.ReactNode; className?: string; style?: React.CSSProperties }
export declare function Tag(props: TagProps): React.ReactElement;

export interface StickerProps {
  /** How high it flies, 0 (on the page) to 1. Default 0.5 for plane, 0 for star. */
  altitude?: number;
  shape: 'plane' | 'star';
  /** Rendered size in px. Default 44 for the plane, 28 for the star. */
  size?: number;
  /** Degrees; for the plane, 0 points north (up). */
  rotate?: number;
  /** Accessible name; omit for a decorative sticker. */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Sticker(props: StickerProps): React.ReactElement;

export interface RouteProps {
  width?: number;
  height?: number;
  /** 0 is flat, 1 a full arc. Default 1. */
  lift?: number;
  /** Dashes march forward (a search is running). */
  marching?: boolean;
  className?: string;
}
export declare function Route(props: RouteProps): React.ReactElement;

export interface RoundButtonProps {
  /** Accessible name, e.g. 'Cancel trip'. Default 'Close'. */
  label?: string;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}
export declare function RoundButton(props: RoundButtonProps): React.ReactElement;

export type MemberColor = "member-1" | "member-2" | "member-3" | "member-4" | "member-5" | "member-6";
export interface CursorProps {
  /** Default "arrow". Use one shape for everyone in a room. */
  shape?: "arrow" | "compass" | "map";
  /** The member's sticker colour; get it from memberColor(slot). */
  color: MemberColor;
  /** How high it flies, 0 (touching the map) to 1. Sets how far off and soft the shadow falls. Default 0.5. */
  altitude?: number;
  /** The member's name, on a label beside the cursor. */
  name?: string;
  /** Tip position in px, relative to the positioned parent. */
  x?: number;
  y?: number;
  className?: string;
  style?: React.CSSProperties;
}
/** Another trip member's pointer: a sticker in their colour, with their name on a label. */
export declare function Cursor(props: CursorProps): React.ReactElement;
/** The colour for a member's slot (e.g. a Liveblocks connectionId); a seventh member starts again at member-1. */
export declare function memberColor(slot: number): MemberColor;

declare global {
  interface Window {
    PaperAtlas: { Button: typeof Button; Panel: typeof Panel; PlaceHeader: typeof PlaceHeader; Ticket: typeof Ticket; Tag: typeof Tag; Sticker: typeof Sticker; Route: typeof Route; RoundButton: typeof RoundButton; Cursor: typeof Cursor; memberColor: typeof memberColor; MEMBER_COLORS: MemberColor[] };
  }
}
