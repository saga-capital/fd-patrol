import 'package:flutter/material.dart';

/// A page that triggers real Flutter errors.
class BrokenPage extends StatefulWidget {
  const BrokenPage({super.key});

  @override
  State<BrokenPage> createState() => _BrokenPageState();
}

class _BrokenPageState extends State<BrokenPage> {
  bool _showBrokenWidget = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Broken Page')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('This page triggers errors when you tap the button'),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('triggerErrorButton'),
              onPressed: () => setState(() => _showBrokenWidget = true),
              child: const Text('Trigger broken widget'),
            ),
            const SizedBox(height: 16),
            if (_showBrokenWidget) const _CrashingWidget(),
          ],
        ),
      ),
    );
  }
}

/// Widget that throws during build — this ALWAYS fires FlutterError.onError.
class _CrashingWidget extends StatelessWidget {
  const _CrashingWidget();

  @override
  Widget build(BuildContext context) {
    // Simulate a real-world bug: accessing data that doesn't exist
    final List<String> items = [];
    final firstItem = items[0]; // RangeError: index out of range
    return Text(firstItem);
  }
}
