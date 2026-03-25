# 🚨 RescueAI — Bangladesh Disaster Response Platform

A real-time disaster monitoring, risk assessment, and field coordination platform built for Bangladesh. RescueAI combines crowd-sourced incident reports, live global disaster data (GDACS), and an automated AI-powered risk pipeline to help responders act faster.

---

## ✨ Features

### 🗺️ District Risk Map
The default landing page. Displays an interactive choropleth map of all 64 Bangladesh districts, colour-coded by computed flood and drought risk. Risk scores are updated automatically every 3 hours by the pipeline and can also be triggered manually.

### 📡 Reporter Map (`/reporter`)
A collaborative live map where field reporters can join, drop their location, and submit disaster reports in real time. Reports are broadcast instantly to all connected clients via Socket.io. An AI briefing panel (powered by **Groq / LLaMA-3.3-70B**) summarises incoming reports into a concise operational briefing in Bengali.

### 🌊 Crowd-sourced Disaster Feed (`/disasters`)
A live feed of all crowd-reported incidents with severity filtering (critical / high / medium / low). Reports are pinned on an interactive Leaflet map and listed in a scrollable sidebar.

### 🌍 Live Global Disasters (`/live-disasters`)
Pulls real-world disaster data from **GDACS (Global Disaster Alert and Coordination System)** and displays active events relevant to Bangladesh and the surrounding region.

### 📊 Dashboard (`/dashboard`)
A summary dashboard aggregating key metrics — active reports, district risk levels, rescuer positions, and pipeline status — in one place.

### 🏃 Rescuer Tracking
Field rescuers (via a companion Flutter app) connect over Socket.io and broadcast their GPS position in real time. The server maintains a 15-point movement trail per rescuer and keeps offline rescuers visible for 24 hours before purging them.

### 🧪 Simulation Mode (`/simulation`)
A sandboxed environment for running tabletop disaster scenarios — useful for training, drills, and testing the system without affecting live data.

### 🙋 Volunteer Registration (`/volunteer`)
Open, no-code-required registration for field volunteers and rescuers.

---

## 🔬 Risk Assessment Pipeline

The automated pipeline runs on server start and every **3 hours**:

1. Fetches the latest GDACS RSS/XML feed (cached for 3 hours)
2. Parses active flood and drought events with severity and alert levels
3. Scores each event against **64 Bangladesh district bounding boxes**
4. Computes per-district risk boosts (flood + drought + overall)
5. Merges GDACS boosts with crowd-report boosts
6. Broadcasts updated risk scores to all clients via `pipeline:update`
7. Checks thresholds and issues / clears **early warnings** per district

Pipeline results are also available as JSON via the REST API.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js, Express |
| Real-time | Socket.io (polling + WebSocket) |
| Maps | Leaflet.js |
| Disaster data | GDACS XML feed |
| AI briefing | Groq API (LLaMA-3.3-70B) |
| Flutter integration | Socket.io client (rescuer app) |
| Fonts | DM Sans, DM Mono (Google Fonts) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/your-username/rescueai.git
cd rescueai
npm install
```

### Environment Variables

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key for AI briefing generation on the Reporter page |
| `PORT` | Server port (default: `3000`) |

### Running Locally

```bash
node server.js
```

The server will start at `http://localhost:3000`.

---

## 📡 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/gdacs` | Raw GDACS XML feed (cached 3 hours) |
| `GET` | `/api/risk-pipeline` | Latest district risk boosts (JSON) |
| `POST` | `/api/risk-pipeline/run` | Manually trigger a pipeline run |
| `GET` | `/api/rescuers` | Live rescuer positions (JSON) |
| `GET` | `/api/early-warnings` | Active early warnings per district (JSON) |
| `GET` | `/api/infrastructure` | OSM hospital locations (JSON) |

---

## 🔌 Socket.io Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `user:join` | `{ name, lat, lng, color }` | Register as a live user on the reporter map |
| `user:move` | `{ lat, lng }` | Update own location |
| `report:new` | `{ type, severity, title, desc, location, district, lat, lng }` | Submit a new disaster report |
| `rescuer:join` | `{ name, team, status, lat, lng }` | Register as a field rescuer (Flutter app) |
| `rescuer:move` | `{ lat, lng }` | Update rescuer GPS position |
| `rescuer:status` | `{ status }` | Update rescuer status (`available` / `on_mission` / `unreachable`) |
| `pipeline:run` | — | Manually trigger a risk pipeline run |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `init` | `{ reports, users, yourId, rescuers }` | Initial state on connect |
| `report:new` | Report object | New crowd report broadcast |
| `users:list` | Array of users | Updated live user list |
| `rescuers:list` | Array of rescuers | Updated rescuer list |
| `rescuer:moved` | `{ id, lat, lng, trail }` | Single rescuer position update |
| `pipeline:update` | `{ boosts, lastRun, status, runCount, eventCount }` | Risk pipeline results |
| `earlywarning:update` | `{ warnings, count, issuedAt }` | Early warning changes |

---

## 🗂️ Pages at a Glance

