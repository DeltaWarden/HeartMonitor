import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const WIDTH = 1200;
const HEIGHT = 380;
const MAX_POINTS = 2000;

export type RefFn = (v: number | number[]) => void;

type Props = {
  mode: 0 | 1 | 2 | 3;    // RAW / FILTERED / FFT / HRV
  scaleX?: number;        // 0.5..3
  scaleY?: number;        // 0.5..3
};

type PeakState = {
  last: number;
  refractory: number;      // ms
  lastBeatTs: number;
  ibiList: number[];       // последние интервалы
  th: number;              // динамический порог
  ma: number;              // скользящее среднее
  v: number;               // моментальный сигнал (для фильтра)
};

function hannWindow(N: number) {
  const w = new Float32Array(N);
  for (let n = 0; n < N; n++) w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
  return w;
}

// очень компактный radix-2 FFT для 2^k, только амплитуды
function fftMag(x: Float32Array) {
  const N = x.length;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  re.set(x);
  // bit-reverse
  for (let i = 0, j = 0; i < N; i++) {
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    let m = N >> 1;
    while (j >= m && m > 0) { j -= m; m >>= 1; }
    j += m;
  }
  for (let s = 1; s <= Math.log2(N); s++) {
    const m = 1 << s;
    const m2 = m >> 1;
    const wmRe = Math.cos(-2 * Math.PI / m), wmIm = Math.sin(-2 * Math.PI / m);
    for (let k = 0; k < N; k += m) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < m2; j++) {
        const tRe = wRe * re[k + j + m2] - wIm * im[k + j + m2];
        const tIm = wRe * im[k + j + m2] + wIm * re[k + j + m2];
        const uRe = re[k + j], uIm = im[k + j];
        re[k + j] = uRe + tRe; im[k + j] = uIm + tIm;
        re[k + j + m2] = uRe - tRe; im[k + j + m2] = uIm - tIm;
        const nwRe = wRe * wmRe - wIm * wmIm;
        wIm = wRe * wmIm + wIm * wmRe;
        wRe = nwRe;
      }
    }
  }
  const mag = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

const PulseChart = forwardRef<RefFn, Props>(({ mode, scaleX = 1, scaleY = 1 }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const seriesRef = useRef<number[]>([]);
  const peakRef = useRef<PeakState>({
    last: 0, refractory: 220, lastBeatTs: 0, ibiList: [], th: 620, ma: 520, v: 0
  });

  useImperativeHandle(ref, () => (v: number | number[]) => {
    const arr = seriesRef.current;
    if (Array.isArray(v)) arr.push(...v); else arr.push(v);
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
  });

  useEffect(() => {
    let raf = 0;
    const ctx = canvasRef.current!.getContext("2d")!;
    const Nfft = 1024;
    const windowHann = hannWindow(Nfft);

    const render = () => {
      // бэк и сетка
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
        if (mode === 0 || mode === 1) {
          // LINE: raw / filtered
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#22c55e";
          ctx.beginPath();

          // простейший IIR (для режима 1)
          let yPrev = peakRef.current.v;
          const alpha = 0.18; // чем больше — тем агрессивнее фильтр

          // по оси X используем шаг в зависимости от scaleX
          const visible = Math.min(arr.length, Math.floor(MAX_POINTS / scaleX));
          const start = arr.length - visible;
          for (let i = 0; i < visible; i++) {
            const s = arr[start + i] / 1023;
            const filtered = yPrev + alpha * (s - yPrev);
            yPrev = filtered;
            const sig = (mode === 1 ? filtered : s);

            // peak detect для HRV (даже в этих режимах – поддерживаем состояние)
            detectPeaks(sig);

            const x = (i / (visible - 1)) * WIDTH;
            const yn = 0.5 + (sig - 0.5) * scaleY; // масштаб по Y
            const y = HEIGHT - yn * (HEIGHT - 30) - 15;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          peakRef.current.v = yPrev;
          ctx.stroke();
          ctx.lineWidth = 6;
          ctx.strokeStyle = "rgba(34,197,94,.12)";
          ctx.stroke();
        }

        if (mode === 2) {
          // FFT
          const src = arr.slice(-Nfft);
          const pad = Nfft - src.length;
          const buf = new Float32Array(Nfft);
          for (let i = 0; i < pad; i++) buf[i] = 0;
          for (let i = 0; i < src.length; i++) buf[i + pad] = (src[i] / 1023) * 2 - 1;
          for (let i = 0; i < Nfft; i++) buf[i] *= windowHann[i];
          const mag = fftMag(buf);

          const maxMag = Math.max(1e-6, ...mag);
          const bins = mag.length;
          const barW = WIDTH / bins;

          for (let i = 0; i < bins; i++) {
            const h = (mag[i] / maxMag) * (HEIGHT - 40) * scaleY;
            ctx.fillStyle = i < 8 ? "rgba(239,68,68,.95)" : "rgba(34,197,94,.9)"; // низкие частоты подсветим
            ctx.fillRect(i * barW, HEIGHT - h - 20, Math.max(1, barW - 1), h);
          }
        }

        if (mode === 3) {
          // HRV (IBI) — рисуем последние 20 интервалов
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#22c55e";
          ctx.beginPath();
          const ibi = peakRef.current.ibiList;
          const n = Math.min(ibi.length, 20);
          for (let i = 0; i < n; i++) {
            const ms = ibi[ibi.length - n + i];
            const bpm = 60000 / Math.max(1, ms);
            const xn = i / Math.max(1, n - 1);
            const yn = (bpm - 40) / (180 - 40); // 40..180 bpm
            const x = xn * WIDTH;
            const y = HEIGHT - clamp(yn, 0, 1) * (HEIGHT - 40) - 20;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // сетка оси Y под HRV
          ctx.fillStyle = "#8a8a8a";
          ctx.font = "12px ui-sans-serif, system-ui";
          for (const mark of [60, 90, 120, 150]) {
            const yn = (mark - 40) / (180 - 40);
            const y = HEIGHT - yn * (HEIGHT - 40) - 20;
            ctx.fillText(`${mark} bpm`, 8, y - 6);
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.fillRect(0, y, WIDTH, 1);
            ctx.fillStyle = "#8a8a8a";
          }
        }
      } else {
        ctx.fillStyle = "#8a8a8a";
        ctx.font = "14px ui-sans-serif, system-ui";
        ctx.fillText("Ожидаю данные…", 16, 24);
      }

      raf = requestAnimationFrame(render);
    };

    const detectPeaks = (sig: number) => {
      // простая детекция: динамический порог + рефрактерный период
      const st = peakRef.current;
      // обновление бегущего среднего/порога
      st.ma = 0.995 * st.ma + 0.005 * (sig * 1023);
      st.th = 0.99 * st.th + 0.01 * (st.ma + 80);

      const now = performance.now();
      const rising = sig > st.last;
      const above = (sig * 1023) > st.th;
      if (rising && above && now - st.lastBeatTs > st.refractory) {
        // фиксируем удар
        if (st.lastBeatTs > 1) {
          const ibi = now - st.lastBeatTs;
          st.ibiList.push(ibi);
          if (st.ibiList.length > 60) st.ibiList.shift();
        }
        st.lastBeatTs = now;
      }
      st.last = sig;
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [mode, scaleX, scaleY]);

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
