# Web Testing Optimization: `--web-base-url`

## Problem

Every `patrol test` run on web calls `flutter run -d web-server`, which rebuilds the Flutter app from scratch. This wastes time when iterating on tests or running multiple shards in CI.

## Solution

The `--web-base-url` flag skips building and starting the Flutter web server entirely, pointing Playwright at an already-running or pre-built app.

```bash
patrol test -d web-server --web-base-url=http://localhost:8080
```

## Why This Is Safe

The Playwright-Flutter communication uses **JS interop compiled into the app**, not Flutter's debug protocol:

- Dart exposes `__patrol__getTests()` and `__patrol__runTest(name)` as JS globals
- Playwright calls them via `page.evaluate()` and exposes `__patrol__platformHandler` via `page.exposeBinding()`
- All 23 Playwright actions (tap, enterText, scroll, etc.) are pure DOM manipulation
- No VM service, no service protocol, no CDP required

## What Gets Compiled Into the Test Build

The test bundle (`test_bundle.dart`) replaces `lib/main.dart` as the entrypoint. It includes:

- `PatrolBinding` instead of `WidgetsFlutterBinding`
- `PlatformAutomator` with JS interop bridge
- Test discovery and execution infrastructure (`PatrolAppService`)
- All test file imports and group registrations
- Tag filtering parameters (currently baked in as string literals)

This is **not** a thin layer on top of the app. It's the test framework controlling the app. A regular production build will not work — it lacks the patrol JS bindings.

## What Forces a Rebuild

| Change | Rebuild needed? |
|--------|----------------|
| Test file contents changed | Yes (compiled JS differs) |
| Test file added/removed/renamed | Yes (imports change) |
| Tags/exclude-tags changed | Yes (currently baked into bundle) |
| App source code changed | Yes |
| Playwright config changed | No |
| Browser/shard/retry options changed | No |

## Building the Test App Manually

To build the test app outside of `patrol test`, you first need to generate the test bundle, then build with it as the target.

### Step 1: Generate the test bundle

```bash
patrol test -d web-server --generate-bundle
# Creates test_bundle.dart at the project root
```

### Step 2: Build

```bash
flutter build web --target=test_bundle.dart --profile
```

That's the minimum. No extra dart-defines are required — they all default to safe values.

### Patrol's Internal Dart Defines

When `patrol test` runs normally, it injects these dart-defines. Most are irrelevant for web:

| Dart Define | Default | Purpose | Needed for web? |
|-------------|---------|---------|----------------|
| `PATROL_TEST_LABEL_ENABLED` | `false` | Shows test name labels in the UI overlay via `PatrolBinding` | Optional — set `true` if you want visual test labels |
| `COVERAGE_ENABLED` | `false` | Triggers code coverage collection in `PatrolBinding` | Optional — set `true` if collecting coverage |
| `INTEGRATION_TEST_SHOULD_REPORT_RESULTS_TO_NATIVE` | `false` | Reports results to native test runner (Android/iOS) | No — always `false` for web |
| `PATROL_APP_PACKAGE_NAME` | from pubspec | Android package name | No — mobile only |
| `PATROL_APP_BUNDLE_ID` | from pubspec | iOS bundle ID | No — mobile only |
| `PATROL_MACOS_APP_BUNDLE_ID` | from pubspec | macOS bundle ID | No — mobile only |
| `PATROL_ANDROID_APP_NAME` | from pubspec | Android app name | No — mobile only |
| `PATROL_IOS_APP_NAME` | from pubspec | iOS app name | No — mobile only |
| `PATROL_TEST_DIRECTORY` | `patrol_test` | Test directory path, used by CLI | No — not read by Dart code |
| `PATROL_TEST_SERVER_PORT` | — | Native test server port | No — excluded for web |
| `PATROL_APP_SERVER_PORT` | — | Native app server port | No — excluded for web |

### Full build with explicit defines (optional)

If you want to match exactly what patrol passes:

```bash
flutter build web \
  --target=test_bundle.dart \
  --profile \
  --dart-define=PATROL_TEST_LABEL_ENABLED=false \
  --dart-define=COVERAGE_ENABLED=false \
  --dart-define=INTEGRATION_TEST_SHOULD_REPORT_RESULTS_TO_NATIVE=false
```

Since `bool.fromEnvironment` defaults to `false` when the define is missing, the plain build without any defines works identically.

## Best Use Case: CI Parallel Sharding

Build once, fan out to N parallel test jobs:

```yaml
# Build job (once, ~2-3 min)
- flutter build web --target=test_bundle.dart --profile
- upload build/web as artifact

# Test jobs (parallel, ~30s startup each)
- download artifact
- npx serve build/web -l 8080 &
- patrol test -d web-server --web-base-url=http://localhost:8080 --web-shard=1/4
# ... repeat for shards 2/4, 3/4, 4/4
```

Without `--web-base-url`, each shard rebuilds the app independently — N shards = Nx build cost for identical output.

## Local Development

Run the server once, test repeatedly:

```bash
# Terminal 1: start server (stays running)
flutter run -d web-server --web-port=8080

# Terminal 2: run tests without rebuilding
patrol test -d web-server --web-base-url=http://localhost:8080
```

## When NOT to Use

- **Active test development** — you're changing test files frequently, so you're rebuilding anyway
- **Long-lived hosted test environments** — the build goes stale as soon as any test file changes
- **Production deployments** — the test build contains all test code and infrastructure, it's not a production artifact

## Future Improvement: Dynamic Tag Filtering

Currently, tag filtering is baked into `test_bundle.dart` at generation time. This means changing `--tags` requires a rebuild.

A potential improvement: generate the bundle with no tag filtering (`tags: null`) and move filtering to the Playwright side, which already receives the full test tree with tags attached. This would make one build usable for any tag combination, controlled purely at test runtime.

Test file imports cannot be made dynamic due to Dart's static import requirement.
