"use client";
import { useEffect, useRef } from "react";

/** Slow drifting starfield with a few bright "cited" stars. Pure canvas, pauses when hidden. */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;
    const dpr = Math.min(devicePixelRatio, 2);
    const stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * .8 + .2, t: Math.random() * 6.28 }));
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const draw = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const y = ((s.y + (still ? 0 : time * 0.000006 * s.z)) % 1) * h;
        const a = 0.25 + 0.75 * Math.abs(Math.sin(s.t + time * 0.0008 * s.z));
        ctx.fillStyle = s.z > .93 ? `rgba(255,220,140,${a})` : `rgba(210,220,255,${a * .7})`;
        ctx.beginPath(); ctx.arc(s.x * w, y, s.z * 1.2, 0, 6.28); ctx.fill();
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    size(); addEventListener("resize", size); raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
