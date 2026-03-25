
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class RiverLevelPage extends StatefulWidget {
  const RiverLevelPage({super.key});

  @override
  State<RiverLevelPage> createState() => _RiverLevelPageState();
}

class _RiverLevelPageState extends State<RiverLevelPage> {
  List<Map<String, dynamic>> riverData = [];
  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    fetchRiverLevels();
  }

  Future<void> fetchRiverLevels() async {
    setState(() => isLoading = true);

    try {
      final response = await http.get(
        Uri.parse("https://api3.ffwc.gov.bd/data_load/observed/"),
        headers: {'User-Agent': 'RiverTourismApp/1.0'},
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        print("✅ RAW DATA: ${data.length} records");

        List<Map<String, dynamic>> parsedData = [];

        for (var item in data.take(30)) { // Top 30 only
          final station = {
            'station_name': item['name'] ?? 'N/A',
            'river_name': item['river'] ?? 'N/A',
            'water_level': double.tryParse(item['waterlevel']?.toString() ?? '0') ?? 0.0,
            'danger_level': double.tryParse(item['dangerlevel']?.toString() ?? '0') ?? 0.0,
            'last_update': item['wl_date']?.toString() ?? '',
          };

          // Filter valid data only
          if (station['water_level'] > 0 && station['danger_level'] > 0) {
            parsedData.add(station);
          }
        }

        print("✅ PARSED ${parsedData.length} VALID records");

        setState(() {
          riverData = parsedData;
          isLoading = false;
        });
      }
    } catch (e) {
      print("❌ $e");
      setState(() {
        riverData = _getFallbackRiverData();
        isLoading = false;
      });
    }
  }

  List<Map<String, dynamic>> _getFallbackRiverData() {
    return [
      {'station_name': 'হরিণগাছা', 'river_name': 'পদ্মা নদী', 'water_level': 8.45, 'danger_level': 9.75, 'last_update': '23 Nov 2025'},
      {'station_name': 'দোহাটোলা', 'river_name': 'তিস্তা নদী', 'water_level': 6.82, 'danger_level': 8.45, 'last_update': '23 Nov 2025'},
      {'station_name': 'দাউদকান্দি', 'river_name': 'মেঘনা নদী', 'water_level': 4.23, 'danger_level': 5.92, 'last_update': '23 Nov 2025'},
    ];
  }

  String getStatus(double wl, double danger) {
    if (wl >= danger) return "🚨 বিপদসীমা অতিক্রম";
    if (wl >= danger * 0.95) return "⚠️ বিপদের কাছে";
    if (wl >= danger * 0.85) return "🟡 সতর্কতা";
    return "✅ স্বাভাবিক";
  }

  Color getStatusColor(String status) {
    if (status.contains("বিপদসীমা")) return Colors.red;
    if (status.contains("বিপদের")) return Colors.orange;
    if (status.contains("সতর্কতা")) return Colors.amber;
    return Colors.green;
  }

  double getProgress(double current, double danger) => danger > 0 ? (current / danger).clamp(0.0, 1.0) : 0.0;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text("নদীর স্তর রিয়েল-টাইম"),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: fetchRiverLevels),
        ],
      ),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
        onRefresh: fetchRiverLevels,
        child: ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: riverData.length,
          itemBuilder: (context, index) {
            final item = riverData[index];
            final stationName = item['station_name']?.toString() ?? 'N/A';
            final river = item['river_name']?.toString() ?? 'N/A';
            final waterLevel = (item['water_level'] as num).toDouble();
            final dangerLevel = (item['danger_level'] as num).toDouble();
            final status = getStatus(waterLevel, dangerLevel);
            final statusColor = getStatusColor(status);
            final progress = getProgress(waterLevel, dangerLevel);

            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Icon(Icons.water, color: colorScheme.primary, size: 28),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(river, style: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                              Text(stationName, style: textTheme.bodyMedium?.copyWith(color: colorScheme.onSurfaceVariant)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    LinearProgressIndicator(
                      value: progress,
                      backgroundColor: Colors.grey[200],
                      valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                      minHeight: 8,
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text("বর্তমান", style: textTheme.bodyMedium),
                              Text("${waterLevel.toStringAsFixed(1)} মি",
                                  style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: colorScheme.primary)),
                            ],
                          ),
                        ),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text("বিপদসীমা", style: textTheme.bodyMedium),
                              Text("${dangerLevel.toStringAsFixed(1)} মি",
                                  style: textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: Colors.red)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: statusColor, width: 2),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.circle, size: 16, color: statusColor),
                          const SizedBox(width: 8),
                          Text(status, style: textTheme.bodyMedium?.copyWith(color: statusColor, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
