import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { sample as gameSample, type SampleRole } from '@loop/shared';
import { LABEL_SIZE, layerColor, recordLabel } from '../game/recordArt';

export const RecordFace = memo(function RecordFace({
  role,
  family = '',
  sampleName,
  spinning = false,
  className = '',
}: {
  role: SampleRole;
  family?: string;
  sampleName: string | null;
  spinning?: boolean;
  className?: string;
}) {
  const resolved = useMemo(() => (sampleName ? gameSample(sampleName)?.family ?? family : family), [sampleName, family]);
  const face = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const context = face.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, LABEL_SIZE, LABEL_SIZE);
    context.drawImage(recordLabel(role, resolved, sampleName), 0, 0);
  }, [role, resolved, sampleName]);
  return (
    <span
      className={`record-face${spinning ? ' is-spinning' : ''} ${className}`.trim()}
      style={{ ['--layer' as string]: layerColor(role) } as CSSProperties}
      aria-hidden="true"
    >
      <canvas ref={face} width={LABEL_SIZE} height={LABEL_SIZE} />
    </span>
  );
});
