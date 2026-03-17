import 'dart:async';
import 'dart:convert';
import 'dart:developer';
import 'dart:isolate';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:patrol/src/devtools_service_extensions/devtools_service_extensions.dart';
import 'package:patrol/src/global_state.dart' as global_state;
import 'package:patrol/src/platform/current.dart' as current_platform;

import 'constants.dart' as constants;

const _success = 'success';

bool get _isDevelopMode => constants.hotRestartEnabled;

void _defaultPrintLogger(String message) {
  // TODO: Use a logger instead of print
  // ignore: avoid_print
  print('PatrolBinding: $message');
}

/// Binding that enables some of Patrol's custom functionality, such as tapping
/// on WebViews during a test.
///
/// ### Reporting results of bundled tests
///
/// This binding is also responsible for reporting the results of the tests to
/// the native side of Patrol. It does so by registering a tearDown() callback
/// that is executed after each test. Inside that callback, the name of the Dart
/// test file being currently executed is retrieved.
///
/// At this point, the [PatrolAppService] is handling the gRPC `runDartTest()`
/// called by the native side.
///
/// [PatrolBinding] submits the Dart test file name that is being currently
/// executed to [PatrolAppService]. Once the name is submitted to it, that
/// pending `runDartTest()` method returns.
class PatrolBinding extends LiveTestWidgetsFlutterBinding {
  /// Creates a new [PatrolBinding].
  ///
  /// You most likely don't want to call it yourself.
  PatrolBinding(PlatformAutomator platform)
    : _serviceExtensions = DevtoolsServiceExtensions(platform) {
    setUp(() {
      if (_isDevelopMode) {
        return;
      }

      if (global_state.currentTestIndividualName == 'patrol_test_explorer') {
        return;
      }

      _currentDartTest = global_state.currentTestFullName;
    });

    tearDown(() async {
      if (_isDevelopMode) {
        // Sending results ends the test, which we don't want for Hot Restart
        return;
      }

      final testName = global_state.currentTestIndividualName;
      if (testName == 'patrol_test_explorer') {
        return;
      } else {
        logger(
          'tearDown(): count: ${_testResults.length}, results: $_testResults',
        );
      }

      final nameOfRequestedTest = await patrolAppService.testExecutionRequested;

      if (nameOfRequestedTest == _currentDartTest) {
        if (const bool.fromEnvironment('COVERAGE_ENABLED')) {
          postEvent('waitForCoverageCollection', {
            'mainIsolateId': Service.getIsolateId(Isolate.current),
          });

          final testCompleter = Completer<void>();

          registerExtension('ext.patrol.markTestCompleted', (
            method,
            parameters,
          ) async {
            testCompleter.complete();
            return ServiceExtensionResponse.result(jsonEncode({}));
          });

          await testCompleter.future;
        }

        logger(
          'finished test $_currentDartTest. Will report its status back to the native side',
        );

        final passed = global_state.isCurrentTestPassing;
        logger(
          'tearDown(): test "$testName" in group "$_currentDartTest", passed: $passed',
        );

        final details = _testResults[_currentDartTest!] is Failure
            ? (_testResults[_currentDartTest!] as Failure?)?.details
            : null;

        await patrolAppService.markDartTestAsCompleted(
          dartFileName: _currentDartTest!,
          passed: passed,
          details: details,
        );
      } else {
        logger(
          'finished test $_currentDartTest, but it was not requested, so its status will not be reported back to the native side',
        );
      }
    });
  }

  /// Returns an instance of the [PatrolBinding], creating and initializing it
  /// if necessary.
  ///
  /// This method is idempotent.
  factory PatrolBinding.ensureInitialized(PlatformAutomator platform) {
    if (_instance == null) {
      PatrolBinding(platform);
    }
    return _instance!;
  }

  @override
  bool get overrideHttpClient => false;

  @override
  bool get registerTestTextInput => false;

  /// Logger used by this binding.
  void Function(String message) logger = _defaultPrintLogger;

  /// The [PatrolAppService] used by this binding to report tests to the native
  /// side.
  ///
  /// It's only for test reporting purposes and should not be used for anything
  /// else.
  late PatrolAppService patrolAppService;

  /// The singleton instance of this object.
  ///
  /// Provides access to the features exposed by this class. The binding must be
  /// initialized before using this getter; this is typically done by calling
  /// [PatrolBinding.ensureInitialized].
  static PatrolBinding get instance => BindingBase.checkInstance(_instance);
  static PatrolBinding? _instance;

