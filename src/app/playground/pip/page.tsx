import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PipLab } from "./pip-lab";
import "../playground.css";
import "./pip-lab.css";

export const metadata: Metadata = { title: "Pip lab · Portal" };

/** Pip's tool calls played from scripts on the real globe, to watch the saucer's transitions. Dev only. */
export default function PipLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PipLab />;
}
