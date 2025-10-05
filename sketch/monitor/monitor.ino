#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <OneWire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>

// -------------------- CONFIG --------------------
struct Config {
  String ssid = "goxa";
  String pass = "12345678";
  int adcPin = 34;          // аналог датчика пульса (0..4095)
  int tempPin = 2;          // DS18B20
  unsigned long sampleInterval = 4;     // период чтения ADC (мс)
  unsigned long pushInterval   = 300;   // период отправки батчей
  unsigned long tempInterval   = 5000;  // измерять температуру раз в 5с
  int rawBufSize = 900;                 // размер буфера
} cfg;

// -------------------- GLOBALS --------------------
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

LiquidCrystal_I2C lcd(0x27, 16, 2);

OneWire *ow = nullptr;
byte dsRom[8];
bool haveRom = false;

const int RAW_MAX = 2048;
int rawBuf[RAW_MAX];
int rawHead = 0;
int rawCount = 0;

int rawValue = 0;
float bodyTemp = NAN;

unsigned long lastSample = 0;
unsigned long lastPush   = 0;
unsigned long lastTempTick = 0;

// BPM
static const int IBI_N = 6;
unsigned long lastBeatAt = 0;
unsigned long ibi[IBI_N];
int ibiCount = 0, ibiIdx = 0;
int bpm = 0;
const unsigned refractoryMs = 250;
const int DETECT_BPM_THRESHOLD = 600;

// сглаживание
const int SMOOTH_N = 8;
int smoothBuf[SMOOTH_N];
int smoothIdx = 0;

// LCD линия
char lineBuf[17];
int linePos = 0;

// -------------------- HELPERS --------------------
void wifiConnect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("WiFi...");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(200);
    lcd.setCursor(0,1); lcd.print(".");
  }
  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    String ip = WiFi.localIP().toString();
    lcd.setCursor(0,0); lcd.print("WiFi OK");
    lcd.setCursor(0,1); lcd.print(ip);
    Serial.println("[WiFi] " + ip);
    delay(1500);
  } else {
    lcd.setCursor(0,0); lcd.print("WiFi FAIL");
    Serial.println("[WiFi] FAIL");
    delay(1500);
  }
  lcd.clear();
}

void initOneWire() {
  if (ow) { delete ow; ow = nullptr; }
  ow = new OneWire(cfg.tempPin);
  haveRom = false;
}

bool owSearchRom() {
  if (!ow) return false;
  ow->reset_search();
  if (!ow->search(dsRom)) return false;
  if (dsRom[0] != 0x28) return false;
  haveRom = true;
  return true;
}

void tempStartConversion() {
  if (!ow) return;
  if (!haveRom && !owSearchRom()) return;
  ow->reset();
  ow->select(dsRom);
  ow->write(0x44, 1);
}

bool tempReadOnce(float &outC) {
  if (!ow) return false;
  if (!haveRom && !owSearchRom()) return false;
  ow->reset();
  ow->select(dsRom);
  ow->write(0xBE);
  byte data[9];
  for (int i = 0; i < 9; i++) data[i] = ow->read();
  int16_t raw = (data[1] << 8) | data[0];
  outC = (float)raw / 16.0f;
  return true;
}

void pushRaw(int v) {
  smoothBuf[smoothIdx] = v;
  smoothIdx = (smoothIdx + 1) % SMOOTH_N;
  long sum = 0;
  for (int i = 0; i < SMOOTH_N; i++) sum += smoothBuf[i];
  int smoothed = sum / SMOOTH_N;

  int norm = map(smoothed, 0, 4095, 0, 1023);

  if (cfg.rawBufSize > RAW_MAX) cfg.rawBufSize = RAW_MAX;
  if (cfg.rawBufSize < 50) cfg.rawBufSize = 50;

  rawBuf[rawHead] = norm;
  rawHead = (rawHead + 1) % cfg.rawBufSize;
  if (rawCount < cfg.rawBufSize) rawCount++;
}

