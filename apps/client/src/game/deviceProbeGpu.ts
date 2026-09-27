export type GpuReading = {
  fillMsPerMegapixel: number;
  drawMsPerThousand: number;
  renderer: string;
};

export type Pause = () => Promise<boolean>;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform float uSeed;
out vec4 fragColor;
void main() {
  vec3 acc = vec3(0.0);
  vec2 p = gl_FragCoord.xy * 0.01 + uSeed;
  for (int i = 0; i < 24; i++) {
    p = vec2(p.x * 1.13 + sin(p.y), p.y * 1.07 + cos(p.x));
    acc += vec3(fract(p.x), fract(p.y), fract(p.x * p.y)) * 0.04;
  }
  fragColor = vec4(acc, 1.0);
}`;

export const PROBE_SIZE = 512;
export const PROBE_CONTEXT: WebGLContextAttributes = {
  alpha: false, antialias: false, depth: false, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false,
};

async function compile(gl: WebGL2RenderingContext, pause: Pause) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  await pause();
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  return program;
}

export async function best(runs: number, attempt: () => number, pause: Pause) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i += 1) {
    if (i > 0 && !(await pause())) break;
    fastest = Math.min(fastest, attempt());
  }
  return fastest;
}

function measure(gl: WebGL2RenderingContext, program: WebGLProgram, quads: number, size: number) {
  gl.viewport(0, 0, size, size);
  gl.useProgram(program);
  const seed = gl.getUniformLocation(program, 'uSeed');
  const pixel = new Uint8Array(4);
  gl.uniform1f(seed, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  const start = performance.now();
  for (let i = 0; i < quads; i += 1) {
    gl.uniform1f(seed, i * 0.01);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return performance.now() - start;
}

export async function measureGpu(gl: WebGL2RenderingContext, pause: Pause): Promise<GpuReading | null> {
  const program = await compile(gl, pause);
  if (!program) return null;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  gl.useProgram(program);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.flush();

  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));

  if (!(await pause())) return null;

  const FILL_PASSES = 20;
  const megapixels = (FILL_PASSES * PROBE_SIZE * PROBE_SIZE) / 1e6;
  const fillMs = await best(3, () => measure(gl, program, FILL_PASSES, PROBE_SIZE), pause);

  if (!(await pause())) return null;

  const CALL_PASSES = 1000;
  const callMs = await best(3, () => measure(gl, program, CALL_PASSES, 1), pause);

  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { fillMsPerMegapixel: fillMs / megapixels, drawMsPerThousand: callMs, renderer };
}
