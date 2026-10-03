import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Playground } from "./playground";
import "./playground.css";

export const metadata: Metadata = { title: "Playground · Portal" };

/**
 * Every clickable, typeable piece of the UI at the size it renders on the globe, with made-up data and nothing saved.
 * Home: the home globe's overlays on a flat stand-in globe. Trip: a trip room there, in the local party trip. Panels:
 * everything else. Dev only.
 */
export default function PlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      {/* dev:party runs the local Liveblocks server, which the trip room needs */}
      <Playground party={!!process.env.LIVEBLOCKS_BASE_URL} />
    </Suspense>
  );
}
