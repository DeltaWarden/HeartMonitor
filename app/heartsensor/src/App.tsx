import { useEffect, useRef, useState } from "react";
import PulseChart from "./components/PulseChart";
import { connectSerial, type SensorResp } from "./lib/serial";

type StatusResp = { ssid: string; ip: string; rssi: number };
type RefFn = (v: number | number[]) => void;

export default function App() {
  const [ip, setIp] = useState<string>(() => localStorage.getItem("esp_ip") || "");
  const [editMode, setEditMode] = useState(false);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusResp | null>(null);

  const [bpm, setBpm] = useState<number | null>(null);
  const [temperature, setTemperature] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"ws" | "serial" | null>(null);

  const [ledOn, setLedOn] = useState(false);

  const chartRef = useRef<RefFn>();
  const queueRef = useRef<number[]>([]);
  const playRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const serialCloseRef = useRef<null | { close(): Promise<void> }>(null);
  const pollStatusRef = useRef<number | null>(null);

  useEffect(() => {
    if (playRef.current) clearInterval(playRef.current);
    playRef.current = window.setInterval(() => {
      for (let k = 0; k < 2; k++) {
        const v = queueRef.current.shift();
        if (v == null) break;
        chartRef.current?.(v);
      }
    }, 5);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, []);

  useEffect(() => {
    if (!bpm || bpm <= 0) return;
    const period = 60000 / bpm;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setLedOn(true);
      setTimeout(() => setLedOn(false), 110);
      setTimeout(tick, period);
    };

    const id = setTimeout(tick, period);
    return () => { cancelled = true; clearTimeout(id); };
  }, [bpm]);

  const connectWS = async (ipAddr: string) => {
    cleanup();
    setMode("ws");
    setError(null);
    localStorage.setItem("esp_ip", ipAddr);
    setIp(ipAddr);

    try {
      const r = await fetch(`http://${ipAddr}/status`);
      if (r.ok) setStatus(await r.json());
    } catch {}

    try {
      const ws = new WebSocket(`ws://${ipAddr}/ws`);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); setError(null); };
      ws.onclose = () => { setConnected(false); };
      ws.onerror = () => { setError("Ошибка WebSocket"); };
      ws.onmessage = (ev) => {
        try { applyData(JSON.parse(ev.data)); } catch {}
      };

      if (pollStatusRef.current) clearInterval(pollStatusRef.current);
      pollStatusRef.current = window.setInterval(async () => {
        try {
          const r = await fetch(`http://${ipAddr}/status`);
          if (r.ok) setStatus(await r.json());
        } catch {}
      }, 2500);
    } catch {
      setError("Не удалось открыть WebSocket");
      setConnected(false);
    }
  };

  const connectUSB = async () => {
    cleanup();
    setMode("serial");
    setError(null);
    try {
      const handle = await connectSerial(
        (data) => applyData(data),
        (s) => {
          if (s === "open") setConnected(true);
          if (s === "close") setConnected(false);
          if (s === "error") setError("Serial error");
        }
      );
      serialCloseRef.current = handle;
      setStatus(null);
    } catch (e: any) {
      setError(String(e?.message || e));
      setConnected(false);
    }
  };

  const applyData = (data: SensorResp) => {
    if (typeof data.heartbeat === "number") setBpm(data.heartbeat);
    if (typeof data.temperature === "number" || data.temperature === null) {
      setTemperature(data.temperature);
    }
    if (Array.isArray(data.raw) && data.raw.length) {
      queueRef.current.push(...data.raw);
      if (queueRef.current.length > 4000) {
        queueRef.current.splice(0, queueRef.current.length - 4000);
      }
    }
  };

  const cleanup = () => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    if (serialCloseRef.current) {
      serialCloseRef.current.close().catch(() => {});
      serialCloseRef.current = null;
    }
    if (pollStatusRef.current) clearInterval(pollStatusRef.current);
    pollStatusRef.current = null;
    setConnected(false);
  };

  useEffect(() => cleanup, []);

  const handleConnectClick = () => {
    const box = document.getElementById("ipbox") as HTMLInputElement;
    if (!box) return;
    const v = box.value.trim();
    if (!v) return setError("Введите IP");
    setEditMode(false);
    connectWS(v);
  };

  return (
    <div className="app-wrap">
      <div className="instrument">
        <div className="topbar">
          <div className="brand">
            <div className="badge" />
            <div>Health Monitor Pro</div>
            <span className="badge-inline" title="Firmware">
              <span className="badge-dot" />
              v1.13
            </span>
          </div>

          <div className="leds">
            <div className="led">
              <div className={`dot ${connected ? "on green": ""}`} />
              ONLINE
            </div>
          </div>
        </div>

        <div className="panel">
          <div style={{display:"grid", gap:14}}>
            <div className="screen-mini">
              <h4>Режим</h4>
              <div className="value">
                {mode === "ws" ? "Wi-Fi" : mode === "serial" ? "USB" : "—"}
              </div>
            </div>

            <div className="screen-mini">
              <h4>Пульс</h4>
              <div className="value">
                {bpm && bpm > 0 ? `${bpm} bpm` : "—"}
              </div>
              <div className={`led-beat ${ledOn ? "on" : ""}`} />
            </div>

            <div className="screen-mini">
              <h4>Температура</h4>
              <div className="value" style={{ color: "#cbd5e1" }}>
                {temperature == null ? "—" : `${temperature.toFixed(1)} °C`}
              </div>
            </div>

            {status && (
              <div className="screen-mini" style={{minHeight:84, alignItems:"flex-start"}}>
                <h4 style={{marginBottom:8}}>Сеть</h4>
                <div style={{fontSize:12, color:"#a1a1aa"}}>
                  Wi-Fi: {status.ssid}<br/>
                  IP: {status.ip}<br/>
                  RSSI: {status.rssi} dBm
                </div>
              </div>
            )}

            {error && (
              <div className="screen-mini" style={{ borderColor:"#2a0f10" }}>
                <h4 style={{color:"#fecaca"}}>Ошибка</h4>
                <div style={{fontSize:12, color:"#fecaca"}}>{error}</div>
              </div>
            )}
          </div>

          <div className="screen">
            <h3>Осциллограмма</h3>
            <div style={{ position:"relative" }}>
              <PulseChart ref={(fn) => (chartRef.current = fn as any)} />
              <div className="gridline" />
            </div>
          </div>
        </div>

        <div className="keys">
          <div className="key-row">
            {editMode ? (
              <>
                <input
                  id="ipbox"
                  className="key"
                  style={{minWidth:240, textAlign:"left"}}
                  defaultValue={ip}
                  placeholder="например: 192.168.0.42"
                />
                <div className="key accent" onClick={handleConnectClick}>Подключить (Wi-Fi)</div>
                <div className="key" onClick={() => setEditMode(false)}>Отмена</div>
              </>
            ) : (
              <>
                <div className="key" onClick={() => setEditMode(true)}>Изменить IP</div>
                <div className="key primary" onClick={() => connectUSB()}>Подключить по USB</div>
              </>
            )}
          </div>

          <div className="key-row">
            <div
              className="key danger"
              onClick={() => {
                localStorage.removeItem("esp_ip");
                setIp(""); setConnected(false); setError(null);
                cleanup();
                queueRef.current.length = 0;
                setBpm(null); setTemperature(null); setStatus(null); setMode(null);
              }}
            >
              Сброс
            </div>
          </div>
        </div>

        <div className="sticker">DeltaSquare • HM-02 • SN: DS-A7-4392</div>
        <div className="vents">
          <div className="slit" /><div className="slit" /><div className="slit" />
        </div>
      </div>
    </div>
  );
}
