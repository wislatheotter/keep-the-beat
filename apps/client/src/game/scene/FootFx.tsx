import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { IcosahedronGeometry, InstancedMesh, Object3D } from 'three';
import { DUST_BALL_COUNT, DUST_COLOR, dustBalls } from '../footfalls';
import { furToonMaterial } from '../toon';

const dummy = new Object3D();
const DUST_OPACITY = 0.6;

export function FootFx() {
  const mesh = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new IcosahedronGeometry(1, 2), []);
  const material = useMemo(() => {
    const dust = furToonMaterial(DUST_COLOR);
    dust.transparent = true;
    dust.opacity = DUST_OPACITY;
    dust.depthWrite = false;
    return dust;
  }, []);

  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < DUST_BALL_COUNT; i += 1) instances.setMatrixAt(i, dummy.matrix);
    instances.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((_, delta) => {
    const instances = mesh.current;
    if (!instances) return;
    const dt = Math.min(delta, 0.05);
    let touched = false;
    for (let i = 0; i < DUST_BALL_COUNT; i += 1) {
      const ball = dustBalls[i]!;
      if (ball.life <= 0) {
        if (ball.size !== 0) {
          ball.size = 0;
          dummy.position.set(0, -50, 0);
          dummy.scale.setScalar(0);
          dummy.updateMatrix();
          instances.setMatrixAt(i, dummy.matrix);
          touched = true;
        }
        continue;
      }
      ball.life -= dt;
      const drag = Math.pow(0.02, dt);
      ball.vx *= drag;
      ball.vz *= drag;
      ball.vy *= Math.pow(0.1, dt);
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.z += ball.vz * dt;
      const age = 1 - Math.max(0, ball.life) / ball.maxLife;
      dummy.position.set(ball.x, ball.y, ball.z);
      dummy.scale.setScalar(ball.life > 0 ? ball.size * puffScale(age) : 0);
      dummy.updateMatrix();
      instances.setMatrixAt(i, dummy.matrix);
      touched = true;
    }
    if (touched) instances.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, DUST_BALL_COUNT]} frustumCulled={false} renderOrder={4} />;
}

function puffScale(age: number) {
  const pop = Math.min(1, age / 0.2);
  const c = 2.2;
  const grow = 1 + (c + 1) * (pop - 1) ** 3 + c * (pop - 1) ** 2;
  const shrink = Math.min(1, Math.max(0, (age - 0.5) / 0.5));
  return grow * (1 - shrink * shrink);
}
