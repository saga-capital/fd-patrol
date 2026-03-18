/// Example patrol web test demonstrating dart2js static build testing.
///
/// Build: patrol build web --target patrol_test/research_web_test.dart --profile -O 1 --source-maps
/// Serve: python3 -m http.server 8080 --directory build/web
/// Run:   patrol test --device web --web-base-url=http://localhost:8080
library;

import 'package:e2e_app/broken_page.dart';
import 'package:flutter/material.dart';

import 'common.dart';

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

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
        '/': (_) => _InteractionsPage(
              counter: _counter,
              onIncrement: () => setState(() => _counter++),
            ),
        '/broken': (_) => const BrokenPage(),
      },
    );
  }
}

class _InteractionsPage extends StatefulWidget {
  const _InteractionsPage({
    required this.counter,
    required this.onIncrement,
  });

  final int counter;
  final VoidCallback onIncrement;

  @override
  State<_InteractionsPage> createState() => _InteractionsPageState();
}

class _InteractionsPageState extends State<_InteractionsPage> {
  String _longPressResult = 'not pressed';
  bool _showDelayed = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _showDelayed = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Patrol dart2js Test')),
      body: ListView(
        key: const Key('mainListView'),
        children: [
          // -- Counter --
          const Text('Counter value:'),
          Text(
            '${widget.counter}',
            key: const Key('counterText'),
            style: Theme.of(context).textTheme.headlineMedium,
          ),

          const SizedBox(height: 16),

          // -- Text input --
          const TextField(
            key: Key('textField'),
            decoration: InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'Enter some text',
            ),
          ),

          const SizedBox(height: 16),

          // -- Long press --
          GestureDetector(
            key: const Key('longPressTarget'),
            onLongPress: () => setState(() => _longPressResult = 'long pressed!'),
            child: Container(
              padding: const EdgeInsets.all(16),
              color: Colors.blue.shade100,
              child: const Text('Long press me'),
            ),
          ),
          Text(
            _longPressResult,
            key: const Key('longPressResult'),
          ),

          const SizedBox(height: 16),

          // -- Horizontal scroll --
          SizedBox(
            height: 60,
            child: ListView.builder(
              key: const Key('horizontalListView'),
              scrollDirection: Axis.horizontal,
              itemCount: 30,
              itemBuilder: (context, index) {
                if (index == 29) {
                  return Container(
                    key: const Key('horizontalScrollTarget'),
                    width: 150,
                    color: Colors.green,
                    alignment: Alignment.center,
                    child: const Text('H-End'),
                  );
                }
                return Container(
                  width: 150,
                  color: index.isEven ? Colors.grey.shade200 : Colors.grey.shade300,
                  alignment: Alignment.center,
                  child: Text('H-Item $index'),
                );
              },
            ),
          ),

          const SizedBox(height: 16),

          // -- Delayed widget (for waitUntilVisible) --
          if (_showDelayed)
            const Text(
              'I appeared after delay',
              key: Key('delayedWidget'),
            ),

          const SizedBox(height: 16),

          // -- Navigation --
          ElevatedButton(
            key: const Key('goToBrokenPage'),
            onPressed: () => Navigator.of(context).pushNamed('/broken'),
            child: const Text('Go to broken page'),
          ),

          // -- Filler items for vertical scrolling --
          for (int i = 0; i < 30; i++)
            ListTile(title: Text('List item $i')),

          // -- Vertical scroll target at bottom --
          Container(
            key: const Key('scrollTarget'),
            padding: const EdgeInsets.all(16),
            color: Colors.orange,
            child: const Text('Scroll target reached!'),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: widget.onIncrement,
        child: const Icon(Icons.add),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // -- Tap --
  patrol(
    'tap increments counter',
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

  // -- Enter text (single + double) --
  patrol(
    'enterText writes and replaces text',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      await $(#textField).enterText('Hello, Flutter!');
      expect($('Hello, Flutter!'), findsOneWidget);

      await $(#textField).enterText('Second input');
      expect($('Hello, Flutter!'), findsNothing);
      expect($('Second input'), findsOneWidget);
    },
  );

  // -- Long press --
  patrol(
    'longPress triggers callback',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      expect($(#longPressResult).text, 'not pressed');
      await $(#longPressTarget).longPress();
      expect($(#longPressResult).text, 'long pressed!');
    },
  );

  // -- Vertical scroll --
  patrol(
    'scrollTo finds widget at bottom of list',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      // scrollTarget is off-screen at the bottom
      expect($(#scrollTarget).hitTestable(), findsNothing);

      await $(#scrollTarget).scrollTo(view: $(#mainListView));
      expect($(#scrollTarget), findsOneWidget);
      expect($('Scroll target reached!'), findsOneWidget);
    },
  );

  // -- Horizontal scroll --
  patrol(
    'horizontal drag finds widget at end of list',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      // horizontalScrollTarget is off-screen to the right
      expect($(#horizontalScrollTarget).hitTestable(), findsNothing);

      await $.dragUntilExists(
        finder: $(#horizontalScrollTarget),
        view: $(#horizontalListView),
        moveStep: const Offset(-200, 0),
      );
      expect($(#horizontalScrollTarget), findsOneWidget);
      expect($('H-End'), findsOneWidget);
    },
  );

  // -- dragUntilExists --
  patrol(
    'dragUntilExists scrolls to hidden widget',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      expect($(#scrollTarget).hitTestable(), findsNothing);

      await $.dragUntilExists(
        finder: $(#scrollTarget),
        view: $(#mainListView),
        moveStep: const Offset(0, -200),
      );
      expect($(#scrollTarget), findsOneWidget);
    },
  );

  // -- waitUntilVisible --
  patrol(
    'waitUntilVisible waits for delayed widget',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      // Widget appears after ~2s delay
      await $(#delayedWidget).waitUntilVisible(timeout: const Duration(seconds: 5));
      expect($('I appeared after delay'), findsOneWidget);
    },
  );

  // -- enterText with TextEditingController (bug repro from ENTERTEXT_WEB_BUG.md) --
  patrol(
    'enterText populates TextEditingController',
    tags: ['web'],
    ($) async {
      final controller = TextEditingController();

      await $.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: TextField(
                key: const Key('emailField'),
                controller: controller,
                decoration: const InputDecoration(hintText: 'email@example.com'),
              ),
            ),
          ),
        ),
      );
      await $.tester.pump(const Duration(milliseconds: 500));

      expect($(#emailField), findsOneWidget);
      expect(controller.text, isEmpty);

      await $(#emailField).enterText('test@example.com');
      await $.tester.pump(const Duration(milliseconds: 500));

      expect(
        controller.text,
        equals('test@example.com'),
        reason: 'enterText did not populate the TextEditingController',
      );
    },
  );

  // -- Intentional failures (error reporting tests) --
  patrol(
    'app crashes when broken widget renders',
    tags: ['web'],
    ($) async {
      await $.pumpWidgetAndSettle(const WebTestApp());

      await $(#goToBrokenPage).tap();
      await $.pumpAndSettle();

      await $(#triggerErrorButton).tap();
      await $.pumpAndSettle();
    },
  );

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
