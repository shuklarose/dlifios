import { useEffect, useRef } from "react";

const CARDS = [
  {
    className: "fc-1",
    title: "GDPR",
    sub: "Regulation (EU) 2016/679",
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    ),
  },
  {
    className: "fc-2",
    title: "EU AI Act",
    sub: "Regulation (EU) 2024/1689",
    icon: (
      <>
        <path d="m16 16 3-8 3 8c-2 1.5-4 1.5-6 0z" />
        <path d="m2 16 3-8 3 8c-2 1.5-4 1.5-6 0z" />
        <path d="M7 21h10" />
        <path d="M12 3v18" />
        <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
      </>
    ),
  },
  {
    className: "fc-3",
    title: "Commission Decision",
    sub: "(EU) 2026/713",
    icon: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8M16 17H8M10 9H8" />
      </>
    ),
  },
];

// The rendered globe is a PNG. The canvas behind it draws a rotating dot sphere
// as a fallback, so the hero is never an empty box while the image loads or if
// it fails outright.
export default function Globe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stopped = false;

    // Fibonacci spiral scatters points evenly over a sphere, then a fixed tilt
    // gives it an Earth-like axis.
    const N = 720;
    const tilt = -0.4;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const points = Array.from({ length: N }, (_, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      return { x, y: y * ct - z * st, z: y * st + z * ct };
    });

    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let radius = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2;
      cy = h / 2;
      radius = Math.min(w, h) * 0.42;
    };
    resize();
    window.addEventListener("resize", resize);

    let rotation = 0;
    let frame = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (w && h) {
        const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.35);
        glow.addColorStop(0, "rgba(70,193,120,0.16)");
        glow.addColorStop(1, "rgba(70,193,120,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        for (const p of points) {
          const x = p.x * cos - p.z * sin;
          const z = p.x * sin + p.z * cos;
          const depth = (z + 1) / 2; // 0 at the back, 1 at the front
          ctx.beginPath();
          ctx.fillStyle = `rgba(74,222,128,${0.12 + depth * 0.6})`;
          ctx.arc(cx + x * radius, cy + p.y * radius, 0.6 + depth * 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (stopped) return;
      if (!reduce) rotation += 0.0016;
      frame = requestAnimationFrame(draw);
    };
    draw();

    // Once the PNG loads it takes over and the canvas stops burning frames.
    const img = imgRef.current;
    const onLoad = () => {
      if (!img) return;
      img.style.display = "block";
      canvas.style.display = "none";
      stopped = true;
    };
    const onError = () => img?.remove();
    if (img) {
      if (img.complete && img.naturalWidth > 0) onLoad();
      img.addEventListener("load", onLoad);
      img.addEventListener("error", onError);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      img?.removeEventListener("load", onLoad);
      img?.removeEventListener("error", onError);
    };
  }, []);

  return (
    <div className="globe-wrap">
      <canvas ref={canvasRef} id="globe" aria-hidden="true" />
      <img ref={imgRef} id="globeImg" className="globe-img" src="/assets/globe.png" alt="" />

      {CARDS.map((card) => (
        <div className={`float-card ${card.className}`} key={card.title}>
          <span className="fc-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {card.icon}
            </svg>
          </span>
          <div>
            <div className="fc-title">{card.title}</div>
            <div className="fc-sub">{card.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
