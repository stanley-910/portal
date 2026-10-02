import { Button, Panel, PlaceHeader } from '@trip-globe/paper-atlas';

export const DestinationPanel = () => (
  <div style={{ maxWidth: 440 }}>
    <Panel onClose={() => {}} closeLabel="Close results">
      <PlaceHeader eyebrow="Flights to" name="Shanghai" detail="Pudong · PVG" />
      <div style={{ height: 1, background: 'var(--line)' }} />
      <p className="type-body" style={{ margin: 0 }}>Six flights leave tomorrow morning.</p>
      <div style={{ display: 'flex', gap: 'var(--space-gap)', flexWrap: 'wrap' }}>
        <Button>Search flights</Button>
        <Button variant="secondary">Change date</Button>
        <Button variant="quiet">Clear</Button>
      </div>
    </Panel>
  </div>
);

export const WithoutClose = () => (
  <div style={{ maxWidth: 360 }}>
    <Panel aria-label="Trip members">
      <h3 className="type-heading" style={{ margin: 0 }}>Who is coming</h3>
      <p className="type-body" style={{ margin: 0 }}>Three friends meet in Shanghai on Saturday.</p>
      <Button variant="secondary" block>Invite a friend</Button>
    </Panel>
  </div>
);
