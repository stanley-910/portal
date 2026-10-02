"use client";

import {
  LiveblocksProvider,
  RoomProvider,
  useErrorListener,
  useRoom,
  useStatus,
  useUpdateMyPresence,
} from "@liveblocks/react";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";

import { AvatarStack } from "@/components/multiplayer/avatar-stack";
import { InviteButton } from "@/components/multiplayer/invite-button";
import { RemoteCursors } from "@/components/multiplayer/remote-cursors";
import { RemotePlanes } from "@/components/multiplayer/remote-planes";
import { TripGlobe, type TripGlobeHandle } from "@/components/trip-globe";
import { tripRoomId } from "@/lib/liveblocks/types";

/** Background tabs disconnect after this long, so forgotten tabs stop using collaboration minutes. */
const BACKGROUND_TIMEOUT = 2 * 60 * 1000;
/** A guest who has only just joined can be refused for a moment, until Liveblocks sees the new access. */
const ACCESS_RETRIES = 4;

export function TripRoom({ tripId }: { tripId: string }) {
  return (
    <LiveblocksProvider
      authEndpoint="/api/liveblocks-auth"
      throttle={32}
      backgroundKeepAliveTimeout={BACKGROUND_TIMEOUT}
      badgeLocation="bottom-right"
    >
      <RoomProvider id={tripRoomId(tripId)} initialPresence={{ cursor: null, flight: null }}>
        <TripScreen />
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function TripScreen() {
  const { resolvedTheme } = useTheme();
  const globe = useRef<TripGlobeHandle>(null);
  const updateMyPresence = useUpdateMyPresence();
  const status = useStatus();
  const [full, setFull] = useState(false);
  const room = useRoom();
  const retries = useRef(0);

  useErrorListener((error) => {
    if (error.context.type !== "ROOM_CONNECTION_ERROR") return;
    if (error.context.code === 4005) setFull(true);
    // 4001: no access. Retry with backoff in case this guest was added to the room a moment ago.
    if (error.context.code === 4001 && retries.current < ACCESS_RETRIES) {
      retries.current += 1;
      setTimeout(() => room.reconnect(), 500 * 2 ** retries.current);
    }
  });

  if (full) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-(--space-5)">
        <p className="type-body text-center">This trip is full. Ten people can be in a trip at once.</p>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <TripGlobe
        ref={globe}
        theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto"}
        onPointerLatLng={(cursor) => updateMyPresence({ cursor })}
        onFlightChange={(flight) => updateMyPresence({ flight })}
      />
      <RemotePlanes globe={globe} />
      <RemoteCursors globe={globe} />
      <div className="absolute top-(--space-4) left-(--space-4) flex items-center gap-(--space-3)">
        <AvatarStack />
        <InviteButton />
      </div>
      {status === "reconnecting" || status === "connecting" ? (
        <p role="status" className="type-meta absolute top-(--space-4) left-1/2 -translate-x-1/2 text-ink-muted">
          {status === "connecting" ? "Connecting" : "Reconnecting"}
        </p>
      ) : null}
    </main>
  );
}
