import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, InstancedMesh, MathUtils, Matrix4, Mesh, MeshStandardMaterial, ShaderMaterial, Vector3, type Group, type Object3D } from 'three';
import { theme } from '@loop/shared';
import { useGameRuntime, useGameStateWhen } from '../../runtime/GameRuntimeContext';
import { beatInfo, crowdCheer, showEnergy } from '../beat';
import { audioFrame } from '../audioMeter';
import { decorativeMotion } from '../motion';
import { PERFORMANCE } from '../performance';
import { venueChoreography } from '../venueThemes';
import { hideFromReflection } from '../layers';
import { useBackstage } from '../backstage';
import { markScenery } from './sceneryBatches';

export const VENUE_FILE = '/stations/venue.glb';

function followTwins(twins: Map<MeshStandardMaterial, MeshStandardMaterial>) {
  for (const [material, twin] of twins) {
    twin.color.copy(material.color);
    twin.emissive.copy(material.emissive);
    twin.emissiveIntensity = material.emissiveIntensity;
  }
}

export function Venue() {
  const { scene } = useGLTF(VENUE_FILE, '/draco/') as unknown as { scene: Group };
  const state = useGameStateWhen((room) => room.themeId);
  const runtime = useGameRuntime();
  const look = theme(state.themeId).look;
  const choreography = venueChoreography(state.themeId);
  const model = useMemo(() => {
    const root = markScenery(scene.clone(true));
    const wardrobe = root.getObjectByName('Venue_Themes');
    const shows = new Map(wardrobe?.children
      .filter((node) => node.name.startsWith('Show_'))
      .map((node) => [node.name.slice('Show_'.length), node]) ?? []);
    for (let i = 0; i < 4; i++) {
      const star = root.getObjectByName(`Venue_Star${i}`);
      if (star) star.removeFromParent();
    }
    const materials = new Map<string, MeshStandardMaterial>();
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const source = node.material as MeshStandardMaterial;
      const kind = source.name.split('.')[0]!.replace('Venue_', '');
      let material = materials.get(kind);
      if (!material) {
        material = source.clone();
        material.envMapIntensity = 0.9;
        if (kind === 'Neon' || kind === 'Cool') {
          material.toneMapped = false;
        }
        if (kind.startsWith('Show_') && /_(Accent|Light)$/.test(kind)) material.toneMapped = false;
        materials.set(kind, material);
      }
      node.material = material;
      node.castShadow = PERFORMANCE.shadows && kind !== 'Neon' && kind !== 'Cool' && node.parent?.name === 'Venue_Static';
      node.receiveShadow = true;
    });
    const sources = new Map<string, Mesh[]>();
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const family = node.parent?.name.match(/^Venue_(Head|Cones)\d+$/)?.[1]
        ?? node.parent?.name.match(/^Show_(Panel|Mobile)_\w+_\d+$/)?.[1];
      if (!family) return;
      const key = `${family}:${(node.material as MeshStandardMaterial).uuid}`;
      const group = sources.get(key) ?? [];
      group.push(node);
      sources.set(key, group);
    });
    const batched = new Set([...sources.values()].flat());
    const alone = new Set<MeshStandardMaterial>();
    root.traverse((node) => {
      if (node instanceof Mesh && !batched.has(node)) alone.add(node.material as MeshStandardMaterial);
    });
    const twins = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    const twinOf = (material: MeshStandardMaterial) => {
      if (!alone.has(material)) return material;
      if (!twins.has(material)) twins.set(material, material.clone());
      return twins.get(material)!;
    };
    const batches = [...sources.values()].map((sources) => {
      const source = sources[0]!;
      const mesh = new InstancedMesh(source.geometry, twinOf(source.material as MeshStandardMaterial), sources.length);
      mesh.name = `Venue_Batch_${source.parent?.name}_${(source.material as MeshStandardMaterial).name}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      sources.forEach(source => { source.visible = false; });
      root.add(mesh);
      const themeId = source.parent?.name.match(/^Show_(?:Panel|Mobile)_([^_]+)_\d+$/)?.[1] ?? null;
      return { mesh, sources, themeId, moving: !source.parent?.name.startsWith('Show_Panel_') };
    });
    const beamGeometry = new CylinderGeometry(.07, 1.25, 1, 12, 1, true);
    beamGeometry.translate(0, -.5, 0);
    const beams: Mesh<CylinderGeometry, ShaderMaterial>[] = [];
    const part = (name: string) => root.getObjectByName(name)!;
    const cones = [0, 1].map((i) => part(`Venue_Cones${i}`));
    const heads = Array.from({ length: 7 }, (_, i) => ({ node: part(`Venue_Head${i}`) }));
    if (PERFORMANCE.volumetricLights) heads.forEach(({ node }, i) => {
      if (i % 2) return;
      const beam = new Mesh(beamGeometry, new ShaderMaterial({
        uniforms: { uColor: { value: new Color(i % 4 ? look.secondary : look.accent) }, uOpacity: { value: .04 } },
        vertexShader: `varying vec2 vUv; varying vec3 vNormalView; void main(){vUv=uv;vNormalView=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec2 vUv; varying vec3 vNormalView; uniform vec3 uColor; uniform float uOpacity;
          void main(){float ends=smoothstep(0.0,.16,vUv.y)*(1.0-smoothstep(.82,1.0,vUv.y));
          float edge=pow(clamp(abs(vNormalView.z),0.0,1.0),1.4);
          gl_FragColor=vec4(uColor,uOpacity*ends*edge*(.3+.7*vUv.y));}`,
        transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, blending: AdditiveBlending, toneMapped: false,
      }));
      beam.position.copy(node.position);
      beam.userData.head = i;
      beam.renderOrder = 2;
      beams.push(beam); root.add(beam);
    });
    const mobiles = [...shows.entries()].flatMap(([themeId, show]) => show.children
      .filter(node => node.name.startsWith('Show_Mobile_'))
      .map(node => ({ themeId, node, rest: node.quaternion.clone(), height: node.position.y })));
    const inverse = new Matrix4(), matrix = new Matrix4();
    root.updateMatrixWorld(true);
    inverse.copy(root.matrixWorld).invert();
    for (const { mesh, sources } of batches) {
      sources.forEach((source, i) => { matrix.multiplyMatrices(inverse, source.matrixWorld); mesh.setMatrixAt(i, matrix); });
      mesh.instanceMatrix.needsUpdate = true;
    }
    const showLights = [...materials.entries()]
      .filter(([kind]) => kind.startsWith('Show_') && /_(Accent|Light)$/.test(kind))
      .map(([kind, material]) => ({ themeId: kind.match(/^Show_([^_]+)_/)?.[1] ?? '', material }));
    return { root, wardrobe, shows, materials, twins, cones, heads, mobiles, showLights, beams, beamGeometry, batches, inverse, matrix,
      travelTime: 0, sweepTime: 0, target: new Vector3(), direction: new Vector3(), down: new Vector3(0,-1,0), emblem: part('Venue_Emblem'),
      worn: { themeId: '', rehearsing: null as string | null } };
  }, [scene]);
  useEffect(() => () => { for (const mat of model.materials.values()) mat.dispose();
    for (const twin of model.twins.values()) twin.dispose();
    for (const beam of model.beams) beam.material.dispose();
    model.beamGeometry.dispose();
    model.batches.forEach(({ mesh }) => mesh.dispose()); }, [model]);
  useEffect(() => {
    wear(model, state.themeId, useBackstage.getState().rehearsing);
    const neon = model.materials.get('Neon');
    const cool = model.materials.get('Cool');
    if (neon) { neon.color.set(look.accent); neon.emissive.copy(neon.color); }
    if (cool) { cool.color.set(look.secondary); cool.emissive.copy(cool.color); }
    model.materials.get('Enamel')?.color.set(choreography.paint);
    for (const beam of model.beams) beam.material.uniforms.uColor!.value.set(
      beam.userData.head % 4 ? look.secondary : look.accent,
    );
  }, [model, state.themeId, look, choreography]);
  useFrame(({ clock }, delta) => {
    const state = runtime.getState();
    const rehearsing = useBackstage.getState().rehearsing;
    if (rehearsing !== model.worn.rehearsing) wear(model, model.worn.themeId, rehearsing);
    const now = runtime.now();
    const time = clock.elapsedTime;
    const beat = beatInfo(state, now);
    const energy = showEnergy(state, now);
    const cheer = crowdCheer(state, now);
    const motion = decorativeMotion();
    const animate = motion > .5 ? 1 : 0;
    const dt = Math.min(delta, .05);
    model.travelTime += dt * choreography.speed * (.55 + energy * .7) * animate;
    model.sweepTime += dt * look.sweepGain * (.18 + energy * .13) * animate;
    const audio = audioFrame(state, beat, time);
    const neon = model.materials.get('Neon');
    const cool = model.materials.get('Cool');
    if (neon) neon.emissiveIntensity = 0.65 + energy * 0.55 + beat.pulse * 0.2 * motion + cheer * 0.9;
    if (cool) cool.emissiveIntensity = 0.55 + energy * 0.45 + beat.pulse * 0.3 * motion + cheer * 0.7;
    model.cones.forEach((node) => { node.scale.z = 1 + audio.low * 0.04 * animate; });
    for (const { themeId, material } of model.showLights) {
      if (themeId !== state.themeId) continue;
      material.emissiveIntensity = MathUtils.damp(material.emissiveIntensity,
        .38 + energy * .27 + (audio.levels.MUSIC * .2 + audio.levels.TOPS * .12 + cheer * .3) * animate, 5, dt);
    }
    model.heads.forEach(({ node }, i) => {
      const phase = model.sweepTime + i * .9;
      model.target.set(Math.sin(phase) * (9 - cheer*3), .05, -2 + Math.cos(phase*.7)*6);
      node.lookAt(model.target);
      const beam = model.beams.find(b => b.userData.head === i);
      if (beam) {
        model.direction.copy(model.target).sub(node.position);
        beam.scale.y = model.direction.length();
        beam.quaternion.setFromUnitVectors(model.down, model.direction.normalize());
        beam.material.uniforms.uOpacity!.value = .01 + energy*.022 + cheer*.025;
      }
    });
    model.mobiles.forEach(({ themeId, node, rest, height }, i) => {
      if (themeId !== state.themeId) return;
      const t = model.travelTime, phase = i * 1.13;
      node.quaternion.copy(rest);
      node.position.y = height + Math.sin(t + phase) * choreography.travel * animate;
      switch (choreography.motion) {
        case 'spin': node.rotateZ(t * (i % 2 ? -1 : 1)); break;
        case 'gimbal': node.rotateY(t); node.rotateZ(Math.sin(t + phase) * .13 * animate); break;
        case 'shutter': node.rotateY(Math.sin(t + phase) * (.12 + energy * .3) * animate); break;
        case 'pendant': node.rotateY(Math.sin(t + phase) * .28 * animate); node.rotateZ(Math.sin(t*.7 + phase) * .06 * animate); break;
        case 'float': node.rotateZ(Math.sin(t + phase) * .1 * animate); break;
        case 'lantern': node.rotateZ(Math.sin(t + phase) * .055 * animate); break;
      }
    });
    model.emblem.rotation.z += dt * (0.045 + energy * 0.05 + cheer * 0.12) * animate;
    followTwins(model.twins);
    model.root.updateWorldMatrix(true, false);
    model.inverse.copy(model.root.matrixWorld).invert();
    for (const { mesh, sources, themeId, moving } of model.batches) {
      if (!moving || (themeId && themeId !== state.themeId)) continue;
      sources.forEach((source, i) => {
        source.updateWorldMatrix(true, false);
        model.matrix.multiplyMatrices(model.inverse, source.matrixWorld);
        mesh.setMatrixAt(i, model.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  });
  useEffect(() => hideFromReflection(model.root), [model]);

  return <primitive object={model.root} />;
}

function wear(model: {
  shows: Map<string, Object3D>;
  batches: Array<{ mesh: InstancedMesh; themeId: string | null }>;
  emblem: Object3D;
  worn: { themeId: string; rehearsing: string | null };
}, themeId: string, rehearsing: string | null) {
  model.worn.themeId = themeId;
  model.worn.rehearsing = rehearsing;
  const chosen = model.shows.get(themeId) ?? model.shows.get('house');
  const chosenId = chosen?.name.slice('Show_'.length) ?? 'house';
  for (const [id, show] of model.shows) show.visible = show === chosen || id === rehearsing;
  for (const batch of model.batches) batch.mesh.visible = !batch.themeId || batch.themeId === chosenId || batch.themeId === rehearsing;
  model.emblem.visible = !chosen;
}

useGLTF.preload(VENUE_FILE, '/draco/');