| Route | File | Description |
|---|---|---|
| `/` | `risk-map.html` | District risk map (default) |
| `/reporter` | `index.html` | Live reporter map + AI briefing |
| `/disasters` | `disasters.html` | Crowd-sourced incident feed |
| `/live-disasters` | `live-disasters.html` | GDACS real-world disaster data |
| `/dashboard` | `dashboard.html` | Summary dashboard |
| `/simulation` | `simulation.html` | Simulation / training mode |
| `/volunteer` | `volunteer.html` | Volunteer registration |

---

## 🏗️ Deployment

The app is designed to run on any Node.js host. For one-click deployment on **Railway**:

1. Push the repo to GitHub
2. Create a new Railway project and connect the repo
3. Add the `GROQ_API_KEY` environment variable in Railway's settings
4. Railway auto-detects the `npm start` / `node server.js` command and deploys

The `PORT` environment variable is set automatically by Railway.

---

## 📱 Flutter Companion App

A Flutter mobile app (Android/iOS) for field rescuers and the general public. It connects to the same RescueAI backend over Socket.io and the Groq API, and is fully in Bengali.

### Screens

| Tab | Screen | Description |
|---|---|---|
| 🎙️ AI সহায়তা | `VoiceChatScreen` | Voice-first AI assistant for disaster & first-aid guidance |
| 🌤️ আবহাওয়া | `WeatherScreen` | Current conditions + 5-day forecast with AI Bengali summary |
| 🌊 নদীর স্তর | `RiverLevelPage` | Live river level monitoring from FFWC with danger-level alerts |
| 🚨 রেসকিউ | `RescueScreen` | Field rescuer GPS tracking connected to the web dashboard |

---

### 🎙️ Voice AI Assistant

The voice chat screen is the core feature of the app. It supports a full voice loop:

1. **Record** — user holds the mic button and speaks in Bengali
2. **Transcribe** — audio is sent to **Groq Whisper** (`whisper-large-v3`) for speech-to-text
3. **LLM reply** — transcript is sent to **LLaMA-3.3-70B** via Groq chat API with a disaster/first-aid system prompt
4. **Speak** — reply is read aloud via `flutter_tts`

The assistant is scoped to disaster and first-aid topics (floods, cyclones, earthquakes, CPR, burns, snake bites, etc.) and always responds in Bengali. It cites important emergency numbers (999, 1090) and major hospital contacts.

### 🌤️ Weather Screen

Fetches current conditions and a 5-day forecast from **OpenWeatherMap** using the device's GPS coordinates. The raw data is passed to Groq/LLaMA to generate a plain-Bengali summary with contextual warnings (heat wave if ≥ 38 °C, storm warning if wind ≥ 15 m/s). Results are cached locally for 24 hours via `SharedPreferences` so the app works offline after the first load.

### 🌊 River Level Monitor

Pulls observed water-level data from the **FFWC (Flood Forecasting and Warning Centre)** API (`api3.ffwc.gov.bd`) for the top 30 monitored stations. Each card shows current level vs. danger level as a colour-coded progress bar with one of four statuses: স্বাভাবিক (normal) → সতর্কতা (watch) → বিপদের কাছে (near danger) → বিপদসীমা অতিক্রম (exceeded). Falls back to hardcoded seed data if the network is unavailable.

### 🚨 Rescuer Tracking Screen

Field rescuers register with their name and team, then the app streams their GPS position to the RescueAI server every **5 seconds** via Socket.io. Status can be toggled between Available, On Mission, and Unreachable. The server keeps the rescuer's dot visible on the web dashboard for 24 hours after they go offline.

---

### App Tech Stack

| Layer | Technology |
|---|---|
| Framework | Flutter (Dart) |
| Voice recording | `flutter_sound` |
| Text-to-speech | `flutter_tts` |
| Speech-to-text | Groq Whisper API (`whisper-large-v3`) |
| AI chat | Groq API (LLaMA-3.3-70B) |
| Weather | OpenWeatherMap API |
| River data | FFWC Bangladesh API |
| Real-time | `socket_io_client` |
| Location | `geolocator` |
| Local cache | `shared_preferences` |

---

### App Setup

#### Prerequisites
- Flutter SDK 3.x
- Android Studio / Xcode
- A Groq API key
- An OpenWeatherMap API key

#### Environment Variables

The app reads the Groq key at build time via `--dart-define`:

```bash
flutter run --dart-define=GROQ_API_KEY=your_key_here
```

The OpenWeatherMap key is set directly in `weather_service.dart`:

```dart
static const String _weatherApiKey = 'YOUR_OWM_KEY_HERE';
```

#### Running the App

```bash
cd app   # or wherever the Flutter project lives
flutter pub get
flutter run --dart-define=GROQ_API_KEY=your_key_here
```

#### Key Dependencies (`pubspec.yaml`)

```yaml
dependencies:
  flutter_sound: ...        # Audio recording
  flutter_tts: ...          # Text-to-speech
  permission_handler: ...   # Mic & location permissions
  geolocator: ...           # GPS
  socket_io_client: ...     # Real-time rescuer tracking
  http: ...                 # API calls
  shared_preferences: ...   # Weather cache
  path_provider: ...        # Temp file path for audio
```

#### Android Permissions

Add the following to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.INTERNET"/>
```

---

## 📄 License

MIT
