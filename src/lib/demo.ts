/**
 * Build-time switches for recording a demo. Public on purpose: they only change what the page shows, never what the
 * server does. Leave them unset outside a recording so test fares stay labelled.
 */
export const HIDE_SANDBOX_BADGE = process.env.NEXT_PUBLIC_HIDE_SANDBOX_BADGE === "1";
