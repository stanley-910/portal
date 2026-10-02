// ES module entry for the Paper Atlas bundle. components/bundle.js is a classic
// script that reads window.React and assigns window.PaperAtlas; this loads it
// and re-exports its components so bundlers can import them.
import './react-global.mjs';
import './components/bundle.js';

const P = globalThis.PaperAtlas;

export const Button = P.Button;
export const RoundButton = P.RoundButton;
export const Panel = P.Panel;
export const PlaceHeader = P.PlaceHeader;
export const Ticket = P.Ticket;
export const Tag = P.Tag;
export const Sticker = P.Sticker;
export const Route = P.Route;
export const Cursor = P.Cursor;
export const memberColor = P.memberColor;
export const MEMBER_COLORS = P.MEMBER_COLORS;
