import { Ticket } from '@trip-globe/paper-atlas';

const HKG = { code: 'HKG', city: 'Hong Kong' };
const PVG = { code: 'PVG', city: 'Shanghai' };
const HND = { code: 'HND', city: 'Tokyo' };

export const Landed = () => (
  <div style={{ padding: 'var(--space-4)' }}>
    <Ticket from={HKG} to={PVG} date="Sat 3 Oct" distance="1,227 km" searching={false} onClose={() => {}} />
  </div>
);

export const Searching = () => (
  <div style={{ padding: 'var(--space-4)' }}>
    <Ticket from={PVG} to={HND} date="Mon 5 Oct" distance="1,766 km" searching onClose={() => {}} />
  </div>
);

export const Flat = () => (
  <div style={{ padding: 'var(--space-4)' }}>
    <Ticket from={HKG} to={HND} date="Sun 4 Oct" distance="2,901 km" searching={false} flat />
  </div>
);
