// rescue_screen.dart
// CrisisMap BD — Rescuer Tracking Screen (Light Mode)

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

const String _kServerUrl     = 'https://hazard-aid-production.up.railway.app';
const String _kTeamCode      = 'BDRCS2026';
const Duration _kGpsInterval = Duration(seconds: 5);

enum RescuerStatus { available, on_mission, unreachable }

extension RescuerStatusX on RescuerStatus {
  String get key {
    switch (this) {
      case RescuerStatus.available:   return 'available';
      case RescuerStatus.on_mission:  return 'on_mission';
      case RescuerStatus.unreachable: return 'unreachable';
    }
  }

  String get label {
    switch (this) {
      case RescuerStatus.available:   return 'সক্রিয় (Available)';
      case RescuerStatus.on_mission:  return 'মিশনে (On Mission)';
      case RescuerStatus.unreachable: return 'যোগাযোগ নেই (Unreachable)';
    }
  }

  Color get color {
    switch (this) {
      case RescuerStatus.available:   return const Color(0xFF16A34A);
      case RescuerStatus.on_mission:  return const Color(0xFFD97706);
      case RescuerStatus.unreachable: return const Color(0xFF6B7280);
    }
  }

  IconData get icon {
    switch (this) {
      case RescuerStatus.available:   return Icons.check_circle_rounded;
      case RescuerStatus.on_mission:  return Icons.directions_run_rounded;
      case RescuerStatus.unreachable: return Icons.signal_wifi_off_rounded;
    }
  }
}

class RescueScreen extends StatefulWidget {
  const RescueScreen({super.key});

  @override
  State<RescueScreen> createState() => _RescueScreenState();
}

class _RescueScreenState extends State<RescueScreen> {
  bool            _joined      = false;
  bool            _connecting  = false;
  String          _error       = '';
  String          _name        = '';
  String          _team        = '';
  RescuerStatus   _status      = RescuerStatus.available;

  IO.Socket?      _socket;
  Timer?          _gpsTimer;
  Position?       _lastPos;
  String          _connLabel   = 'সংযুক্ত নয়';
  String          _gpsLabel    = 'GPS অপেক্ষা করছে…';
  int             _onlineCount = 0;

  final _nameCtrl = TextEditingController();
  final _teamCtrl = TextEditingController();

  @override
  void dispose() {
    _gpsTimer?.cancel();
    _socket?.dispose();
    _nameCtrl.dispose();
    _teamCtrl.dispose();
    super.dispose();
  }

  void _connect() {
    final timeout = Timer(const Duration(seconds: 12), () {
      if (!_joined && mounted) {
        setState(() {
          _connecting = false;
          _error = 'সংযোগ ব্যর্থ (timeout)। আবার চেষ্টা করুন।';
        });
        _socket?.dispose();
      }
    });

    _socket = IO.io(_kServerUrl, <String, dynamic>{
      'transports'  : ['websocket', 'polling'],
      'autoConnect' : true,
      'forceNew'    : true,
    });

    _socket!.onConnect((_) {
      if (mounted) setState(() => _connLabel = '🟢 সংযুক্ত');
      Future.delayed(const Duration(milliseconds: 500), () {
        if (_socket == null) return;
        _socket!.emit('rescuer:join', {
          'name':   _name,
          'team':   _team,
          'code':   _kTeamCode,
          'status': _status.key,
          'lat':    _lastPos?.latitude  ?? 23.7,
          'lng':    _lastPos?.longitude ?? 90.35,
        });
      });
    });

    _socket!.onDisconnect((_) {
      if (mounted) setState(() => _connLabel = '🟡 পুনঃসংযোগ হচ্ছে…');
    });

    _socket!.onConnectError((err) {
      if (mounted) {
        setState(() {
          _connLabel  = '🔴 সংযোগ ব্যর্থ';
          _connecting = false;
          _error      = 'Connect error: $err';
        });
        timeout.cancel();
      }
    });

    _socket!.onError((err) {
      if (mounted) {
        setState(() {
          _connecting = false;
          _error      = 'Socket error: $err';
        });
        timeout.cancel();
      }
    });

    _socket!.on('rescuer:accepted', (data) {
      timeout.cancel();
      if (mounted) {
        setState(() {
          _joined     = true;
          _connecting = false;
          _error      = '';
        });
      }
      _startGps();
    });

    _socket!.on('rescuer:rejected', (data) {
      timeout.cancel();
      if (mounted) {
        setState(() {
          _connecting = false;
          _error      = 'ভুল টিম কোড। BDRCS2026 সঠিক আছে কিনা দেখুন।';
        });
      }
      _socket!.disconnect();
    });

    _socket!.on('rescuers:list', (data) {
      if (data is List && mounted) setState(() => _onlineCount = data.length);
    });
  }

