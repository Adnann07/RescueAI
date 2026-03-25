import 'package:flutter/material.dart';
import 'voice_chat_screen.dart';
import 'weather_screen.dart';
import 'river_level_page.dart';
import 'rescur_screen.dart'; // ← NEW

void main() {
  runApp(const DisasterApp());
}

class DisasterApp extends StatelessWidget {
  const DisasterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'দুর্যোগ সহায়তা',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFD32F2F),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const MainNavigation(),
    );
  }
}

class MainNavigation extends StatefulWidget {
  const MainNavigation({super.key});

  @override
  State<MainNavigation> createState() => _MainNavigationState();
}

class _MainNavigationState extends State<MainNavigation> {
  int _currentIndex = 0;

  final List<Widget> _pages = const [
    VoiceChatScreen(),
    WeatherScreen(),
    RiverLevelPage(),
    RescueScreen(), // ← NEW
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _pages,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: const Color(0xFF0D1117),
          border: Border(
            top: BorderSide(color: Colors.white.withOpacity(0.08)),
          ),
        ),
        child: BottomNavigationBar(
          currentIndex: _currentIndex,
          onTap: (i) => setState(() => _currentIndex = i),
          backgroundColor: Colors.transparent,
          elevation: 0,
          type: BottomNavigationBarType.fixed, // required for 4 tabs
          selectedItemColor: const Color(0xFFEF4444),
          unselectedItemColor: Colors.white30,
          selectedLabelStyle: const TextStyle(fontSize: 11),
          unselectedLabelStyle: const TextStyle(fontSize: 11),
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.mic_rounded),
              label: 'AI সহায়তা',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.cloud_rounded),
              label: 'আবহাওয়া',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.water_rounded),
              label: 'নদীর স্তর',
            ),
            BottomNavigationBarItem( // ← NEW
              icon: Icon(Icons.emergency_rounded),
              label: 'রেসকিউ',
            ),
          ],
        ),
      ),
    );
  }
}