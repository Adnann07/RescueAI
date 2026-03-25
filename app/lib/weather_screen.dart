import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'weather_service.dart';
import 'weather_cache.dart';
import 'groq_service.dart';

class WeatherScreen extends StatefulWidget {
  const WeatherScreen({super.key});

  @override
  State<WeatherScreen> createState() => _WeatherScreenState();
}

class _WeatherScreenState extends State<WeatherScreen> {
  final FlutterTts _tts = FlutterTts();

  WeatherData? _weatherData;
  String? _banglaDescription;
  bool _loading = false;
  bool _speaking = false;
  bool _fromCache = false;
  String? _cacheAge;
  String? _error;
  String _locationStatus = 'আপনার অবস্থান নির্ধারণ হচ্ছে...';

  @override
  void initState() {
    super.initState();
    _initTts();
    _loadLocationWeather();
  }

  Future<void> _initTts() async {
    await _tts.setLanguage('bn-BD');
    await _tts.setSpeechRate(0.5);
    await _tts.setVolume(1.0);
    _tts.setCompletionHandler(() {
      if (mounted) setState(() => _speaking = false);
    });
  }

  Future<void> _loadLocationWeather() async {
    setState(() {
      _loading = true;
      _error = null;
      _banglaDescription = null;
      _weatherData = null;
      _locationStatus = 'আপনার অবস্থান নির্ধারণ হচ্ছে...';
    });

    try {
      // Check if location services are enabled
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        setState(() {
          _loading = false;
          _error = 'লোকেশন সেবা বন্ধ আছে। ফোনের সেটিংস থেকে GPS চালু করুন।';
        });
        return;
      }

      // Check/request permission
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          setState(() {
            _loading = false;
            _error = 'লোকেশন অনুমতি দেওয়া হয়নি। অনুগ্রহ করে অনুমতি দিন।';
          });
          return;
        }
      }
      if (permission == LocationPermission.deniedForever) {
        setState(() {
          _loading = false;
          _error = 'লোকেশন অনুমতি স্থায়ীভাবে বন্ধ। ফোনের সেটিংস থেকে অনুমতি দিন।';
        });
        return;
      }

      setState(() => _locationStatus = 'অবস্থান পাওয়া গেছে, আবহাওয়া আনা হচ্ছে...');

      // Get position
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.low,
          timeLimit: Duration(seconds: 10),
        ),
      );

      await _fetchWeather(position.latitude, position.longitude);
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'অবস্থান পাওয়া যায়নি: ${e.toString().replaceAll('Exception: ', '')}';
        });
      }
    }
  }

  Future<void> _fetchWeather(double lat, double lon) async {
    try {
      final result = await WeatherService.getWeather(lat: lat, lon: lon);
      if (mounted) {
        setState(() {
          _weatherData = result.data;
          _banglaDescription = result.banglaDesc;
          _fromCache = result.fromCache;
          _cacheAge = result.cacheAge;
          _loading = false;
        });
      }
    } on RateLimitException catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.message; });
    } catch (e) {
      if (mounted) setState(() {
        _loading = false;
        _error = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  Future<void> _toggleSpeak() async {
    if (_banglaDescription == null) return;
    if (_speaking) {
      await _tts.stop();
      setState(() => _speaking = false);
    } else {
      setState(() => _speaking = true);
      await _tts.speak(_banglaDescription!);
    }
  }

  @override
  void dispose() {
    _tts.stop();
    super.dispose();
  }

  bool get _isHeatwave => _weatherData != null && _weatherData!.tempC >= 38;
  bool get _isStorm => _weatherData != null && _weatherData!.windSpeed >= 15;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0E1A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D1117),
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: const Color(0xFF1565C0).withOpacity(0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.cloud, color: Color(0xFF42A5F5), size: 20),
            ),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('আবহাওয়া পূর্বাভাস',
                    style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                Text('Weather Forecast',
                    style: TextStyle(color: Colors.white54, fontSize: 11)),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.my_location, color: Colors.white54),
            tooltip: 'আবার লোড করুন',
            onPressed: _loadLocationWeather,
          ),
        ],
      ),
      body: Column(
        children: [
          // Emergency banner
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
            color: const Color(0xFFD32F2F).withOpacity(0.15),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.phone, color: Color(0xFFEF9A9A), size: 14),
                SizedBox(width: 6),
                Text('জরুরি সেবা: ৯৯৯ • দুর্যোগ: ১০৯০',
                    style: TextStyle(color: Color(0xFFEF9A9A), fontSize: 12, fontWeight: FontWeight.w500)),
              ],
            ),
          ),

          Expanded(
            child: _loading
                ? _buildLoading()
                : _error != null
                ? _buildError()
                : _weatherData != null
                ? _buildContent()
                : const SizedBox(),
          ),
        ],
      ),
    );
  }

  Widget _buildLoading() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: Color(0xFF42A5F5)),
          const SizedBox(height: 20),
          const Icon(Icons.location_on, color: Color(0xFF42A5F5), size: 32),
          const SizedBox(height: 12),
          Text(_locationStatus,
              style: const TextStyle(color: Colors.white54, fontSize: 14),
              textAlign: TextAlign.center),
        ],
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.location_off, color: Colors.white24, size: 56),
            const SizedBox(height: 16),
            Text(_error!,
                style: const TextStyle(color: Colors.white54, fontSize: 14),
                textAlign: TextAlign.center),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _loadLocationWeather,
              icon: const Icon(Icons.refresh),
              label: const Text('আবার চেষ্টা করুন'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF1565C0),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent() {
    final data = _weatherData!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Location indicator + cache badge
          Row(
            children: [
              const Icon(Icons.location_on, color: Color(0xFF42A5F5), size: 16),
              const SizedBox(width: 4),
              Expanded(
                child: Text(data.cityName,
                    style: const TextStyle(color: Color(0xFF42A5F5), fontSize: 13),
                    overflow: TextOverflow.ellipsis),
              ),
              if (_fromCache && _cacheAge != null)
                Container(
                  margin: const EdgeInsets.only(right: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.orange.withOpacity(0.4)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.offline_bolt, color: Colors.orange, size: 11),
                      const SizedBox(width: 3),
                      Text(_cacheAge!, style: const TextStyle(color: Colors.orange, fontSize: 10)),
                    ],
                  ),
                ),
              GestureDetector(
                onTap: _loadLocationWeather,
                child: const Row(
                  children: [
                    Icon(Icons.refresh, color: Colors.white38, size: 14),
                    SizedBox(width: 4),
                    Text('আপডেট', style: TextStyle(color: Colors.white38, fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Alert banners (no flood alert)
          if (_isHeatwave)
            _buildAlert(Icons.thermostat, 'তাপপ্রবাহ সতর্কতা',
                'তাপমাত্রা ${data.tempC.toStringAsFixed(1)}°C — বাইরে যাওয়া থেকে বিরত থাকুন',
                const Color(0xFFFF6D00)),
          if (_isStorm)
            _buildAlert(Icons.air, 'ঝড়ের সতর্কতা',
                'বাতাসের গতি ${data.windSpeed.toStringAsFixed(1)} m/s — সাবধান থাকুন',
                const Color(0xFF6A1B9A)),

          // Current weather card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0D47A1), Color(0xFF1A237E)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${data.tempC.toStringAsFixed(1)}°C',
                            style: const TextStyle(
                                color: Colors.white, fontSize: 52, fontWeight: FontWeight.bold)),
                        Text('অনুভূতি ${data.feelsLikeC.toStringAsFixed(1)}°C',
                            style: const TextStyle(color: Colors.white60, fontSize: 13)),
                        const SizedBox(height: 4),
                        Text(data.description,
                            style: const TextStyle(color: Colors.white70, fontSize: 13)),
                      ],
                    ),
                    const Icon(Icons.wb_sunny, color: Colors.amber, size: 64),
                  ],
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _buildStat(Icons.water_drop, '${data.humidity}%', 'আর্দ্রতা'),
                    _buildStat(Icons.air, '${data.windSpeed.toStringAsFixed(1)} m/s', 'বাতাস'),
                    _buildStat(Icons.grain, '${data.rainMm?.toStringAsFixed(1) ?? '0'}mm', 'বৃষ্টি'),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // AI Bangla description
          if (_banglaDescription != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1F2E),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withOpacity(0.08)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.auto_awesome, color: Color(0xFF42A5F5), size: 16),
                          SizedBox(width: 6),
                          Text('AI বিশ্লেষণ',
                              style: TextStyle(color: Color(0xFF42A5F5), fontSize: 13, fontWeight: FontWeight.w600)),
                        ],
                      ),
                      GestureDetector(
                        onTap: _toggleSpeak,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: _speaking ? const Color(0xFF2E7D32) : const Color(0xFF1565C0),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            children: [
                              Icon(_speaking ? Icons.stop_rounded : Icons.volume_up_rounded,
                                  color: Colors.white, size: 14),
                              const SizedBox(width: 4),
                              Text(_speaking ? 'থামুন' : 'শুনুন',
                                  style: const TextStyle(color: Colors.white, fontSize: 12)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(_banglaDescription!,
                      style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.6)),
                ],
              ),
            ),

          const SizedBox(height: 16),

          // 5-day forecast
          const Text('৫ দিনের পূর্বাভাস',
              style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ...data.forecast.map((day) => _buildForecastRow(day)),
        ],
      ),
    );
  }

  Widget _buildAlert(IconData icon, String title, String subtitle, Color color) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.bold)),
                Text(subtitle, style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStat(IconData icon, String value, String label) {
    return Column(
      children: [
        Icon(icon, color: Colors.white60, size: 18),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 11)),
      ],
    );
  }

  Widget _buildForecastRow(ForecastDay day) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1F2E),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Row(
        children: [
          Text(day.date.substring(5),
              style: const TextStyle(color: Colors.white54, fontSize: 12)),
          const SizedBox(width: 12),
          Expanded(
            child: Text(day.description,
                style: const TextStyle(color: Colors.white70, fontSize: 12)),
          ),
          Text('${day.minTemp.toStringAsFixed(0)}° / ${day.maxTemp.toStringAsFixed(0)}°C',
              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600)),
          const SizedBox(width: 10),
          Icon(day.rainMm > 5 ? Icons.umbrella : Icons.wb_sunny,
              color: day.rainMm > 5 ? const Color(0xFF42A5F5) : Colors.amber,
              size: 16),
        ],
      ),
    );
  }
}