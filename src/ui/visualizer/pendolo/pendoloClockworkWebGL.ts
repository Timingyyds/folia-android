import { parseColorChannels } from '../colorMix';
import {
    buildPendoloClockworkCacheKey,
    buildPendoloClockworkCachedScene,
    fillPendoloTransformTables,
    PENDOLO_MAX_PARTS,
    PENDOLO_MESH_STRIDE,
    type PendoloCachedScene,
    type PendoloMotionSample,
} from './pendoloClockworkMeshes';
import { resolvePendoloClockworkAnchors, type PendoloClockworkFrameInput } from './pendoloClockworkScene';

// src/ui/visualizer/pendolo/pendoloClockworkWebGL.ts
// WebGL2 renderer for Pendolo clockwork; falls back when context/shaders fail.

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in float a_part;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_origins[${PENDOLO_MAX_PARTS}];
uniform float u_rotations[${PENDOLO_MAX_PARTS}];
out vec4 v_color;
void main() {
  v_color = a_color;
  int id = int(a_part + 0.5);
  vec2 origin = u_origins[id];
  float rotation = u_rotations[id];
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 world = vec2(a_pos.x * c - a_pos.y * s, a_pos.x * s + a_pos.y * c) + origin;
  vec2 px = world * u_dpr;
  vec2 clip = vec2(
    (px.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (px.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}
`;

const GRAD_VERT = `#version 300 es
precision highp float;
const vec2 pos[4] = vec2[4](
  vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0)
);
out vec2 v_uv;
void main() {
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}
`;

const GRAD_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_center;
uniform float u_radius;
uniform vec2 u_resolution;
uniform vec3 u_bg;
out vec4 outColor;
// Match Canvas2D stops: 0→0.72, 0.35→0.52, 0.7→0.20, 1→0
float radialAlpha(float t) {
  if (t <= 0.35) return mix(0.72, 0.52, t / 0.35);
  if (t <= 0.7) return mix(0.52, 0.20, (t - 0.35) / 0.35);
  return mix(0.20, 0.0, (t - 0.7) / 0.3);
}
void main() {
  // u_center is measured from the top like every CSS coordinate here; v_uv.y runs bottom-up.
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;
  float t = clamp(distance(px, u_center) / max(u_radius, 1.0), 0.0, 1.0);
  float a = radialAlpha(t);
  outColor = vec4(u_bg * a, a);
}
`;

const COVER_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_resolution;
uniform float u_dpr;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  vec2 px = a_pos * u_dpr;
  vec2 clip = vec2(
    (px.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (px.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const COVER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 outColor;
void main() {
  vec2 c = v_uv * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  vec4 tex = texture(u_tex, v_uv);
  float a = tex.a * u_opacity;
  outColor = vec4(tex.rgb * a, a);
}
`;

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[pendoloClockworkWebGL] shader compile', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
};

const linkProgram = (gl: WebGL2RenderingContext, vert: string, frag: string) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[pendoloClockworkWebGL] program link', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
};

const colorToRgb = (color: string): [number, number, number] => {
    const ch = parseColorChannels(color);
    if (!ch) return [0, 0, 0];
    return [ch.r / 255, ch.g / 255, ch.b / 255];
};


/**
 * Lightweight WebGL2 clockwork renderer; the canvas component falls back to Canvas2D when it is
 * not ready. Gear geometry is cached per layout and theme, and each frame only uploads the part
 * transforms, so steady-state frames make no buffer uploads.
 */
export class PendoloClockworkRenderer {
    private gl: WebGL2RenderingContext | null = null;

    private meshProgram: WebGLProgram | null = null;

    private gradProgram: WebGLProgram | null = null;

    private coverProgram: WebGLProgram | null = null;

    private meshVbo: WebGLBuffer | null = null;

    private meshVao: WebGLVertexArrayObject | null = null;

    private coverVbo: WebGLBuffer | null = null;

    private coverVao: WebGLVertexArrayObject | null = null;

    private fullscreenVao: WebGLVertexArrayObject | null = null;

    private coverTex: WebGLTexture | null = null;

    /** The image currently in `coverTex`; uploads are keyed on the image, not its URL. */
    private coverSource: CanvasImageSource | null = null;

    /**
     * An image whose upload threw (a cross-origin cover without CORS taints WebGL, where Canvas2D
     * would still draw it). It is not retried, so a bad cover costs one failed upload, not one
     * per frame.
     */
    private failedCoverSource: CanvasImageSource | null = null;

    /** The cover quad as last uploaded: centre and radius in CSS pixels. */
    private coverQuadKey = '';

    private cachedScene: PendoloCachedScene | null = null;

    private meshUniformRes: WebGLUniformLocation | null = null;

    private meshUniformDpr: WebGLUniformLocation | null = null;

    private meshUniformOrigins: WebGLUniformLocation | null = null;

    private meshUniformRotations: WebGLUniformLocation | null = null;

    private gradUniformCenter: WebGLUniformLocation | null = null;

    private gradUniformRadius: WebGLUniformLocation | null = null;

    private gradUniformRes: WebGLUniformLocation | null = null;

    private gradUniformBg: WebGLUniformLocation | null = null;

    private coverUniformRes: WebGLUniformLocation | null = null;

    private coverUniformDpr: WebGLUniformLocation | null = null;

    private coverUniformTex: WebGLUniformLocation | null = null;

    private coverUniformOpacity: WebGLUniformLocation | null = null;

    private originTable = new Float32Array(PENDOLO_MAX_PARTS * 2);

    private rotationTable = new Float32Array(PENDOLO_MAX_PARTS);

    private coverVerts = new Float32Array(16);

    constructor(readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: true,
            antialias: true,
            powerPreference: 'high-performance',
        });
        if (!gl) return;
        this.gl = gl;
        this.meshProgram = linkProgram(gl, VERT, FRAG);
        this.gradProgram = linkProgram(gl, GRAD_VERT, GRAD_FRAG);
        this.coverProgram = linkProgram(gl, COVER_VERT, COVER_FRAG);
        if (this.meshProgram) {
            this.meshUniformRes = gl.getUniformLocation(this.meshProgram, 'u_resolution');
            this.meshUniformDpr = gl.getUniformLocation(this.meshProgram, 'u_dpr');
            this.meshUniformOrigins = gl.getUniformLocation(this.meshProgram, 'u_origins');
            this.meshUniformRotations = gl.getUniformLocation(this.meshProgram, 'u_rotations');
        }
        if (this.gradProgram) {
            this.gradUniformCenter = gl.getUniformLocation(this.gradProgram, 'u_center');
            this.gradUniformRadius = gl.getUniformLocation(this.gradProgram, 'u_radius');
            this.gradUniformRes = gl.getUniformLocation(this.gradProgram, 'u_resolution');
            this.gradUniformBg = gl.getUniformLocation(this.gradProgram, 'u_bg');
        }
        if (this.coverProgram) {
            this.coverUniformRes = gl.getUniformLocation(this.coverProgram, 'u_resolution');
            this.coverUniformDpr = gl.getUniformLocation(this.coverProgram, 'u_dpr');
            this.coverUniformTex = gl.getUniformLocation(this.coverProgram, 'u_tex');
            this.coverUniformOpacity = gl.getUniformLocation(this.coverProgram, 'u_opacity');
        }
        this.meshVbo = gl.createBuffer();
        this.meshVao = gl.createVertexArray();
        gl.bindVertexArray(this.meshVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
        const strideBytes = PENDOLO_MESH_STRIDE * 4;
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, strideBytes, 0);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, 8);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, strideBytes, 24);
        gl.bindVertexArray(null);

        this.coverVbo = gl.createBuffer();
        this.coverVao = gl.createVertexArray();
        gl.bindVertexArray(this.coverVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.coverVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.coverVerts.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        gl.bindVertexArray(null);

        this.fullscreenVao = gl.createVertexArray();
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    get isReady() {
        return Boolean(
            this.gl
            && !this.gl.isContextLost()
            && this.meshProgram
            && this.gradProgram
            && this.coverProgram
            && this.meshVbo
            && this.meshVao,
        );
    }

    dispose() {
        const gl = this.gl;
        if (!gl) return;
        // After a context loss every handle is already gone; deleting them is a harmless no-op.
        if (this.meshVao) gl.deleteVertexArray(this.meshVao);
        if (this.coverVao) gl.deleteVertexArray(this.coverVao);
        if (this.fullscreenVao) gl.deleteVertexArray(this.fullscreenVao);
        if (this.meshVbo) gl.deleteBuffer(this.meshVbo);
        if (this.coverVbo) gl.deleteBuffer(this.coverVbo);
        if (this.meshProgram) gl.deleteProgram(this.meshProgram);
        if (this.gradProgram) gl.deleteProgram(this.gradProgram);
        if (this.coverProgram) gl.deleteProgram(this.coverProgram);
        if (this.coverTex) gl.deleteTexture(this.coverTex);
        this.coverTex = null;
        this.coverSource = null;
        this.cachedScene = null;
        this.gl = null;
    }

    /**
     * Disposes and, once the canvas has left the document, gives the context back to the
     * browser. Chromium keeps only about 16 live WebGL contexts and drops the oldest past that,
     * which may belong to another visualizer. A canvas still in the document (StrictMode's
     * simulated unmount) keeps its context, so the remount can attach to it again.
     */
    release() {
        const gl = this.gl;
        this.dispose();
        if (gl && !this.canvas.isConnected && !gl.isContextLost()) {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    }

    /** Whether this cover image could not be uploaded (a cross-origin cover without CORS). */
    isCoverRejected(image: CanvasImageSource | null) {
        return image !== null && image === this.failedCoverSource;
    }

    /** Uploads cover art when the decoded image changes; returns whether a cover is ready. */
    private syncCoverImage(image: CanvasImageSource | null) {
        const gl = this.gl!;
        if (!image || image === this.failedCoverSource) {
            if (this.coverTex) {
                gl.deleteTexture(this.coverTex);
                this.coverTex = null;
            }
            this.coverSource = null;
            return false;
        }
        if (image === this.coverSource && this.coverTex) return true;
        if (!this.coverTex) this.coverTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.coverTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
        } catch {
            this.failedCoverSource = image;
            gl.deleteTexture(this.coverTex);
            this.coverTex = null;
            this.coverSource = null;
            return false;
        }
        this.coverSource = image;
        return true;
    }

    private resize(pixelWidth: number, pixelHeight: number) {
        const gl = this.gl!;
        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
            this.canvas.width = pixelWidth;
            this.canvas.height = pixelHeight;
        }
        gl.viewport(0, 0, pixelWidth, pixelHeight);
    }

    /** Draws one clockwork frame. Positions in the mesh are CSS pixels. */
    draw(options: {
        input: PendoloClockworkFrameInput;
        cssWidth: number;
        cssHeight: number;
        dpr: number;
    }) {
        const gl = this.gl;
        if (!gl || !this.isReady) return;
        const { input, cssWidth, cssHeight, dpr } = options;
        const pixelW = Math.round(cssWidth * dpr);
        const pixelH = Math.round(cssHeight * dpr);
        if (pixelW <= 0 || pixelH <= 0) return;
        this.resize(pixelW, pixelH);
        const hasCover = input.showCover && this.syncCoverImage(input.coverImage);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (input.showCenterGradient) {
            this.drawGradient(input, pixelW, pixelH, dpr);
        }
        if (hasCover) {
            this.drawCover(input, pixelW, pixelH, dpr);
        }
        if (input.showGearDecor !== 'none') {
            this.drawMesh(input, pixelW, pixelH, dpr);
        }
    }

    private drawGradient(
        input: PendoloClockworkFrameInput,
        pixelW: number,
        pixelH: number,
        dpr: number,
    ) {
        const gl = this.gl!;
        const anchors = resolvePendoloClockworkAnchors(input);
        gl.useProgram(this.gradProgram);
        gl.bindVertexArray(this.fullscreenVao);
        const rgb = colorToRgb(input.backgroundColor || '#000000');
        gl.uniform2f(this.gradUniformCenter, input.centerX * dpr, input.centerY * dpr);
        gl.uniform1f(this.gradUniformRadius, anchors.gradientR * dpr);
        gl.uniform2f(this.gradUniformRes, pixelW, pixelH);
        gl.uniform3f(this.gradUniformBg, rgb[0], rgb[1], rgb[2]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    private drawCover(
        input: PendoloClockworkFrameInput,
        pixelW: number,
        pixelH: number,
        dpr: number,
    ) {
        const gl = this.gl!;
        const anchors = resolvePendoloClockworkAnchors(input);
        const r = anchors.coverRadius;
        const { centerX, centerY, showGearDecor } = input;
        const opacity = 0.42 * (showGearDecor === 'full' ? 1.0 : 0.6);
        gl.useProgram(this.coverProgram);
        gl.bindVertexArray(this.coverVao);
        // The quad only moves with the layout, so it is re-uploaded then and not every frame.
        const quadKey = `${centerX}|${centerY}|${r}`;
        if (quadKey !== this.coverQuadKey) {
            this.coverQuadKey = quadKey;
            this.coverVerts.set([
                centerX - r, centerY - r, 0, 0,
                centerX + r, centerY - r, 1, 0,
                centerX - r, centerY + r, 0, 1,
                centerX + r, centerY + r, 1, 1,
            ]);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.coverVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.coverVerts);
        }
        gl.uniform2f(this.coverUniformRes, pixelW, pixelH);
        gl.uniform1f(this.coverUniformDpr, dpr);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.coverTex);
        gl.uniform1i(this.coverUniformTex, 0);
        gl.uniform1f(this.coverUniformOpacity, opacity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    private ensureCachedScene(input: PendoloClockworkFrameInput) {
        const key = buildPendoloClockworkCacheKey(input);
        if (this.cachedScene?.key === key) return this.cachedScene;
        const next = buildPendoloClockworkCachedScene(input);
        const gl = this.gl!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
        gl.bufferData(gl.ARRAY_BUFFER, next.data, gl.STATIC_DRAW);
        this.cachedScene = next;
        return next;
    }

    private drawMesh(
        input: PendoloClockworkFrameInput,
        pixelW: number,
        pixelH: number,
        dpr: number,
    ) {
        const gl = this.gl!;
        const scene = this.ensureCachedScene(input);
        if (scene.vertexCount === 0 || scene.parts.length === 0) return;

        const motion: PendoloMotionSample = {
            escapementAngle: input.escapementAngle,
            phase: input.phase,
            bassOscillation: input.bassOscillation,
            secondGearAngle: input.secondGearAngle,
        };
        fillPendoloTransformTables(scene.parts, motion, this.originTable, this.rotationTable);

        gl.useProgram(this.meshProgram);
        gl.bindVertexArray(this.meshVao);
        gl.uniform2f(this.meshUniformRes, pixelW, pixelH);
        gl.uniform1f(this.meshUniformDpr, dpr);
        gl.uniform2fv(this.meshUniformOrigins, this.originTable);
        gl.uniform1fv(this.meshUniformRotations, this.rotationTable);
        gl.drawArrays(gl.TRIANGLES, 0, scene.vertexCount);
        gl.bindVertexArray(null);
    }
}
