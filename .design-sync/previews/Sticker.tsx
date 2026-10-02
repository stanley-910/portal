import { Sticker, Tag } from '@trip-globe/paper-atlas';

const row = { display: 'flex', gap: 48, alignItems: 'center', padding: 'var(--space-4)' } as const;

export const Plane = () => (
  <div style={row}>
    <Sticker shape="plane" size={64} rotate={35} title="Plane" />
    <Sticker shape="plane" rotate={-60} />
  </div>
);

export const StarPins = () => (
  <div style={row}>
    <Sticker shape="star" size={40} title="Origin" />
    <Sticker shape="star" />
  </div>
);

export const Altitude = () => (
  <div style={row}>
    <Sticker shape="plane" rotate={45} altitude={0} title="Landed" />
    <Sticker shape="plane" rotate={45} altitude={0.5} title="Cruising" />
    <Sticker shape="plane" rotate={45} altitude={1} title="High" />
  </div>
);

export const PinWithTag = () => (
  <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-4)' }}>
    <Sticker shape="star" size={26} title="Shanghai" />
    <Tag>PVG</Tag>
  </div>
);
