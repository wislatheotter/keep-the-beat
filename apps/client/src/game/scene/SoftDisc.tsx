import { useMemo } from 'react';
import { Color, type ColorRepresentation } from 'three';

export function SoftDisc({
  radius = 1,
  color = '#000000',
  opacity = 0.2,
  y = 0.025,
}: {
  radius?: number;
  color?: ColorRepresentation;
  opacity?: number;
  y?: number;
}) {
  const uniforms = useMemo(() => ({
    uColor: { value: new Color(color) },
    uOpacity: { value: opacity },
  }), [color, opacity]);

  return (
    <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`}
        fragmentShader={`
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec2 vUv;
          void main(){
            float d = length((vUv - 0.5) * 2.0);
            float a = (1.0 - smoothstep(0.38, 1.0, d)) * uOpacity;
            gl_FragColor = vec4(uColor, a);
          }
        `}
      />
    </mesh>
  );
}
