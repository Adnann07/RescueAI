class ChatMessage {
  final String text;
  final bool isUser;

  ChatMessage({required this.text, required this.isUser});
}

enum VoiceState { idle, recording, processing, speaking }