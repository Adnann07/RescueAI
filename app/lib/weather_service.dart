import 'package:http/http.dart' as http;
import 'dart:convert';
import 'groq_service.dart';
import 'weather_cache.dart';

class WeatherData {
  final String cityName;
  final double tempC;
  final double feelsLikeC;
  final double windSpeed;
  final int humidity;
  final String description;
  final double? rainMm;
  final List<ForecastDay> forecast;

  WeatherData({
    required this.cityName,
    required this.tempC,
    required this.feelsLikeC,
    required this.windSpeed,
    required this.humidity,
    required this.description,
    this.rainMm,
    required this.forecast,
  });

  /// Convert to JSON for caching
  Map<String, dynamic> toJson() => {
    'cityName': cityName,
    'tempC': tempC,
    'feelsLikeC': feelsLikeC,
    'windSpeed': windSpeed,
    'humidity': humidity,
    'description': description,
    'rainMm': rainMm,
    'forecast': forecast.map((f) => f.toJson()).toList(),
  };

  /// Restore from cached JSON
  factory WeatherData.fromJson(Map<String, dynamic> json) => WeatherData(
    cityName: json['cityName'],
    tempC: (json['tempC'] as num).toDouble(),
    feelsLikeC: (json['feelsLikeC'] as num).toDouble(),
    windSpeed: (json['windSpeed'] as num).toDouble(),
    humidity: json['humidity'] as int,
    description: json['description'],
    rainMm: json['rainMm'] != null ? (json['rainMm'] as num).toDouble() : null,
    forecast: (json['forecast'] as List)
        .map((f) => ForecastDay.fromJson(f))
        .toList(),
  );
}

class ForecastDay {
  final String date;
  final double minTemp;
  final double maxTemp;
  final double windSpeed;
  final double rainMm;
  final String description;

  ForecastDay({
    required this.date,
    required this.minTemp,
    required this.maxTemp,
    required this.windSpeed,
    required this.rainMm,
    required this.description,
  });

  Map<String, dynamic> toJson() => {
    'date': date,
    'minTemp': minTemp,
    'maxTemp': maxTemp,
    'windSpeed': windSpeed,
    'rainMm': rainMm,
    'description': description,
  };

  factory ForecastDay.fromJson(Map<String, dynamic> json) => ForecastDay(
    date: json['date'],
    minTemp: (json['minTemp'] as num).toDouble(),
    maxTemp: (json['maxTemp'] as num).toDouble(),
    windSpeed: (json['windSpeed'] as num).toDouble(),
    rainMm: (json['rainMm'] as num).toDouble(),
    description: json['description'],
  );
}

class WeatherResult {
  final WeatherData data;
  final String banglaDesc;
  final bool fromCache;
  final String? cacheAge; // e.g. "৩ ঘণ্টা আগে"

  WeatherResult({
    required this.data,
    required this.banglaDesc,
    required this.fromCache,
    this.cacheAge,
  });
}

class WeatherService {
  // ⚠️ Replace with your OpenWeatherMap API key
  static const String _weatherApiKey = '56369291ec23472f20ce2c0b3af4b229';

  /// Main entry point — checks cache first, fetches if expired or missing
  static Future<WeatherResult> getWeather({
    double? lat,
    double? lon,
  }) async {
    // 1. Try loading from cache
    final cached = await WeatherCache.load();

    if (cached != null && !cached.isExpired) {
      // Cache is valid — return immediately, no API call
      return WeatherResult(
        data: WeatherData.fromJson(cached.weatherJson),
        banglaDesc: cached.banglaDesc,
        fromCache: true,
        cacheAge: cached.ageText,
      );
    }

    // 2. Cache expired or missing — try fetching fresh data
    try {
      final data = lat != null && lon != null
          ? await _fetchByCoords(lat, lon)
          : throw Exception('অবস্থান পাওয়া যায়নি।');

      final banglaDesc = await describeInBangla(data);

      // 3. Save to cache
      await WeatherCache.save(
        weatherJson: data.toJson(),
        banglaDesc: banglaDesc,
      );

      return WeatherResult(
        data: data,
        banglaDesc: banglaDesc,
        fromCache: false,
      );
    } catch (e) {
      // 4. Network failed — fall back to expired cache if available
      if (cached != null) {
        return WeatherResult(
          data: WeatherData.fromJson(cached.weatherJson),
          banglaDesc: cached.banglaDesc,
          fromCache: true,
          cacheAge: cached.ageText,
        );
      }
      rethrow; // No cache at all — propagate error
    }
  }