  String? _currentDartTest;

  /// Keys are the test descriptions, and values are either [_success] or a
  /// [Failure].
  final _testResults = <String, Object>{};

  final DevtoolsServiceExtensions _serviceExtensions;

  /// Temporary workaround for DevTools extension changing this value and not
  /// resetting it.
  ///
  /// See https://github.com/flutter/devtools/issues/6719
  TargetPlatform? workaroundDebugDefaultTargetPlatformOverride;

  /// Allows for gestures made with human finger to be percevied as gestures
  /// made with [WidgetTester], allowing to interact with a running test.
  ///
  /// We thought we may replace this override by setting
  /// [shouldPropagateDevicePointerEvents] to true but it doesn't work.
  ///
  /// See also:
  ///
  ///  * https://github.com/leancodepl/patrol/issues/1956
  @override
  TestBindingEventSource get pointerEventSource {
    return TestBindingEventSource.test;
  }

  @override
  void initInstances() {
    super.initInstances();
    _instance = this;

    // In profile/release mode, show a red error widget (like debug mode)
    // instead of the default gray box. This makes rendering errors visible
    // in screenshots and video recordings.
    if (_failOnRenderError) {
      ErrorWidget.builder = (FlutterErrorDetails details) {
        return Container(
          color: const Color(0xFFE53935),
          padding: const EdgeInsets.all(16),
          child: Text(
            details.exceptionAsString(),
            style: const TextStyle(
              color: Color(0xFFFFFFFF),
              fontSize: 14,
              fontWeight: FontWeight.bold,
              decoration: TextDecoration.none,
            ),
          ),
        );
      };
    }
  }

  @override
  void initServiceExtensions() {
    super.initServiceExtensions();

    logger('Register Patrol service extensions');

    registerServiceExtension(
      name: 'patrol.getNativeUITree',
      callback: _serviceExtensions.getNativeUITree,
    );
  }

  @override
  Future<void> runTest(
    Future<void> Function() testBody,
    VoidCallback invariantTester, {
    String description = '',
    @Deprecated(
      'This parameter has no effect. Use the `timeout` parameter on `testWidgets` instead. '
      'This feature was deprecated after v2.6.0-1.0.pre.',
    )
    Duration? timeout,
  }) async {
    await super.runTest(
      // If we're in develop mode, we cannot overwrite FlutterError.onError
      // will get "A test overrode FlutterError.onError" exception.
      _isDevelopMode
          ? testBody
          : () => _wrapTestBodyWithExceptionGatherer(testBody),
      invariantTester,
      description: description,
    );
    _testResults[description] ??= _success;
  }

  /// Whether Flutter rendering errors (overflow, layout issues, etc.)
  /// should fail the test immediately.
  ///
  /// Controlled via `--dart-define=PATROL_FAIL_ON_RENDER_ERROR=true`.
  /// When not set, defaults to true in profile/release mode (dart2js builds)
  /// and false in debug mode.
  static const _failOnRenderError = bool.fromEnvironment(
    'PATROL_FAIL_ON_RENDER_ERROR',
    defaultValue: !kDebugMode,
  );

  /// First Flutter rendering error caught during the current test body.
  /// Used to fail the test after pump returns, since throwing from within
  /// FlutterError.onError doesn't interrupt the rendering pipeline.
  String? _pendingRenderError;

  /// Wraps the test body with a function that gathers exceptions and reports
  /// them to the native side of Patrol.
  Future<void> _wrapTestBodyWithExceptionGatherer(
    Future<void> Function() testBody,
  ) async {
    _pendingRenderError = null;
    final previousOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (_currentDartTest case final testName?) {
        final previousDetails = switch (_testResults[testName]) {
          Failure(:final details?) => FlutterErrorDetails(exception: details),
          _ => null,
        };

        // Always include exception message + stack trace for maximum debug info.
        // details.toString() may omit the stack in profile/release mode.
        final buffer = StringBuffer()
          ..writeln(details.exceptionAsString());
        if (details.stack != null) {
          buffer.writeln(details.stack);
        }
        if (details.context != null) {
          buffer.writeln('Context: ${details.context}');
        }
        if (details.library != null) {
          buffer.writeln('Library: ${details.library}');
        }
        final detailsAsString = buffer.toString();

        _testResults[testName] = Failure(
          testName,
          '$detailsAsString${previousDetails != null ? '\n$previousDetails' : ''}',
        );

        previousOnError?.call(details);

        // Record the first render error for later — we can't throw from here
        // because FlutterError.onError runs in the rendering pipeline's error
        // zone, not in the test body's execution context.
        if (_failOnRenderError) {
          _pendingRenderError ??= detailsAsString;
        }
      }
    };

