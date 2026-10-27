"use client";
import { useEffect, useState } from "react";

const SECTIONS = [
  { id: "try", label: "Try it" },
  { id: "how", label: "How it works" },
  { id: "flow", label: "Workflow" },
];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Eased scrolling for every in-page link, plus a floating bar that shows which section you are in. */
export function SectionNav() {
  const [active, setActive] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      const id = a?.getAttribute("href")?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      const from = scrollY, to = target.getBoundingClientRect().top + scrollY - 24;
      const ms = still ? 0 : Math.min(1400, 500 + Math.abs(to - from) * 0.25);
      const t0 = performance.now();
      document.documentElement.style.scrollBehavior = "auto";
      const step = (now: number) => {
        const p = ms ? Math.min(1, (now - t0) / ms) : 1;
        scrollTo(0, from + (to - from) * ease(p));
        if (p < 1) requestAnimationFrame(step);
        else { document.documentElement.style.scrollBehavior = ""; history.replaceState(null, "", `#${id}`); target.focus({ preventScroll: true }); }
      };
      requestAnimationFrame(step);
    };
    document.addEventListener("click", onClick);

    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) setActive(en.target.id);
    }, { rootMargin: "-45% 0px -50% 0px" });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) { el.tabIndex = -1; io.observe(el); } });
    const onScroll = () => { setShown(scrollY > innerHeight * 0.8); if (scrollY < innerHeight * 0.5) setActive(null); };
    onScroll(); addEventListener("scroll", onScroll, { passive: true });
    return () => { document.removeEventListener("click", onClick); io.disconnect(); removeEventListener("scroll", onScroll); };
  }, []);

  return (
    <nav aria-label="Page sections" inert={!shown}
      className={`glass fixed left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 text-sm transition-all duration-500 ${shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-6 opacity-0"}`}>
      <a href="#top" className="px-3 font-serif text-lg leading-none">S<span className="text-brand">.</span></a>
      {SECTIONS.map((s) => (
        <a key={s.id} href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}
          className={`rounded-full px-3.5 py-1.5 transition-colors duration-300 ${active === s.id ? "bg-brand text-slate-50" : "text-slate-600 hover:text-ink"}`}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}
