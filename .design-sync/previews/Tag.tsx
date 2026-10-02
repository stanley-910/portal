import { Tag } from '@trip-globe/paper-atlas';

export const Airport = () => <Tag>HKG</Tag>;

export const DemoRoute = () => (
  <div style={{ display: 'flex', gap: 'var(--space-gap)', alignItems: 'center' }}>
    <Tag>HKG</Tag>
    <Tag>PVG</Tag>
    <Tag>ICN</Tag>
    <Tag>HND</Tag>
  </div>
);
