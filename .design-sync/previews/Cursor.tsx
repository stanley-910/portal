import { Cursor, memberColor } from '@trip-globe/paper-atlas';

const PEOPLE = ['Mei', 'Joon', 'Aiko', 'Ravi', 'Lena', 'Tomás'];

export const Members = () => (
  <div style={{ position: 'relative', width: 560, height: 120 }}>
    {PEOPLE.map((name, i) => (
      <Cursor key={name} color={memberColor(i)} name={name} x={16 + i * 92} y={16 + (i % 2) * 36} />
    ))}
  </div>
);

export const Shapes = () => (
  <div style={{ position: 'relative', width: 300, height: 70 }}>
    <Cursor shape="arrow" color="member-1" x={20} y={16} />
    <Cursor shape="compass" color="member-2" x={120} y={16} />
    <Cursor shape="map" color="member-3" x={220} y={16} />
  </div>
);

export const OverTheMap = () => (
  <div
    style={{
      position: 'relative', width: 420, height: 140, borderRadius: 'var(--radius-ticket)',
      backgroundImage: 'radial-gradient(var(--sea) 32%, transparent 36%)',
      backgroundSize: 'var(--halftone-pitch) var(--halftone-pitch)',
    }}
  >
    <Cursor color="member-1" name="Mei" altitude={0.1} x={40} y={30} />
    <Cursor color="member-2" name="Joon" altitude={0.5} x={170} y={40} />
    <Cursor color="member-3" name="Aiko" altitude={1} x={300} y={30} />
  </div>
);
