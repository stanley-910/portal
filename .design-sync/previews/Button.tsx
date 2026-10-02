import { Button } from '@trip-globe/paper-atlas';

const plane = (
  <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
    <path d="M2 9 L14 3 L10 14 L8 9 Z" />
  </svg>
);

export const Primary = () => <Button icon={plane}>Search flights</Button>;

export const Variants = () => (
  <div style={{ display: 'flex', gap: 'var(--space-gap)', flexWrap: 'wrap', alignItems: 'center' }}>
    <Button>Search flights</Button>
    <Button variant="secondary">Change date</Button>
    <Button variant="quiet">Clear</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 'var(--space-gap)', flexWrap: 'wrap', alignItems: 'center' }}>
    <Button disabled>Search flights</Button>
    <Button variant="secondary" disabled>Change date</Button>
  </div>
);

export const Block = () => (
  <div style={{ width: 280 }}>
    <Button block>Book this route</Button>
  </div>
);
