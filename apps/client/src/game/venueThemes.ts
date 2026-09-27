export type VenueChoreography = {
  motion: 'spin' | 'pendant' | 'float' | 'gimbal' | 'shutter' | 'lantern';
  speed: number;
  travel: number;
  paint: string;
};

const SHOWS: Record<string, VenueChoreography> = {
  disco: { motion: 'spin', speed: .2, travel: 0, paint: '#69536b' },
  house: { motion: 'pendant', speed: .48, travel: .045, paint: '#586a85' },
  electro: { motion: 'float', speed: .85, travel: .075, paint: '#497468' },
  boombap: { motion: 'spin', speed: .32, travel: 0, paint: '#84624b' },
  dnb: { motion: 'spin', speed: .65, travel: 0, paint: '#627553' },
  techhouse: { motion: 'gimbal', speed: .38, travel: .035, paint: '#826d52' },
  techno: { motion: 'shutter', speed: .55, travel: 0, paint: '#555e72' },
  trance: { motion: 'gimbal', speed: .3, travel: .1, paint: '#596e94' },
  triphop: { motion: 'lantern', speed: .28, travel: .045, paint: '#6a6175' },
};

export const venueChoreography = (id: string) => SHOWS[id] ?? SHOWS.house!;
