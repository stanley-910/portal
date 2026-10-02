import { Route } from '@trip-globe/paper-atlas';

const box = { padding: 'var(--space-4)' } as const;

export const Arc = () => <div style={box}><Route width={200} height={48} /></div>;

export const Searching = () => <div style={box}><Route width={200} height={48} marching /></div>;

export const LowArc = () => <div style={box}><Route width={200} height={48} lift={0.4} /></div>;
