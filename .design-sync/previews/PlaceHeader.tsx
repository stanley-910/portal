import { PlaceHeader } from '@trip-globe/paper-atlas';

export const Destination = () => <PlaceHeader eyebrow="Flights to" name="Shanghai" detail="Pudong · PVG" />;

export const Origin = () => <PlaceHeader eyebrow="Leaving from" name="Hong Kong" detail="West Kowloon · high-speed rail" />;

export const NameOnly = () => <PlaceHeader name="Tokyo" as="h3" />;
