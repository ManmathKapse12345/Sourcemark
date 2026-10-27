"use client";
import { useEffect, useRef } from "react";

/* Hero artwork: slow domain-warped "ink in water" field, coloured from the theme's glow tokens.
   Follows the pointer slightly. Falls back to the CSS gradient behind it if WebGL is unavailable. */
const FRAG = `
precision highp float;
uniform vec2 r; uniform float t; uniform vec2 m;
uniform vec3 c0, c1, c2, c3; uniform float dark;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / r; vec2 p = (gl_FragCoord.xy - .5*r) / r.y;
  p += (m - .5) * .08;
  float s = t * .045;
  vec2 q = vec2(fbm(p*1.6 + s), fbm(p*1.6 - s + 4.3));
  vec2 w = vec2(fbm(p*1.3 + 3.*q + vec2(1.7,9.2) + s*1.4), fbm(p*1.3 + 3.*q + vec2(8.3,2.8) - s));
  float f = fbm(p*1.2 + 2.6*w);
  vec3 col = mix(c0, c1, smoothstep(.15,.85,f));
  col = mix(col, c2, smoothstep(.45,.95, length(q)) * .85);
  col = mix(col, c3, smoothstep(.55,1., w.x) * .7);
  // fine engraved-paper lines
  float lines = .5 + .5*sin((p.y + f*.08) * 900.);
  col *= 1. - lines * .035;
  // vignette toward the page colour
  float v = smoothstep(1.25, .25, length((uv - .5) * vec2(1.2, 1.)));
  col = mix(dark > .5 ? c0*.35 : mix(c0, vec3(1.), .55), col, v);
  // grain
  col += (h(gl_FragCoord.xy + t) - .5) * .045;
  gl_FragColor = vec4(col, 1.);
}`;
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;

const PALETTES = {
  light: ["#f1eefe", "#8f7dff", "#ff8a6b", "#ffd25e"],
  dark: ["#090b1a", "#2b2fa8", "#d9465a", "#f5c451"],
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function InkShader({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const gl = c.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) return;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let mouse = [0.5, 0.5], target = [0.5, 0.5], raf = 0, visible = true;
    const setPalette = () => {
      const dark = document.documentElement.classList.contains("dark");
      PALETTES[dark ? "dark" : "light"].forEach((hex, i) => gl.uniform3fv(u(`c${i}`), rgb(hex)));
      gl.uniform1f(u("dark"), dark ? 1 : 0);
    };
    const size = () => { const d = Math.min(devicePixelRatio, 1.5); c.width = c.clientWidth * d; c.height = c.clientHeight * d; gl.viewport(0, 0, c.width, c.height); gl.uniform2f(u("r"), c.width, c.height); };
    const t0 = performance.now();
    const frame = (now: number) => {
      mouse = mouse.map((v, i) => v + (target[i] - v) * 0.04);
      gl.uniform1f(u("t"), still ? 20 : (now - t0) / 1000 + 20);
      gl.uniform2f(u("m"), mouse[0], mouse[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && visible) raf = requestAnimationFrame(frame);
    };
    const move = (e: PointerEvent) => { const b = c.getBoundingClientRect(); target = [(e.clientX - b.left) / b.width, 1 - (e.clientY - b.top) / b.height]; };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } });
    const mo = new MutationObserver(() => { setPalette(); if (still) frame(performance.now()); });
    setPalette(); size(); raf = requestAnimationFrame(frame);
    addEventListener("resize", size); addEventListener("pointermove", move); io.observe(c);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); removeEventListener("pointermove", move); io.disconnect(); mo.disconnect(); };
  }, []);
  return <canvas ref={ref} aria-hidden className={`h-full w-full ${className}`} />;
}
