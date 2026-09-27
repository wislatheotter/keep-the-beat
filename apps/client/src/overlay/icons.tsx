import {
  ArrowBendRightUp,
  ArrowFatDown,
  ArrowFatLinesUp,
  ArrowFatUp,
  ArrowLeft,
  ArrowRight,
  CaretDown,
  CheckFat,
  DeviceMobile,
  DiceFive,
  Export,
  Hand,
  HandGrabbing,
  Hourglass,
  Play,
  Prohibit,
  Sparkle,
  VinylRecord,
  X,
  type Icon as PhosphorIcon,
  type IconWeight,
} from '@phosphor-icons/react';
import type { SVGProps } from 'react';

export type IconName =
  | 'back'
  | 'next'
  | 'take'
  | 'place'
  | 'eject'
  | 'keep'
  | 'wait'
  | 'blocked'
  | 'treat'
  | 'down'
  | 'throw'
  | 'jump'
  | 'dice'
  | 'chevron'
  | 'export'
  | 'record'
  | 'close'
  | 'phone'
  | 'play';

type Drawing = { glyph: PhosphorIcon; weight: IconWeight };

const solid = (glyph: PhosphorIcon): Drawing => ({ glyph, weight: 'fill' });
const line = (glyph: PhosphorIcon): Drawing => ({ glyph, weight: 'bold' });

const DRAWINGS: Record<IconName, Drawing> = {
  back: line(ArrowLeft),
  next: line(ArrowRight),
  take: solid(HandGrabbing),
  place: solid(ArrowFatDown),
  eject: solid(ArrowFatUp),
  keep: solid(CheckFat),
  wait: solid(Hourglass),
  blocked: solid(Prohibit),
  treat: solid(Sparkle),
  down: solid(Hand),
  throw: line(ArrowBendRightUp),
  jump: solid(ArrowFatLinesUp),
  dice: solid(DiceFive),
  chevron: line(CaretDown),
  export: line(Export),
  record: solid(VinylRecord),
  close: line(X),
  phone: solid(DeviceMobile),
  play: solid(Play),
};

export function Icon({ name, className = '', ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const { glyph: Glyph, weight } = DRAWINGS[name];
  return <Glyph weight={weight} className={`hud-icon ${className}`.trim()} aria-hidden="true" focusable="false" {...rest} />;
}
