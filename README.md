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

## 📄 License

MIT
