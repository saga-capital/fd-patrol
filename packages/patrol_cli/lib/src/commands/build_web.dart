import 'dart:async';

import 'package:patrol_cli/src/analytics/analytics.dart';
import 'package:patrol_cli/src/base/extensions/core.dart';
import 'package:patrol_cli/src/base/logger.dart';
import 'package:patrol_cli/src/compatibility_checker/compatibility_checker.dart';
import 'package:patrol_cli/src/crossplatform/app_options.dart';
import 'package:patrol_cli/src/dart_defines_reader.dart';
import 'package:patrol_cli/src/pubspec_reader.dart';
import 'package:patrol_cli/src/runner/patrol_command.dart';
import 'package:patrol_cli/src/test_bundler.dart';
import 'package:patrol_cli/src/test_finder.dart';
import 'package:patrol_cli/src/web/web_test_backend.dart';

class BuildWebCommand extends PatrolCommand {
  BuildWebCommand({
    required TestFinderFactory testFinderFactory,
    required TestBundler testBundler,
    required DartDefinesReader dartDefinesReader,
    required PubspecReader pubspecReader,
    required WebTestBackend webTestBackend,
    required Analytics analytics,
    required Logger logger,
    required CompatibilityChecker compatibilityChecker,
  }) : _testFinderFactory = testFinderFactory,
       _testBundler = testBundler,
       _dartDefinesReader = dartDefinesReader,
       _pubspecReader = pubspecReader,
       _webTestBackend = webTestBackend,
       _analytics = analytics,
       _logger = logger,
       _compatibilityChecker = compatibilityChecker {
    usesTargetOption();
    usesBuildModeOption();
    usesDartDefineOption();
    usesDartDefineFromFileOption();
    usesLabelOption();
    usesTagsOption();
    usesExcludeTagsOption();
    usesCheckCompatibilityOption();
    usesBuildNameOption();
    usesBuildNumberOption();
  }

  final TestFinderFactory _testFinderFactory;
  final TestBundler _testBundler;
  final DartDefinesReader _dartDefinesReader;
  final PubspecReader _pubspecReader;
  final WebTestBackend _webTestBackend;
  final CompatibilityChecker _compatibilityChecker;

  final Analytics _analytics;
  final Logger _logger;

  @override
  String get name => 'web';

  @override
  String? get docsName => 'build';

  @override
  String get description => 'Build app for integration testing on Web.';

  @override
  Future<int> run() async {
    unawaited(
      _analytics.sendCommand(
        FlutterVersion.fromCLI(flutterCommand),
        'build_web',
      ),
    );

    final config = _pubspecReader.read();
    final testDirectory = config.testDirectory;
    final testFileSuffix = config.testFileSuffix;

    if (boolArg('check-compatibility')) {
      final patrolVersion = _pubspecReader.getPatrolVersion();
      await _compatibilityChecker.checkVersionsCompatibilityForBuild(
        patrolVersion: patrolVersion,
      );
    }

    final testFinder = _testFinderFactory.create(testDirectory);

    final target = stringsArg('target');
    final targets = target.isNotEmpty
        ? testFinder.findTests(target, testFileSuffix)
        : testFinder.findAllTests(
            excludes: stringsArg('exclude').toSet(),
            testFileSuffix: testFileSuffix,
          );

    _logger.detail('Received ${targets.length} test target(s)');
    for (final t in targets) {
      _logger.detail('Received test target: $t');
    }

    final tags = stringArg('tags');
    final excludeTags = stringArg('exclude-tags');
    if (tags != null) {
      _logger.detail('Received tag(s): $tags');
    }
    if (excludeTags != null) {
      _logger.detail('Received exclude tag(s): $excludeTags');
    }
    if (boolArg('generate-bundle')) {
      _testBundler.createTestBundle(
        testDirectory,
        targets,
        tags,
        excludeTags,
        web: true,
      );
    }
    final entrypoint = _testBundler.getBundledTestFile(
      testDirectory,
      web: true,
    );

    final displayLabel = boolArg('label');

    final buildName = stringArg('build-name');
    if (buildName != null) {
      _logger.detail('Received build name: $buildName');
    }

    final buildNumber = stringArg('build-number');
    if (buildNumber != null) {
      _logger.detail('Received build number: $buildNumber');
    }

    final customDartDefines = {
      ..._dartDefinesReader.fromFile(),
      ..._dartDefinesReader.fromCli(args: stringsArg('dart-define')),
    };
    final internalDartDefines = {
      'PATROL_TEST_LABEL_ENABLED': displayLabel.toString(),
      'PATROL_TEST_DIRECTORY': config.testDirectory,
      'INTEGRATION_TEST_SHOULD_REPORT_RESULTS_TO_NATIVE': 'false',
    }.withNullsRemoved();

    final dartDefines = {...customDartDefines, ...internalDartDefines};
    _logger.detail(
      'Received ${dartDefines.length} --dart-define(s) '
      '(${customDartDefines.length} custom, ${internalDartDefines.length} internal)',
    );
    for (final dartDefine in customDartDefines.entries) {
      _logger.detail('Received custom --dart-define: ${dartDefine.key}');
    }
    for (final dartDefine in internalDartDefines.entries) {
      _logger.detail(
        'Received internal --dart-define: ${dartDefine.key}=${dartDefine.value}',
      );
    }

    final dartDefineFromFilePaths = stringsArg('dart-define-from-file');

    final flutterOpts = FlutterAppOptions(
      command: flutterCommand,
      target: entrypoint.path,
      flavor: null,
      buildMode: buildMode,
      dartDefines: dartDefines,
      dartDefineFromFilePaths: dartDefineFromFilePaths,
      buildName: buildName,
      buildNumber: buildNumber,
    );

    final optimizationLevel = stringArg('optimization-level');
    final sourceMaps = argResults!.wasParsed('source-maps')
        ? boolArg('source-maps')
        : null;

    final webOpts = WebAppOptions(
      flutter: flutterOpts,
      optimizationLevel: optimizationLevel,
      sourceMaps: sourceMaps,
    );

    try {
      await _webTestBackend.build(webOpts);
      _logger.info('build/web/ (web app)');
    } catch (err, st) {
      _logger
        ..err('$err')
        ..detail('$st')
        ..err(defaultFailureMessage);
      rethrow;
    }

    return 0;
  }
}