  static Future<WeatherData> _fetchByCoords(double lat, double lon) async {
    final currentUrl = Uri.parse(
        'https://api.openweathermap.org/data/2.5/weather'
            '?lat=$lat&lon=$lon&appid=$_weatherApiKey&units=metric');
    final forecastUrl = Uri.parse(
        'https://api.openweathermap.org/data/2.5/forecast'
            '?lat=$lat&lon=$lon&appid=$_weatherApiKey&units=metric&cnt=40');

    return _parseResponse(currentUrl, forecastUrl);
  }

  static Future<WeatherData> _parseResponse(
      Uri currentUrl, Uri forecastUrl) async {
    final responses = await Future.wait([
      http.get(currentUrl),
      http.get(forecastUrl),
    ]);

    if (responses[0].statusCode == 401) {
      throw Exception(
          'API কী সঠিক নয়। weather_service.dart ফাইলে আপনার OpenWeatherMap API কী দিন।');
    }
    if (responses[0].statusCode == 404) {
      throw Exception('শহরটি খুঁজে পাওয়া যায়নি।');
    }
    if (responses[0].statusCode != 200) {
      throw Exception('আবহাওয়া তথ্য পাওয়া যায়নি। (${responses[0].statusCode})');
    }

    final current = jsonDecode(responses[0].body);
    final forecastData = jsonDecode(responses[1].body);

    final tempC = (current['main']['temp'] as num).toDouble();
    final feelsLike = (current['main']['feels_like'] as num).toDouble();
    final wind = (current['wind']['speed'] as num).toDouble();
    final humidity = current['main']['humidity'] as int;
    final desc = current['weather'][0]['description'].toString();
    final rainMm = current['rain'] != null
        ? (current['rain']['1h'] as num?)?.toDouble()
        : null;

    final Map<String, List<dynamic>> byDay = {};
    for (final item in forecastData['list']) {
      final date = item['dt_txt'].toString().substring(0, 10);
      byDay.putIfAbsent(date, () => []).add(item);
    }

    final forecast = byDay.entries.take(5).map((entry) {
      final items = entry.value;
      final temps = items.map((i) => (i['main']['temp'] as num).toDouble());
      final winds = items.map((i) => (i['wind']['speed'] as num).toDouble());
      final rains = items.map((i) => i['rain'] != null
          ? (i['rain']['3h'] as num?)?.toDouble() ?? 0.0
          : 0.0);
      final d = items.last['weather'][0]['description'].toString();
      return ForecastDay(
        date: entry.key,
        minTemp: temps.reduce((a, b) => a < b ? a : b),
        maxTemp: temps.reduce((a, b) => a > b ? a : b),
        windSpeed: winds.reduce((a, b) => a > b ? a : b),
        rainMm: rains.reduce((a, b) => a + b),
        description: d,
      );
    }).toList();

    return WeatherData(
      cityName: current['name'].toString(),
      tempC: tempC,
      feelsLikeC: feelsLike,
      windSpeed: wind,
      humidity: humidity,
      description: desc,
      rainMm: rainMm,
      forecast: forecast,
    );
  }

  static Future<String> describeInBangla(WeatherData data) async {
    final forecastText = data.forecast
        .map((d) =>
    '${d.date}: সর্বনিম্ন ${d.minTemp.toStringAsFixed(1)}°C, সর্বোচ্চ ${d.maxTemp.toStringAsFixed(1)}°C, '
        'বাতাস ${d.windSpeed.toStringAsFixed(1)} m/s, ${d.description}')
        .join('\n');

    final prompt =
    '''নিচের আবহাওয়া তথ্য বাংলায় সংক্ষিপ্তভাবে বর্ণনা করো এবং প্রয়োজনীয় সতর্কতা দাও:

শহর: ${data.cityName}
তাপমাত্রা: ${data.tempC.toStringAsFixed(1)}°C (অনুভূতি: ${data.feelsLikeC.toStringAsFixed(1)}°C)
আর্দ্রতা: ${data.humidity}%
বাতাসের গতি: ${data.windSpeed.toStringAsFixed(1)} m/s
বৃষ্টি (গত ১ ঘণ্টা): ${data.rainMm?.toStringAsFixed(1) ?? '0'}mm
আবহাওয়া: ${data.description}

৫ দিনের পূর্বাভাস:
$forecastText

নিয়মাবলী:
- সম্পূর্ণ বাংলায় লেখো
- কোনো * বা বুলেট পয়েন্ট ব্যবহার করবে না, শুধু সংখ্যা ব্যবহার করতে পারো
- তাপমাত্রা ৩৮°C বা বেশি হলে তাপপ্রবাহ সতর্কতা দাও
- বাতাস ১৫ m/s বা বেশি হলে ঝড়ের সতর্কতা দাও
- সংক্ষিপ্ত রাখো, ২০০ শব্দের মধ্যে''';

    return await GroqService.chat(prompt, []);
  }
}