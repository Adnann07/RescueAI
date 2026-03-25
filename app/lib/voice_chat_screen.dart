import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_sound/flutter_sound.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:path_provider/path_provider.dart';
import 'groq_service.dart';
import 'chat_message.dart';

class VoiceChatScreen extends StatefulWidget {
  const VoiceChatScreen({super.key});

  @override
  State<VoiceChatScreen> createState() => _VoiceChatScreenState();
}

class _VoiceChatScreenState extends State<VoiceChatScreen>
    with SingleTickerProviderStateMixin {
  final FlutterSoundRecorder _recorder = FlutterSoundRecorder();
  final FlutterTts _tts = FlutterTts();
  final ScrollController _scrollController = ScrollController();

  VoiceState _state = VoiceState.idle;
  bool _recorderReady = false;
  final List<ChatMessage> _messages = [];
  final List<Map<String, String>> _history = [];
  String _statusText = 'মাইক বাটন চেপে ধরুন এবং কথা বলুন';
  String? _recordingPath;

  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _initRecorder();
    _initTts();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _addBotMessage(
        'আসসালামু আলাইকুম! আমি দুর্যোগ সহায়তা AI। বন্যা, ঘূর্ণিঝড়, ভূমিকম্প, প্রাথমিক চিকিৎসা সহ যেকোনো দুর্যোগ বিষয়ে প্রশ্ন করুন।');
  }

  Future<void> _initRecorder() async {
    final status = await Permission.microphone.request();
    if (status.isGranted) {
      await _recorder.openRecorder();
      await _recorder.setSubscriptionDuration(const Duration(milliseconds: 100));
      setState(() => _recorderReady = true);
    }
  }

  Future<void> _initTts() async {
    await _tts.setLanguage('bn-BD');
    await _tts.setSpeechRate(0.5);
    await _tts.setVolume(1.0);
    _tts.setCompletionHandler(() {
      if (mounted) {
        setState(() {
          _state = VoiceState.idle;
          _statusText = 'মাইক বাটন চেপে ধরুন এবং কথা বলুন';
        });
      }
    });
  }

  void _addBotMessage(String text) {
    setState(() => _messages.add(ChatMessage(text: text, isUser: false)));
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _startRecording() async {
    if (!_recorderReady) {
      final status = await Permission.microphone.request();
      if (!status.isGranted) return;
      await _recorder.openRecorder();
      setState(() => _recorderReady = true);
    }

    HapticFeedback.mediumImpact();
    final dir = await getTemporaryDirectory();
    _recordingPath =
    '${dir.path}/voice_${DateTime.now().millisecondsSinceEpoch}.wav';

    await _recorder.startRecorder(
      toFile: _recordingPath,
      codec: Codec.pcm16WAV,
    );

    setState(() {
      _state = VoiceState.recording;
      _statusText = 'রেকর্ড হচ্ছে... ছেড়ে দিন';
    });
  }

  Future<void> _stopAndProcess() async {
    if (_state != VoiceState.recording) return;
    HapticFeedback.lightImpact();

    final path = await _recorder.stopRecorder();
    final filePath = path ?? _recordingPath;

    if (filePath == null) {
      setState(() {
        _state = VoiceState.idle;
        _statusText = 'রেকর্ড করা যায়নি, আবার চেষ্টা করুন';
      });
      return;
    }

    setState(() {
      _state = VoiceState.processing;
      _statusText = 'কথা বোঝা হচ্ছে...';
    });

    try {
      final file = File(filePath);
      if (!await file.exists() || await file.length() < 1000) {
        setState(() {
          _state = VoiceState.idle;
          _statusText = 'কিছু শোনা যায়নি, আবার চেষ্টা করুন';
        });
        return;
      }

      final transcription = await GroqService.transcribeAudio(filePath);

      if (transcription.isEmpty) {
        setState(() {
          _state = VoiceState.idle;
          _statusText = 'কিছু শোনা যায়নি, আবার চেষ্টা করুন';
        });
        return;
      }

      _history.add({'role': 'user', 'content': transcription});

      setState(() => _statusText = 'উত্তর তৈরি হচ্ছে...');
      final reply = await GroqService.chat(transcription, _history);
      _history.add({'role': 'assistant', 'content': reply});

      _addBotMessage(reply);

      setState(() {
        _state = VoiceState.speaking;
        _statusText = 'উত্তর বলা হচ্ছে...';
      });
      await _tts.speak(reply);

      if (await file.exists()) await file.delete();
    } on RateLimitException catch (e) {
      debugPrint('Rate limit: $e');
      setState(() {
        _state = VoiceState.idle;
        _statusText = 'সীমা পূর্ণ হয়েছে';
      });
      _showRateLimitBanner(e.message);
    } catch (e) {
      debugPrint('Error: $e');
      setState(() {
        _state = VoiceState.idle;
        _statusText = 'সমস্যা হয়েছে, আবার চেষ্টা করুন';
      });
      _addBotMessage('দুঃখিত, একটি সমস্যা হয়েছে।');
    }
  }

  void _showRateLimitBanner(String message) {
    ScaffoldMessenger.of(context).showMaterialBanner(
      MaterialBanner(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        backgroundColor: const Color(0xFF7B1FA2),
        leading: const Icon(Icons.timer_outlined, color: Colors.white),
        content: Text(
          message,
          style: const TextStyle(color: Colors.white, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () =>
                ScaffoldMessenger.of(context).hideCurrentMaterialBanner(),
            child: const Text('ঠিক আছে',
                style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
    Future.delayed(const Duration(seconds: 15), () {
      if (mounted) {
        ScaffoldMessenger.of(context).hideCurrentMaterialBanner();
        setState(() => _statusText = 'মাইক বাটন চেপে ধরুন এবং কথা বলুন');
      }
    });
  }

  Future<void> _stopSpeaking() async {
    await _tts.stop();
    setState(() {
      _state = VoiceState.idle;
      _statusText = 'মাইক বাটন চেপে ধরুন এবং কথা বলুন';
    });
  }

  @override
  void dispose() {
    _recorder.closeRecorder();
    _tts.stop();
    _pulseController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Color get _stateColor {
    switch (_state) {
      case VoiceState.recording:
        return const Color(0xFFD32F2F);
      case VoiceState.processing:
        return const Color(0xFFFF8F00);
      case VoiceState.speaking:
        return const Color(0xFF2E7D32);
      default:
        return const Color(0xFF1565C0);
    }
  }

  IconData get _stateIcon {
    switch (_state) {
      case VoiceState.recording:
        return Icons.stop_rounded;
      case VoiceState.processing:
        return Icons.hourglass_top_rounded;
      case VoiceState.speaking:
        return Icons.volume_up_rounded;
      default:
        return Icons.mic_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Row(
          children: [
            // ── LOGO: Replace the Container below with your asset logo ──
            // Option A — Image asset (recommended):
            //   Image.asset('assets/logo.png', width: 32, height: 32)
            // Option B — Keep icon placeholder until you add the asset:
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: const Color(0xFFD32F2F).withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.crisis_alert,
                  color: Color(0xFFD32F2F), size: 20),
            ),
            const SizedBox(width: 10),
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('দুর্যোগ সহায়তা AI',
                    style: TextStyle(
                        color: Color(0xFF1A1A2E),
                        fontSize: 16,
                        fontWeight: FontWeight.bold)),
                Text('Disaster Assistant',
                    style: TextStyle(color: Colors.grey, fontSize: 11)),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.delete_outline, color: Colors.grey.shade400),
            onPressed: () {
              setState(() {
                _messages.clear();
                _history.clear();
              });
              _addBotMessage('নতুন কথোপকথন শুরু হয়েছে। কীভাবে সাহায্য করতে পারি?');
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Emergency banner
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 16),
            color: const Color(0xFFD32F2F).withOpacity(0.08),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.phone, color: Color(0xFFD32F2F), size: 14),
                SizedBox(width: 6),
                Text('জরুরি সেবা: ৯৯৯ • দুর্যোগ: ১০৯০',
                    style: TextStyle(
                        color: Color(0xFFD32F2F),
                        fontSize: 12,
                        fontWeight: FontWeight.w500)),
              ],
            ),
          ),
          // Chat area
          Expanded(
            child: _messages.isEmpty
                ? Center(
              child: Text('কথা বলুন, AI উত্তর দেবে',
                  style: TextStyle(color: Colors.grey.shade400, fontSize: 14)),
            )
                : ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, i) => _buildBubble(_messages[i]),
            ),
          ),
          _buildVoiceControl(),
        ],
      ),
    );
  }

  Widget _buildBubble(ChatMessage msg) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: const Color(0xFFD32F2F).withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.crisis_alert,
                color: Color(0xFFD32F2F), size: 16),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(16),
                  topRight: Radius.circular(16),
                  bottomLeft: Radius.circular(4),
                  bottomRight: Radius.circular(16),
                ),
                border: Border.all(color: Colors.grey.shade200),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.04),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Text(msg.text,
                  style: const TextStyle(
                      color: Color(0xFF1A1A2E), fontSize: 15, height: 1.4)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVoiceControl() {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey.shade200)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        children: [
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 300),
            child: Text(_statusText,
                key: ValueKey(_statusText),
                style: TextStyle(
                    color: _stateColor,
                    fontSize: 13,
                    fontWeight: FontWeight.w500),
                textAlign: TextAlign.center),
          ),
          const SizedBox(height: 20),
          GestureDetector(
            onLongPressStart: (_) {
              if (_state == VoiceState.idle) _startRecording();
            },
            onLongPressEnd: (_) {
              if (_state == VoiceState.recording) _stopAndProcess();
            },
            onTap: () {
              if (_state == VoiceState.speaking) _stopSpeaking();
            },
            child: AnimatedBuilder(
              animation: _pulseController,
              builder: (context, _) {
                final scale = _state == VoiceState.recording
                    ? _pulseAnimation.value
                    : 1.0;
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _stateColor,
                      boxShadow: [
                        BoxShadow(
                          color: _stateColor.withOpacity(0.3),
                          blurRadius: _state == VoiceState.recording ? 24 : 12,
                          spreadRadius: _state == VoiceState.recording ? 4 : 0,
                        ),
                      ],
                    ),
                    child: _state == VoiceState.processing
                        ? const Padding(
                      padding: EdgeInsets.all(22),
                      child: CircularProgressIndicator(
                          color: Colors.white, strokeWidth: 3),
                    )
                        : Icon(_stateIcon, color: Colors.white, size: 36),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 12),
          Text(
            _state == VoiceState.speaking
                ? 'ট্যাপ করুন থামাতে'
                : 'চেপে ধরুন কথা বলতে',
            style: TextStyle(color: Colors.grey.shade400, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
