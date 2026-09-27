import { forwardRef, useMemo } from 'react';
import { AdditiveBlending, Color, DoubleSide, type Mesh } from 'three';
import { FORCE_SINGLE_PASS } from './singlePass';

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormalView;
  void main() {
    vUv = uv;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormalView;

  void main() {
    float height = pow(max(1.0 - vUv.y, 0.0), 1.9);
    float rim = pow(max(1.0 - abs(vNormalView.z), 0.0), 1.6);
    gl_FragColor = vec4(uColor, height * (0.25 + rim * 0.75) * uOpacity);
  }
`;

type Props = {
  color: string;
  strength?: number;
};

export const BeaconBeam = forwardRef<Mesh, Props>(function BeaconBeam({ color, strength = 1 }, ref) {
  const uniforms = useMemo(() => ({
    uColor: { value: new Color(color) },
    uOpacity: { value: 0.21 * strength },
  }), [color, strength]);

  const height = 4.2 * (0.45 + strength * 0.55);

  return (
    <mesh ref={ref} position={[0, height / 2 + 0.2, 0]} renderOrder={3}>
      <cylinderGeometry args={[0.34 * (0.6 + strength * 0.4), 0.5 * (0.6 + strength * 0.4), height, 16, 1, true]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        side={DoubleSide}
        forceSinglePass={FORCE_SINGLE_PASS}
        blending={AdditiveBlending}
      />
    </mesh>
  );
});
