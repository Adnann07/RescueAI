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
