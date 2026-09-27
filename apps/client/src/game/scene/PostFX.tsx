import { Bloom, EffectComposer, HueSaturation, ToneMapping, Vignette } from '@react-three/postprocessing';
import {
  BlendFunction, EdgeDetectionMode, EffectPass, FXAAEffect, SMAAEffect, SMAAPreset, ToneMappingMode,
  type EffectComposer as EffectComposerImpl, type Pass,
} from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector2, type Camera, type Material, type Mesh, type Scene } from 'three';
import type { BloomEffect, HueSaturationEffect, VignetteEffect } from 'postprocessing';
import { useGameRuntime } from '../../runtime/GameRuntimeContext';
import { crowdCheer, showEnergy } from '../beat';
import { PERFORMANCE } from '../performance';
import { LIVE_QUALITY } from '../liveQuality';
import { ShowExposureEffect } from './showExposure';
import { finaleDark } from '../stage';

const VIGNETTE = 0.62;
const cssSize = new Vector2();
const SATURATION = 0.16;

export type PostWarmTarget = { scene: Scene; camera: Camera; screen: Mesh; materials: Material[] };

export function PostFX({ onReady }: { onReady: (targets: PostWarmTarget[]) => void }) {
  const runtime = useGameRuntime();
  const bloom = useRef<BloomEffect>(null);
  const composer = useRef<EffectComposerImpl>(null);
  const vignette = useRef<VignetteEffect>(null);
  const hueSaturation = useRef<HueSaturationEffect>(null);
  const gl = useThree((three) => three.gl);
  const camera = useThree((three) => three.camera);
  const aa = useMemo(() => {
    const fxaa = new EffectPass(camera, new FXAAEffect());
    const smaaEffect = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
    const smaa = new EffectPass(camera, smaaEffect);
    smaa.enabled = false;
    return { fxaa, smaa, smaaEffect };
  }, [camera]);
  useEffect(() => () => {
    aa.fxaa.dispose();
    aa.smaa.dispose();
  }, [aa]);
  const sizedFor = useRef({ ratio: 0, width: 0, height: 0 });
  const exposure = useMemo(() => new ShowExposureEffect(), []);
  useEffect(() => () => exposure.dispose(), [exposure]);
  const baseIntensity = PERFORMANCE.richBloom ? 0.62 : 0.5;

  useEffect(() => {
    let frame = 0;
    const find = () => {
      const effect = bloom.current;
      const pipeline = composer.current;
      if (!effect || !pipeline) { frame = requestAnimationFrame(find); return; }
      const internal = effect as BloomEffect & {
        blurPass: Pass & { _blurMaterial?: Material; copyMaterial?: Material };
        luminancePass: Pass;
        mipmapBlurPass: Pass & { downsamplingMaterial?: Material; upsamplingMaterial?: Material };
      };
      const mipmap = internal.mipmapBlurPass as typeof internal.mipmapBlurPass & {
        scene?: Scene; camera?: Camera; screen?: Mesh;
      };
      if (mipmap.downsamplingMaterial && !mipmap.screen) {
        mipmap.fullscreenMaterial = mipmap.downsamplingMaterial;
      }
      if (!mipmap.downsamplingMaterial || !mipmap.upsamplingMaterial
        || !mipmap.scene || !mipmap.camera || !mipmap.screen) {
        frame = requestAnimationFrame(find);
        return;
      }
      const targets: PostWarmTarget[] = [];
      const addPass = (pass: Pass, extras: Array<Material | undefined> = []) => {
        const exposed = pass as Pass & { scene: Scene; camera: Camera; screen: Mesh };
        const materials = new Set([pass.fullscreenMaterial, ...extras].filter((value): value is Material => !!value));
        const screen = exposed.screen ?? exposed.scene?.children[0] as Mesh | undefined;
        if (materials.size && exposed.scene && exposed.camera && screen) {
          targets.push({ scene: exposed.scene, camera: exposed.camera, screen, materials: [...materials] });
        }
      };
      pipeline.passes.forEach((pass) => addPass(pass));
      const smaaPasses = aa.smaaEffect as SMAAEffect & { edgeDetectionPass: Pass; weightsPass: Pass };
      addPass(smaaPasses.edgeDetectionPass);
      addPass(smaaPasses.weightsPass);
      addPass(internal.luminancePass);
      addPass(internal.blurPass, [
        internal.blurPass._blurMaterial, internal.blurPass.copyMaterial,
      ]);
      targets.push({
        scene: mipmap.scene,
        camera: mipmap.camera,
        screen: mipmap.screen ?? mipmap.scene.children[0] as Mesh,
        materials: [mipmap.downsamplingMaterial, mipmap.upsamplingMaterial],
      });
      onReady(targets);
    };
    find();
    return () => cancelAnimationFrame(frame);
  }, [onReady, aa]);

  useFrame(() => {
    const pixelRatio = gl.getPixelRatio();
    gl.getSize(cssSize);
    const sized = sizedFor.current;
    if ((pixelRatio !== sized.ratio || cssSize.width !== sized.width || cssSize.height !== sized.height) && composer.current) {
      composer.current.setSize(cssSize.width, cssSize.height);
      sized.ratio = pixelRatio;
      sized.width = cssSize.width;
      sized.height = cssSize.height;
    }

    const pipeline = composer.current;
    if (pipeline) {
      const passes = pipeline.passes;
      const main = passes[passes.indexOf(aa.fxaa) - 1];
      if (main) {
        const better = LIVE_QUALITY.smaa;
        const fast = !better && LIVE_QUALITY.fxaa;
        if (aa.smaa.enabled !== better) aa.smaa.enabled = better;
        if (aa.fxaa.enabled !== fast) aa.fxaa.enabled = fast;
        if (!aa.fxaa.renderToScreen) aa.fxaa.renderToScreen = true;
        if (!aa.smaa.renderToScreen) aa.smaa.renderToScreen = true;
        if (main.renderToScreen !== (!better && !fast)) main.renderToScreen = !better && !fast;
      }
    }

    const state = runtime.getState();
    const now = runtime.now();
    const energy = showEnergy(state, now);
    const cheer = crowdCheer(state, now);
    exposure.exposure = (1 + energy * 0.03 + cheer * 0.12) * (1 - finaleDark(state, now));
    if (hueSaturation.current) hueSaturation.current.saturation = SATURATION + cheer * 0.09;
    const effect = bloom.current;
    if (!effect) return;
    effect.intensity = baseIntensity * (0.72 + energy * 0.5);
  });

  return (
    <EffectComposer
      ref={composer}
      multisampling={PERFORMANCE.multisampling}
      enableNormalPass={false}
    >
      <Bloom
        ref={bloom}
        intensity={baseIntensity}
        luminanceThreshold={1.0}
        luminanceSmoothing={0.45}
        mipmapBlur
        radius={PERFORMANCE.richBloom ? 0.7 : 0.58}
        levels={PERFORMANCE.richBloom ? 6 : 4}
      />
      {PERFORMANCE.vignette ? (
        <Vignette ref={vignette} offset={0.28} darkness={VIGNETTE} blendFunction={BlendFunction.NORMAL} />
      ) : (
        <></>
      )}
      <primitive object={exposure} dispose={null} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <HueSaturation ref={hueSaturation} saturation={SATURATION} hue={0} />
      <primitive object={aa.fxaa} dispose={null} />
      <primitive object={aa.smaa} dispose={null} />
    </EffectComposer>
  );
}
