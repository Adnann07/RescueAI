import 'package:http/http.dart' as http;
import 'dart:convert';

class GroqService {
  // ⚠️ Replace with your actual Groq API key
  const String groqApiKey = String.fromEnvironment('GROQ_API_KEY', defaultValue: '');


  static const String _systemPrompt =
  '''তুমি একজন দুর্যোগ ও প্রাথমিক চিকিৎসা বিশেষজ্ঞ সহকারী। বাংলাদেশ ও বিশ্বের দুর্যোগ এবং চিকিৎসা জরুরি অবস্থা সম্পর্কে সাহায্য করো।

তুমি যা নিয়ে কথা বলতে পারবে:
- বন্যা, ঘূর্ণিঝড়, ভূমিকম্প, খরা, সুনামি, ভূমিধস
- দুর্যোগের আগে, চলাকালীন এবং পরে করণীয়
- প্রাথমিক চিকিৎসা: রক্তপাত বন্ধ, হাড় ভাঙা, পোড়া, ডুবে যাওয়া, সাপের কামড়, শ্বাসরোধ ইত্যাদি
- নিকটবর্তী হাসপাতাল ও জরুরি নম্বর সম্পর্কে তথ্য
- বাংলাদেশের গুরুত্বপূর্ণ হাসপাতাল নম্বর: ঢাকা মেডিকেল: 02-55165001, চট্টগ্রাম মেডিকেল: 031-630953, রাজশাহী মেডিকেল: 0721-772150

ফরম্যাটিং নিয়ম (অবশ্যই মানতে হবে):
- কখনো * চিহ্ন বা বুলেট পয়েন্ট ব্যবহার করবে না
- প্রয়োজনে শুধু সংখ্যা দিয়ে তালিকা করো যেমন: ১. ২. ৩.
- উত্তর সংক্ষিপ্ত, স্পষ্ট এবং সহজবোধ্য রাখো
- সবসময় বাংলায় উত্তর দাও
- জরুরি পরিস্থিতিতে ৯৯৯ বা ১০৯০ নম্বরে ফোন করার পরামর্শ দাও
- দুর্যোগ বা চিকিৎসা সম্পর্কিত না হলে ভদ্রভাবে জানাও''';

  /// Parses retry-after from Groq 429 response
  /// Returns a human-friendly Bangla wait message
  static String _parseRateLimitMessage(String responseBody) {
    try {
      final data = jsonDecode(responseBody);
      final message = data['error']?['message']?.toString() ?? '';

      // Groq returns something like:
      // "Rate limit reached... Please try again in 2m30s"
      // or "Please try again in 45s"
      final RegExp timeRegex = RegExp(r'try again in ([\d]+m)?([\d]+\.?[\d]*s)?');
      final match = timeRegex.firstMatch(message);

      if (match != null) {
        final minutes = match.group(1); // e.g. "2m"
        final seconds = match.group(2); // e.g. "30s" or "45.5s"

        String waitText = '';

        if (minutes != null) {
          final m = minutes.replaceAll('m', '');
          waitText += '$m মিনিট';
        }

        if (seconds != null) {
          final s = double.tryParse(seconds.replaceAll('s', ''))?.ceil() ?? 0;
          if (s > 0) {
            if (waitText.isNotEmpty) waitText += ' ';
            waitText += '$s সেকেন্ড';
          }
        }

        if (waitText.isNotEmpty) {
          return 'অনুগ্রহ করে $waitText পরে আবার চেষ্টা করুন।';
        }
      }
    } catch (_) {}

    // Fallback if parsing fails
    return 'অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।';
  }

  /// Transcribes audio using Groq Whisper
  static Future<String> transcribeAudio(String filePath) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('https://api.groq.com/openai/v1/audio/transcriptions'),
    )
      ..headers['Authorization'] = 'Bearer $apiKey'
      ..fields['model'] = 'whisper-large-v3'
      ..fields['language'] = 'bn'
      ..fields['response_format'] = 'text'
      ..files.add(await http.MultipartFile.fromPath('file', filePath));

    final streamed = await request.send();
    final response = await http.Response.fromStream(streamed);

    if (response.statusCode == 200) return response.body.trim();

    if (response.statusCode == 429) {
      final waitMsg = _parseRateLimitMessage(response.body);
      throw RateLimitException('ব্যবহারের সীমা পূর্ণ হয়েছে। $waitMsg');
    }

    throw Exception('Whisper error ${response.statusCode}: ${response.body}');
  }

  /// Sends message to LLaMA and returns reply
  static Future<String> chat(
      String message, List<Map<String, String>> history) async {
    final response = await http.post(
      Uri.parse('https://api.groq.com/openai/v1/chat/completions'),
      headers: {
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'model': 'llama-3.3-70b-versatile',
        'max_tokens': 500,
        'messages': [
          {'role': 'system', 'content': _systemPrompt},
          ...history,
          {'role': 'user', 'content': message},
        ],
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return data['choices'][0]['message']['content'].toString().trim();
    }

    if (response.statusCode == 429) {
      final waitMsg = _parseRateLimitMessage(response.body);
      throw RateLimitException('ব্যবহারের সীমা পূর্ণ হয়েছে। $waitMsg');
    }

    throw Exception('LLaMA error ${response.statusCode}: ${response.body}');
  }
}

/// Custom exception for rate limiting
class RateLimitException implements Exception {
  final String message;
  RateLimitException(this.message);

  @override
  String toString() => message;
}