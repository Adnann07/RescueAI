import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

const String _keyWeatherJson = 'cached_weather_json';
const String _keyBanglaDesc = 'cached_bangla_desc';
const String _keyTimestamp = 'cached_weather_timestamp';
const int _cacheHours = 24;

class WeatherCache {
  /// Save weather data and AI description to cache
  static Future<void> save({
    required Map<String, dynamic> weatherJson,
    required String banglaDesc,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyWeatherJson, jsonEncode(weatherJson));
    await prefs.setString(_keyBanglaDesc, banglaDesc);
    await prefs.setInt(
        _keyTimestamp, DateTime.now().millisecondsSinceEpoch);
  }

  /// Returns cached data if it exists and is less than 24 hours old
  static Future<CachedWeather?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final timestamp = prefs.getInt(_keyTimestamp);
    final weatherStr = prefs.getString(_keyWeatherJson);
    final banglaDesc = prefs.getString(_keyBanglaDesc);

    if (timestamp == null || weatherStr == null || banglaDesc == null) {
      return null;
    }

    final age = DateTime.now().millisecondsSinceEpoch - timestamp;
    final isExpired = age > _cacheHours * 60 * 60 * 1000;

    return CachedWeather(
      weatherJson: jsonDecode(weatherStr),
      banglaDesc: banglaDesc,
      cachedAt: DateTime.fromMillisecondsSinceEpoch(timestamp),
      isExpired: isExpired,
    );
  }

  /// Clear all cached data
  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyWeatherJson);
    await prefs.remove(_keyBanglaDesc);
    await prefs.remove(_keyTimestamp);
  }
}

class CachedWeather {
  final Map<String, dynamic> weatherJson;
  final String banglaDesc;
  final DateTime cachedAt;
  final bool isExpired;

  CachedWeather({
    required this.weatherJson,
    required this.banglaDesc,
    required this.cachedAt,
    required this.isExpired,
  });

  /// Human-friendly age string in Bangla
  String get ageText {
    final diff = DateTime.now().difference(cachedAt);
    if (diff.inMinutes < 60) return '${diff.inMinutes} মিনিট আগে';
    if (diff.inHours < 24) return '${diff.inHours} ঘণ্টা আগে';
    return '${diff.inDays} দিন আগে';
  }
}