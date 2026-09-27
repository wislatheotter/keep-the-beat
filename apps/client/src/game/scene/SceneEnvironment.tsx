import { useLoader, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import {
  CubeUVReflectionMapping, DataTexture, FileLoader, HalfFloatType, LinearFilter,
  LinearSRGBColorSpace, Loader, RGBAFormat,
} from 'three';
import { PERFORMANCE } from '../performance';

const FILE = '/environment/room-pmrem.binz';

export function SceneEnvironment({ onReady }: { onReady: () => void }) {
  const scene = useThree((three) => three.scene);
  const texture = useLoader(RoomEnvironmentLoader, FILE);

  useEffect(() => {
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    scene.environment = texture;
    scene.environmentIntensity = PERFORMANCE.environmentIntensity;
    onReady();
    return () => {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
    };
  }, [scene, texture, onReady]);

  return null;
}

class RoomEnvironmentLoader extends Loader<DataTexture> {
  load(
    url: string,
    onLoad?: (texture: DataTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    const texture = new DataTexture();
    const file = new FileLoader(this.manager)
      .setPath(this.path)
      .setResponseType('arraybuffer')
      .setRequestHeader(this.requestHeader)
      .setWithCredentials(this.withCredentials);
    file.load(url, (compressed) => {
      void inflate(compressed as ArrayBuffer).then((buffer) => {
        const view = new DataView(buffer);
        texture.image = {
          data: new Uint16Array(buffer, 8),
          width: view.getUint32(0, true),
          height: view.getUint32(4, true),
        };
        texture.format = RGBAFormat;
        texture.type = HalfFloatType;
        texture.mapping = CubeUVReflectionMapping;
        texture.colorSpace = LinearSRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        texture.flipY = false;
        texture.needsUpdate = true;
        onLoad?.(texture);
      }).catch(onError);
    }, onProgress, onError);
    return texture;
  }
}

async function inflate(compressed: ArrayBuffer) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

useLoader.preload(RoomEnvironmentLoader, FILE);
