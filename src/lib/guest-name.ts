// Display names, shared by the server and the client.

export const MAX_NAME = 32;

/** Up to two capitals for an avatar disc: "Stanley Wang" → "SW". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
