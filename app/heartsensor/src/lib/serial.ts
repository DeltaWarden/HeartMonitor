// src/lib/serial.ts

// тип пакета от ESP32
export type SensorResp = {
    heartbeat: number;
    finger: boolean;
    temperature: number | null;
    raw: number[];
  };
  
  // функция подключения к Web Serial API
  export async function connectSerial(
    onPacket: (data: SensorResp) => void,
    onState?: (state: "open" | "close" | "error") => void
  ) {
    // @ts-ignore
    if (!navigator.serial) throw new Error("Web Serial API недоступен (нужен Chrome/Edge, HTTPS или localhost).");
  
    // @ts-ignore
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    onState?.("open");
  
    const reader = port.readable!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let closed = false;
  
    const pump = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done || closed) break;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (!line) continue;
              try {
                const json = JSON.parse(line);
                onPacket(json);
              } catch (e) {
                console.warn("bad serial line", line);
              }
            }
          }
        }
      } catch (e) {
        onState?.("error");
      } finally {
        try { reader.releaseLock(); } catch {}
        try { await port.close(); } catch {}
        onState?.("close");
      }
    };
  
    pump();
  
    return {
      async close() {
        closed = true;
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
        try { await port.close(); } catch {}
        onState?.("close");
      }
    };
  }
  