void updateBpmFromNorm(int xNorm) {
  static int last = 0;
  static bool up = false;
  unsigned long now = millis();

  bool rising = (xNorm > last);
  if (!up && rising && xNorm > DETECT_BPM_THRESHOLD && (now - lastBeatAt) > refractoryMs) {
    if (lastBeatAt != 0) {
      unsigned long ibiMs = now - lastBeatAt;
      ibi[ibiIdx] = ibiMs;
      ibiIdx = (ibiIdx + 1) % IBI_N;
      if (ibiCount < IBI_N) ibiCount++;
      unsigned long s = 0;
      for (int i = 0; i < ibiCount; i++) s += ibi[i];
      float avg = s / (float)ibiCount;
      int newBpm = (int)roundf(60000.0f / avg);
      if (newBpm >= 30 && newBpm <= 220) bpm = newBpm;
    }
    lastBeatAt = now;
  }
  up = rising;
  last = xNorm;
}

String buildSensorJson() {
  String out;
  out.reserve(2048);
  out += "{\"heartbeat\":";
  out += bpm;
  out += ",\"finger\":";
  out += (rawValue > 100 ? "true" : "false");
  out += ",\"temperature\":";
  if (isnan(bodyTemp)) out += "null"; else out += String(bodyTemp, 2);
  out += ",\"raw\":[";
  if (rawCount > 0) {
    int n = rawCount;
    int start = (rawHead - n + cfg.rawBufSize) % cfg.rawBufSize;
    for (int i = 0; i < n; i++) {
      int idx = (start + i) % cfg.rawBufSize;
      out += rawBuf[idx];
      if (i != n - 1) out += ",";
    }
  }
  out += "]}";
  return out;
}

void sendPacketBothWays() {
  String json = buildSensorJson();
  if (ws.count() > 0) ws.textAll(json);
  Serial.println(json);
  rawCount = 0;
}

void lcdUpdate() {
  lcd.setCursor(0,0);
  lcd.print("BPM:");
  if (bpm > 0) lcd.print(bpm); else lcd.print("-- ");

  lcd.setCursor(0,1);
  lcd.print("T:");
  if (!isnan(bodyTemp)) {
    lcd.print(bodyTemp,1);
    lcd.print((char)223);
    lcd.print("C   ");
  } else {
    lcd.print("--.-C   ");
  }
}

// -------------------- SETUP/LOOP --------------------
void setup() {
  Serial.begin(115200);
  lcd.init(); lcd.backlight();
  for (int i=0;i<16;i++) lineBuf[i] = ' ';

  initOneWire();
  wifiConnect();

  ws.onEvent([](AsyncWebSocket *server, AsyncWebSocketClient *client,
                AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
      Serial.printf("[WS] Client #%u connected\n", client->id());
    } else if (type == WS_EVT_DISCONNECT) {
      Serial.printf("[WS] Client #%u disconnected\n", client->id());
    } else if (type == WS_EVT_DATA) {
      AwsFrameInfo *info = (AwsFrameInfo*)arg;
      if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
        String msg = String((char*)data).substring(0, len);
        StaticJsonDocument<128> doc;
        if (deserializeJson(doc, msg) == DeserializationError::Ok) {
          if (doc["cmd"] == "setHz") {
            cfg.sampleInterval = doc["value"];
            Serial.printf("[CMD] sampleInterval = %lu\n", cfg.sampleInterval);
          }
        }
      }
    }
  });
  server.addHandler(&ws);

  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  server.on("/status", HTTP_GET, [](AsyncWebServerRequest *req){
    String s = "{\"ssid\":\"" + WiFi.SSID() + "\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"rssi\":" + String(WiFi.RSSI()) + "}";
    auto *res = req->beginResponse(200, "application/json", s);
    res->addHeader("Access-Control-Allow-Origin", "*");
    req->send(res);
  });

  server.begin();
  tempStartConversion(); 
}

void loop() {
  unsigned long now = millis();

  if (now - lastSample >= cfg.sampleInterval) {
    lastSample = now;
    rawValue = analogRead(cfg.adcPin);
    pushRaw(rawValue);
    int lastNorm = rawBuf[(rawHead - 1 + cfg.rawBufSize) % cfg.rawBufSize];
    updateBpmFromNorm(lastNorm);
  }

  if (now - lastPush >= cfg.pushInterval) {
    lastPush = now;
    if (rawCount > 0) {
      sendPacketBothWays();
      lcdUpdate();
    }
  }

  if (now - lastTempTick >= cfg.tempInterval) {
    lastTempTick = now;
    tempStartConversion();
    delay(800); 
    float t;
    if (tempReadOnce(t)) bodyTemp = t; else bodyTemp = NAN;
  }
}
