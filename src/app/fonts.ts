// Paper Atlas faces (DESIGN.md › Type), self-hosted by next/font. The variables override the
// zero-specificity stacks in src/design/tokens.css, so --font-fell-sc etc. resolve to these files.
import { Barlow_Semi_Condensed, Courier_Prime, IM_Fell_English, IM_Fell_English_SC } from "next/font/google";

const sans = Barlow_Semi_Condensed({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-sans",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});
const fellSC = IM_Fell_English_SC({ weight: "400", subsets: ["latin"], variable: "--font-fell-sc", fallback: ["Georgia", "serif"] });
const fell = IM_Fell_English({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-fell", fallback: ["Georgia", "serif"] });
const typewriter = Courier_Prime({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-typewriter",
  fallback: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
});

export const fontVariables = [sans.variable, fellSC.variable, fell.variable, typewriter.variable].join(" ");