    try {
      await testBody();
    } catch (error, stackTrace) {
      // Captures TestFailure from expect(), fail(), and any other exceptions.
      // FlutterError.onError only catches Flutter rendering errors separately.
      if (_currentDartTest case final testName?) {
        final existing = _testResults[testName];
        final newDetails = '$error\n$stackTrace';
        if (existing is Failure && (existing.details?.isNotEmpty ?? false)) {
          // Append to existing FlutterError details
          _testResults[testName] = Failure(
            testName,
            '${existing.details}\n\n$newDetails',
          );
        } else {
          _testResults[testName] = Failure(testName, newDetails);
        }
      }
      rethrow;
    } finally {
      FlutterError.onError = previousOnError;
    }

    // Check for pending render errors AFTER the test body completes.
    // This catches cases where FlutterError.onError fired during pump()
    // but the error was swallowed by Flutter's error zone.
    if (_pendingRenderError != null) {
      fail(
        'Flutter rendering error (fatal in profile/release mode):\n'
        '$_pendingRenderError',
      );
    }
  }

  @override
  ViewConfiguration createViewConfigurationFor(RenderView renderView) {
    final view = renderView.flutterView;
    return TestViewConfiguration.fromView(
      size: view.physicalSize / view.devicePixelRatio,
      view: view,
    );
  }

  @override
  Widget wrapWithDefaultView(Widget rootWidget) {
    assert(
      (_currentDartTest != null) != _isDevelopMode,
      '_currentDartTest can be null if and only if Hot Restart is enabled',
    );

    const testLabelEnabled = bool.fromEnvironment('PATROL_TEST_LABEL_ENABLED');
    if (!testLabelEnabled || _isDevelopMode) {
      return super.wrapWithDefaultView(RepaintBoundary(child: rootWidget));
    } else {
      return super.wrapWithDefaultView(
        Stack(
          textDirection: TextDirection.ltr,
          children: [
            RepaintBoundary(child: rootWidget),
            // Prevents crashes when Android activity is resumed (see
            // https://github.com/leancodepl/patrol/issues/901)
            ExcludeSemantics(
              child: Builder(
                builder: (context) {
                  final view = View.of(context);
                  return Padding(
                    padding: EdgeInsets.only(
                      top: MediaQueryData.fromView(view).padding.top + 4,
                      left: 4,
                    ),
                    child: IgnorePointer(
                      child: Text(
                        _currentDartTest!,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      );
    }
  }

  @override
  void reportExceptionNoticed(FlutterErrorDetails exception) {
    // In profile/release mode, report the exception to the test framework
    // so that pumpAndSettle stops pumping and the test fails.
    // Without this, rendering errors are silently swallowed and pumpAndSettle
    // hangs forever trying to rebuild the broken widget.
    if (_failOnRenderError) {
      reportTestException(
        FlutterErrorDetails(
          exception: exception.exception,
          stack: exception.stack,
          library: exception.library,
          context: ErrorDescription(
            'Flutter rendering error (fatal in profile/release mode)',
          ),
        ),
        _currentDartTest ?? 'unknown test',
      );
    }
  }
}

/// Representing a failure includes the method name and the failure details.
class Failure {
  /// Constructor requiring all fields during initialization.
  Failure(this.methodName, this.details);

  /// The name of the test method which failed.
  final String methodName;

  /// The details of the failure such as stack trace.
  final String? details;

  /// Serializes the object to JSON.
  String toJson() {
    return json.encode(<String, String?>{
      'methodName': methodName,
      'details': details,
    });
  }

  @override
  String toString() => toJson();

  /// Decode a JSON string to create a Failure object.
  // ignore: prefer_constructors_over_static_methods
  static Failure fromJsonString(String jsonString) {
    final failure = json.decode(jsonString) as Map<String, dynamic>;
    return Failure(
      failure['methodName'] as String,
      failure['details'] as String?,
    );
  }
}
