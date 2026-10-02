import { RoundButton } from '@trip-globe/paper-atlas';

export const Close = () => <RoundButton label="Cancel trip" onClick={() => {}} />;

export const OnPaper = () => (
  <div style={{ display: 'flex', gap: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--paper)', borderRadius: 'var(--radius-panel)' }}>
    <RoundButton label="Close results" />
    <RoundButton label="Close details" />
  </div>
);
