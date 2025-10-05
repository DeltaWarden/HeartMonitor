import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const WIDTH = 1200;
const HEIGHT = 380;
const MAX_POINTS = 1000;

type RefFn = (v: number | number[]) => void;

const PulseChart = forwardRef<RefFn>((_, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const seriesRef = useRef<number[]>([]);

  useImperativeHandle(ref, () => (v: number | number[]) => {
    const arr = seriesRef.current;
    if (Array.isArray(v)) arr.push(...v);
    else arr.push(v);
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
  });

  useEffect(() => {
    let raf = 0;
    const ctx = canvasRef.current!.getContext("2d")!;
    const render = () => {
      ctx.fillStyle = "#071013";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      const g = ctx.createRadialGradient(WIDTH/2, 0, 60, WIDTH/2, 0, WIDTH);
      g.addColorStop(0, "rgba(34,197,94,0.08)");
      g.addColorStop(1, "rgba(7,16,19,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = "rgba(28,28,28,1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y <= HEIGHT; y += 40) { ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); }
      for (let x = 0; x <= WIDTH; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); }
      ctx.stroke();
      const arr = seriesRef.current;
      if (arr.length > 1) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#22c55e";
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const x = (i / MAX_POINTS) * WIDTH;
          const norm = arr[i] / 1023;
          const y = HEIGHT - norm * (HEIGHT - 30) - 15;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(34,197,94,.12)";
        ctx.stroke();
      } else {
        ctx.fillStyle = "#8a8a8a";
        ctx.font = "14px ui-sans-serif, system-ui";
        ctx.fillText("Ожидаю данные…", 16, 24);
      }

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      style={{ width: "100%", height: 420, borderRadius: 12, display: "block", border: "1px solid #0a0f12" }}
    />
  );
});

export default PulseChart;
