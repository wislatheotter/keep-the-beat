import { BlendFunction, Effect } from 'postprocessing';
import { Uniform } from 'three';

const fragment = `
uniform float exposure;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
}
`;

export class ShowExposureEffect extends Effect {
  constructor() {
    super('ShowExposureEffect', fragment, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['exposure', new Uniform(1)]]),
    });
  }

  get exposure() { return (this.uniforms.get('exposure') as Uniform<number>).value; }
  set exposure(value: number) { (this.uniforms.get('exposure') as Uniform<number>).value = value; }
}
