import { useEffect, useMemo, useRef, useState } from "react";

type KnobProps = {
  steps?: number;             // кол-во положений (вкл. 0)
  value: number;              // текущее положение [0..steps-1]
  onChange: (val: number) => void;
  labels?: string[];          // подписи под рисками (по желанию)
  title?: string;             // заголовок / aria-label
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Поворотная ручка со шкалой: сектор 270° (-135°…+135°)
 * Доступна мышью, тачем и стрелками/WSAD.
 */
export default function Knob({
  steps = 9,
  value,
  onChange,
  labels,
  title = "Mode",
}: KnobProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const minAngle = -135;
  const maxAngle =  135;
  const angle = useMemo(() => {
    const ratio = value / (steps - 1);
    return minAngle + ratio * (maxAngle - minAngle);
  }, [value, steps]);

  // пересчёт координат → шаг
  const angleToStep = (aDeg: number) => {
    const clipped = clamp(aDeg, minAngle, maxAngle);
    const ratio = (clipped - minAngle) / (maxAngle - minAngle);
    const step = Math.round(ratio * (steps - 1));
    return clamp(step, 0, steps - 1);
  };

  useEffect(() => {
    if (!dragging) return;
    const el = rootRef.current!;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const move = (ev: MouseEvent | TouchEvent) => {
      const p = "touches" in ev ? ev.touches[0] : ev;
      const dx = (p.clientX ?? 0) - cx;
      const dy = (p.clientY ?? 0) - cy;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180
      a = clamp(a, minAngle, maxAngle);
      onChange(angleToStep(a));
    };
    const up = () => setDragging(false);

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [dragging]);

  return (
    <div className="knob-wrap">
      <div
        ref={rootRef}
        className={`knob ${dragging ? "drag" : ""}`}
        role="slider"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={steps - 1}
        aria-valuenow={value}
        tabIndex={0}
        onMouseDown={() => setDragging(true)}
        onTouchStart={() => setDragging(true)}
        onKeyDown={(e) => {
          if (["ArrowUp","ArrowRight","KeyD"].includes(e.code)) onChange(clamp(value + 1, 0, steps - 1));
          if (["ArrowDown","ArrowLeft","KeyA"].includes(e.code)) onChange(clamp(value - 1, 0, steps - 1));
        }}
      >
        {/* Внешнее кольцо и шкала */}
        <div className="knob-ring">
          {Array.from({ length: steps }).map((_, i) => {
            const r = i / (steps - 1);
            const a = (minAngle + r * (maxAngle - minAngle)) * (Math.PI / 180);
            const len = i % 2 === 0 ? 12 : 8;
            const inner = 32, outer = inner + len;
            const x1 = 50 + inner * Math.cos(a);
            const y1 = 50 + inner * Math.sin(a);
            const x2 = 50 + outer * Math.cos(a);
            const y2 = 50 + outer * Math.sin(a);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={`tick ${i === value ? "active" : ""}`}
              />
            );
          })}
        </div>

        {/* Ручка */}
        <div className="knob-cap">
          <div className="knob-pointer" style={{ transform: `rotate(${angle}deg)` }}>
            <div className="pointer-core" />
          </div>
        </div>

        {/* Метка под выбранным шагом */}
        <div className="knob-readout">
          {labels?.[value] ?? value}
        </div>
      </div>
    </div>
  );
}
