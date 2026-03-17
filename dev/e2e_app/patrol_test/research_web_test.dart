/// Example patrol web test demonstrating dart2js static build testing.
///
/// Build: patrol build web --target patrol_test/research_web_test.dart --profile -O 1 --source-maps
/// Serve: python3 -m http.server 8080 --directory build/web
/// Run:   patrol test --device web --web-base-url=http://localhost:8080
library;

import 'package:e2e_app/broken_page.dart';
import 'package:flutter/material.dart';

import 'common.dart';

class WebTestApp extends StatefulWidget {
  const WebTestApp({super.key});

  @override
  State<WebTestApp> createState() => _WebTestAppState();
}

class _WebTestAppState extends State<WebTestApp> {
  var _counter = 0;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      routes: {
        '/': (_) => _HomePage(
              counter: _counter,
              onIncrement: () => setState(() => _counter++),
            ),
        '/broken': (_) => const BrokenPage(),
      },
    );
  }
}

class _HomePage extends StatelessWidget {
  const _HomePage({
    required this.counter,
    required this.onIncrement,
  });

  final int counter;
  final VoidCallback onIncrement;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patrol dart2js Test')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Counter value:'),
            Text(
              '$counter',
              key: const Key('counterText'),
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('goToBrokenPage'),
              onPressed: () => Navigator.of(context).pushNamed('/broken'),
              child: const Text('Go to broken page'),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: onIncrement,
        child: const Icon(Icons.add),
      ),
    );
  }
}

void main() {
  // Passing test: basic widget interaction
  patrol(
    'counter increments on FAB tap',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      expect($(#counterText).text, '0');
      await $(FloatingActionButton).tap();
      expect($(#counterText).text, '1');
      await $(FloatingActionButton).tap();
      expect($(#counterText).text, '2');
    },
  );

  // Failing test: widget error caught as fatal in profile mode
  // Demonstrates: red error widget screenshot, deobfuscated stack trace,
  // console timeline showing when the crash occurred
  patrol(
    'app crashes when broken widget renders',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      await $(#goToBrokenPage).tap();
      await $.pumpAndSettle();

      // Tapping this triggers _CrashingWidget which throws RangeError in build()
      // In profile mode, this is fatal and fails the test immediately
      await $(#triggerErrorButton).tap();
      await $.pumpAndSettle();
    },
  );

  // Failing test: assertion failure with readable error
  // Demonstrates: "Expected: '42' Actual: '1'" in error banner
  patrol(
    'intentional failure - counter shows wrong value',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      await $(FloatingActionButton).tap();
      expect($(#counterText).text, '1');
      expect($(#counterText).text, '42'); // intentional failure
    },
  );
}