  void _sendStatus(RescuerStatus s) {
    setState(() => _status = s);
    _socket?.emit('rescuer:status', {'status': s.key});
  }

  Future<void> _startGps() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.denied ||
        perm == LocationPermission.deniedForever) {
      setState(() => _gpsLabel = '⚠ লোকেশন অনুমতি নেই');
      return;
    }

    try {
      final pos = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high);
      _sendPos(pos);
    } catch (_) {}

    _gpsTimer = Timer.periodic(_kGpsInterval, (_) async {
      try {
        final pos = await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.high);
        _sendPos(pos);
      } catch (_) {
        setState(() => _gpsLabel = '⚠ GPS সংকেত নেই');
      }
    });
  }

  void _sendPos(Position pos) {
    _socket?.emit('rescuer:move', {
      'lat': pos.latitude,
      'lng': pos.longitude,
    });
    setState(() {
      _lastPos  = pos;
      _gpsLabel = '${pos.latitude.toStringAsFixed(4)}, '
          '${pos.longitude.toStringAsFixed(4)}';
    });
  }

  void _join() {
    final n = _nameCtrl.text.trim();
    final t = _teamCtrl.text.trim();
    if (n.isEmpty) { setState(() => _error = 'আপনার নাম লিখুন'); return; }
    if (t.isEmpty) { setState(() => _error = 'টিম / ইউনিট লিখুন'); return; }
    setState(() {
      _name = n; _team = t;
      _connecting = true; _error = '';
    });
    _connect();
  }

  void _leave() {
    _gpsTimer?.cancel();
    _socket?.dispose();
    setState(() {
      _joined      = false;
      _connLabel   = 'সংযুক্ত নয়';
      _gpsLabel    = 'GPS অপেক্ষা করছে…';
      _onlineCount = 0;
      _lastPos     = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      body: _joined ? _activeScreen() : _joinScreen(),
    );
  }

  // ── JOIN SCREEN ───────────────────────────────────────────────
  Widget _joinScreen() {
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 12),

            // Header
            Row(children: [
              Container(
                width: 46, height: 46,
                decoration: BoxDecoration(
                  color: const Color(0xFFEF4444).withOpacity(.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.emergency_rounded,
                    color: Color(0xFFEF4444), size: 24),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('CrisisMap BD',
                      style: TextStyle(
                          color: Colors.grey.shade500,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: .5)),
                  const Text('রেসকিউ ট্র্যাকিং',
                      style: TextStyle(
                          color: Color(0xFF1A1A2E),
                          fontSize: 20,
                          fontWeight: FontWeight.bold)),
                ],
              ),
            ]),
            const SizedBox(height: 28),

            // Info box
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF1565C0).withOpacity(.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: const Color(0xFF1565C0).withOpacity(.15)),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.location_on_rounded,
                      color: Color(0xFF1565C0), size: 18),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'আপনার GPS লোকেশন প্রতি ৫ সেকেন্ডে কোঅর্ডিনেটর '
                          'ম্যাপে পাঠানো হবে। শুধুমাত্র টিম সদস্যরা যোগ '
                          'দিতে পারবেন।',
                      style: TextStyle(
                          color: Color(0xFF1565C0),
                          fontSize: 12,
                          height: 1.55),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            _label('আপনার নাম'),
            const SizedBox(height: 8),
            _input(_nameCtrl, 'যেমন: করিম আহমেদ', Icons.person_rounded),
            const SizedBox(height: 14),

            _label('টিম / ইউনিট'),
            const SizedBox(height: 8),
            _input(_teamCtrl, 'যেমন: BDRCS ঢাকা ইউনিট ৩', Icons.groups_rounded),
            const SizedBox(height: 24),

            if (_error.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFEF4444).withOpacity(.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: const Color(0xFFEF4444).withOpacity(.25)),
                ),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.error_outline,
                          color: Color(0xFFEF4444), size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(_error,
                            style: const TextStyle(
                                color: Color(0xFFEF4444),
                                fontSize: 12,
                                height: 1.5)),
                      ),
                    ]),
              ),
              const SizedBox(height: 16),
            ],

            SizedBox(
              width: double.infinity, height: 52,
              child: ElevatedButton(
                onPressed: _connecting ? null : _join,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFEF4444),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  elevation: 0,
                ),
                child: _connecting
                    ? const SizedBox(
                    width: 22, height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.5, color: Colors.white))
                    : const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.sensors_rounded, size: 20),
                    SizedBox(width: 8),
                    Text('রেসকিউ টিমে যোগ দিন',
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── ACTIVE SCREEN ─────────────────────────────────────────────
  Widget _activeScreen() {
    return SafeArea(
      child: Column(children: [
        // Top bar
        Container(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 12),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border(
                bottom: BorderSide(color: Colors.grey.shade200)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.04),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(children: [
            const Text('🪖', style: TextStyle(fontSize: 18)),
            const SizedBox(width: 8),
            Text(_connLabel,
                style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 12,
                    fontWeight: FontWeight.w600)),
            const Spacer(),
            if (_onlineCount > 0)
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFEF4444).withOpacity(.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text('$_onlineCount জন অনলাইন',
                    style: const TextStyle(
                        color: Color(0xFFEF4444),
                        fontSize: 11,
                        fontWeight: FontWeight.w700)),
              ),
          ]),
        ),

        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [

                // Identity card
                _card(Row(children: [
                  Container(
                    width: 48, height: 48,
                    decoration: BoxDecoration(
                      color: _status.color.withOpacity(.12),
                      shape: BoxShape.circle,
                    ),
                    child: const Center(
                        child: Text('🪖',
                            style: TextStyle(fontSize: 24))),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_name,
                            style: const TextStyle(
                                color: Color(0xFF1A1A2E),
                                fontSize: 16,
                                fontWeight: FontWeight.bold)),
                        const SizedBox(height: 3),
                        Text(_team,
                            style: TextStyle(
                                color: Colors.grey.shade500,
                                fontSize: 12)),
                      ],
                    ),
                  ),
                ])),
                const SizedBox(height: 14),

                // GPS card
                _card(Row(children: [
                  const Icon(Icons.my_location_rounded,
                      color: Color(0xFF1565C0), size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('লাইভ লোকেশন',
                            style: TextStyle(
                                color: Colors.grey.shade500,
                                fontSize: 11,
                                fontWeight: FontWeight.w600)),
                        const SizedBox(height: 3),
                        Text(_gpsLabel,
                            style: const TextStyle(
                                color: Color(0xFF1A1A2E),
                                fontSize: 12)),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1565C0).withOpacity(.08),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text('প্রতি ৫s',
                        style: TextStyle(
                            color: Color(0xFF1565C0),
                            fontSize: 10,
                            fontWeight: FontWeight.w700)),
                  ),
                ])),
                const SizedBox(height: 20),

                // Status
                _label('আপনার অবস্থা'),
                const SizedBox(height: 10),
                ...RescuerStatus.values.map(_statusTile),
                const SizedBox(height: 28),

                // Leave button
                SizedBox(
                  width: double.infinity, height: 48,
                  child: OutlinedButton(
                    onPressed: _leave,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.grey.shade600,
                      side: BorderSide(color: Colors.grey.shade300),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('টিম ছেড়ে দিন',
                        style: TextStyle(fontSize: 14)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ]),
    );
  }

  // ── Shared widgets ────────────────────────────────────────────
  Widget _card(Widget child) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: Colors.grey.shade200),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withOpacity(0.04),
          blurRadius: 6,
          offset: const Offset(0, 2),
        ),
      ],
    ),
    child: child,
  );

  Widget _statusTile(RescuerStatus s) {
    final on = _status == s;
    return GestureDetector(
      onTap: () => _sendStatus(s),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: on ? s.color.withOpacity(.08) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: on ? s.color : Colors.grey.shade200,
            width: on ? 1.5 : 1,
          ),
        ),
        child: Row(children: [
          Icon(s.icon,
              color: on ? s.color : Colors.grey.shade400, size: 20),
          const SizedBox(width: 12),
          Text(s.label,
              style: TextStyle(
                  color: on ? s.color : Colors.grey.shade600,
                  fontSize: 14,
                  fontWeight: on ? FontWeight.bold : FontWeight.normal)),
          const Spacer(),
          Icon(
            on ? Icons.radio_button_checked_rounded
                : Icons.radio_button_off_rounded,
            color: on ? s.color : Colors.grey.shade300,
            size: 18,
          ),
        ]),
      ),
    );
  }

  Widget _label(String t) => Text(t,
      style: TextStyle(
          color: Colors.grey.shade500,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: .5));

  Widget _input(TextEditingController ctrl, String hint, IconData icon) =>
      TextField(
        controller: ctrl,
        style: const TextStyle(color: Color(0xFF1A1A2E), fontSize: 14),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(color: Colors.grey.shade400, fontSize: 14),
          prefixIcon: Icon(icon, color: Colors.grey.shade400, size: 20),
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(color: Colors.grey.shade200),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(color: Colors.grey.shade200),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: const BorderSide(color: Color(0xFFEF4444)),
          ),
          contentPadding: const EdgeInsets.symmetric(
              horizontal: 14, vertical: 14),
        ),
      );
}
