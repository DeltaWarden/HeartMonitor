# ESP32 Health Monitor

Минимальный прототип системы мониторинга пульса и температуры тела на базе ESP32.  
Данные считываются с датчиков и отправляются по Wi-Fi (через WebSocket + REST) или по USB Serial.  
Для отображения используется веб-интерфейс на React + Canvas-осциллограф.

---

## Возможности

- Подключение к Wi-Fi и трансляция данных по WebSocket (`/ws`).
- REST-эндпоинт `/status` для получения информации о сети (SSID, IP, RSSI).
- Сбор данных:
  - Пульс (анализ аналогового сигнала, расчёт BPM).
  - Температура тела (DS18B20).
- Локальное отображение на LCD 1602 I²C:
  - BPM и графическая полоса.
  - Температура в градусах Цельсия.
- Передача данных:
  - JSON-пакеты через WebSocket.
  - Дублирование в Serial-порт для отладки.
- React-панель управления:
  - Осциллограмма.
  - Мини-экраны: режим работы, BPM, температура.
  - Сетевой статус и ошибки.
  - Кнопки управления (IP, USB, сброс).

---

## Аппаратные компоненты

- **ESP32** (или аналогичная плата).
- **Датчик пульса AD8232** (аналоговый, выход 0…3.3В).
- **DS18B20** (цифровой датчик температуры, подключение по OneWire).
- **LCD 1602** с модулем I²C (адрес 0x27).
- Провода Dupont.

### Подключение

| Компонент       | ESP32 Pin |
|-----------------|-----------|
| LCD SDA         | GPIO21    |
| LCD SCL         | GPIO22    |
| DS18B20 Data    | GPIO2     |
| Pulse Sensor    | GPIO34 (ADC) |
| VCC             | 3.3V      |
| GND             | GND       |

---

## Установка и сборка прошивки

1. Установить [Arduino IDE](https://www.arduino.cc/en/software).
2. Добавить поддержку **ESP32**:
   - `File → Preferences → Additional Board Manager URLs`  
     добавить:  
     ```
     https://dl.espressif.com/dl/package_esp32_index.json
     ```
   - `Tools → Board → Board Manager → ESP32 → Install`.
3. Подключить библиотеки:
   - `LiquidCrystal_I2C` (через Library Manager).
   - `ESPAsyncWebServer` и `AsyncTCP`.
4. Залить скетч `monitor.ino` на ESP32.

---

## ВЕБ-Приложение

1. Зайдите в папку heartsensor
2. Откройте терминал внутри этой папки
3. npm install
4. npm run dev

---

## Конфигурация

В коде (`Config cfg`):

```cpp
String ssid = "test";         // SSID точки доступа
String pass = "12345678";     // пароль Wi-Fi
int adcPin = 34;              // вход пульс-датчика
int tempPin = 2;              // DS18B20 data pin
unsigned long sampleInterval = 4;    // частота дискретизации АЦП (мс)
unsigned long pushInterval   = 300;  // частота отправки пакетов (мс)
unsigned long tempInterval   = 5000; // измерение температуры (мс)

