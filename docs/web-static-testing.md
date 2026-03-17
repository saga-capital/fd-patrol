# Web Static Testing (dart2js Builds)

Build once with `flutter build web`, serve statically, run multiple Playwright workers against the same build. Ideal for CI parallelism.

## Quick Start

```bash
# 1. Build once
PATROL_FLUTTER_COMMAND="fvm flutter" patrol build web \
  --target patrol_test/my_tests.dart \
  --profile -O 1 --source-maps

# 2. Serve statically (any HTTP server works)
python3 -m http.server 8080 --directory build/web

# 3. Run tests (multiple workers)
PATROL_FLUTTER_COMMAND="fvm flutter" patrol test \
  --device web \
  --web-base-url=http://localhost:8080 \
  --web-workers=4 \
  --web-reporter='["patrol"]' \
  --web-screenshot=each-step \
  --web-video=retain-on-failure
```

## How It Works

Patrol's web runner communicates with the Flutter app through `window.__patrol__*` globals using `dart:js_interop`. This mechanism is compiler-agnostic - it works identically with DDC (debug) and dart2js (profile/release).

Each Playwright test opens the page fresh (`page.goto("/")`), which re-runs `main()` and creates independent test state. No shared state between tests.

## Build Flags

### Optimization Level (`-O`)

Controls dart2js optimization. Lower values preserve more debug info:

| Level | `print()` | Assertions | Minification | Recommended for |
|-------|-----------|-----------|-------------|-----------------|
| `-O0` | Kept | Kept | No | Maximum debug info |
| **`-O1`** | **Kept** | **Kept** | **No** | **Testing (recommended)** |
| `-O2` | Kept | Removed | Yes | Smaller builds with logs |
| `-O3` | Kept | Removed | Yes | More optimization |
| `-O4` | **Removed** | Removed | Yes | Default for `--profile` (avoid for tests) |

**Use `-O1`** for test builds. `-O4` (the default) strips all `print()` statements, killing console logs, PATROL_LOG messages, and debug output.

### Source Maps (`--source-maps`)

Generates `main.dart.js.map` (~3-4MB) that maps dart2js output back to original Dart source files. Enables readable stack traces in error reports:

**Without source maps:**
```
at Object.fail (main.dart.js:40987:16)
at main.dart.js:128357:17
```

**With source maps:**
```
at Object.fail (package:matcher/src/expect/expect.dart:149:30)
at patrol_test/research_web_test.dart:103:6
```

To enable deobfuscation, set `PATROL_SOURCE_MAP` to point to the map file:
```bash
PATROL_SOURCE_MAP=build/web/main.dart.js.map
```

## Reporters

### Patrol Reporter

```bash
--web-reporter='["patrol"]'
```

Generates `patrol-report/patrol-report.html` with:
- Test index page: pass/fail with step count and duration
- Per-test detail pages with:
  - **Steps tab**: filmstrip thumbnails + step list with screenshots
  - **Console tab**: timestamped, color-coded browser logs (`mm:ss.SSS` format)
  - **Video tab**: test recording (when enabled)
  - **Error banner**: clean error message with collapsible stack trace (max 10 frames)

### HTML Reporter (Playwright built-in)

```bash
--web-reporter='["html"]'
```

Standard Playwright HTML report at `html-report/index.html`.

### Multiple Reporters

Use separate report directories to avoid conflicts:
```bash
--web-reporter='["patrol", "html"]'
```

Note: when using both, the HTML reporter may overwrite patrol's output if using the same directory. Use `--web-report-dir` for the patrol reporter and let Playwright's HTML reporter use its own default.

## Fatal Rendering Errors

In profile/release mode, Flutter rendering errors (overflow, build crashes, layout issues) are treated as **fatal test failures**. This is controlled by:

```
--dart-define=PATROL_FAIL_ON_RENDER_ERROR=true   # default in profile/release
--dart-define=PATROL_FAIL_ON_RENDER_ERROR=false   # disable to match debug behavior
```

When enabled:
- Rendering errors immediately fail the test (no timeout waiting)
- A **red error widget** is shown instead of the default gray box
- The error + full stack trace appears in the report
- Screenshots capture the error state visually

When disabled (or in debug mode):
- Rendering errors are logged but don't fail the test
- Default gray error widget is shown
- Test continues executing

### Example: Widget Build Error

If a widget throws during `build()`:
```dart
class BrokenWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final items = <String>[];
    return Text(items[0]); // RangeError
  }
}
```

The test report shows:
- **Error banner**: `RangeError (index): Index out of range: no indices are valid: 0`
- **Stack trace**: `at _BrokenWidget.build (broken_page.dart:42:28)` (with source maps)
- **Screenshot**: red error widget with the error message
- **Console**: timestamped log showing exactly when the error occurred

## Screenshots and Video

```bash
--web-screenshot=each-step    # screenshot after every patrol action
--web-video=retain-on-failure # video only for failed tests
--web-video=on                # video for all tests
```

Screenshots are taken after each patrol action (tap, enterText, etc.) and attached to the corresponding step in the report. The filmstrip at the top of each test detail page shows thumbnails of all screenshots.

## CI Configuration Example

```yaml
# GitHub Actions example
jobs:
  build-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
      - run: patrol build web --target patrol_test/ --profile -O 1 --source-maps
      - uses: actions/upload-artifact@v4
        with:
          name: web-build
          path: build/web/

  test-web:
    needs: build-web
    runs-on: ubuntu-latest
    strategy:
      matrix:
        shard: [1/4, 2/4, 3/4, 4/4]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: web-build
          path: build/web/
      - run: python3 -m http.server 8080 --directory build/web &
      - run: |
          patrol test --device web \
            --web-base-url=http://localhost:8080 \
            --web-shard=${{ matrix.shard }} \
            --web-reporter='["patrol"]' \
            --web-screenshot=each-step \
            --web-video=retain-on-failure
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: test-report-${{ strategy.job-index }}
          path: patrol-report/
```

## Troubleshooting

### "Test starting..." page, nothing happens
The test bundle's `main()` is waiting for Playwright's handshake. This is expected when browsing the build output manually - it's a test bundle, not a regular app.

### Console logs are empty
You're probably using `-O4` (the default for `--profile`). Use `-O1` to preserve `print()` statements:
```bash
patrol build web --profile -O 1
```

### Stack traces show `main.dart.js:12345:67`
Source maps aren't loaded. Ensure:
1. Build with `--source-maps`
2. Set `PATROL_SOURCE_MAP=/path/to/build/web/main.dart.js.map`

### Test hangs at 60s timeout
If using a static build, ensure `exposePatrolPlatformHandler` is called before `page.goto()` in `test.spec.ts`. This is already fixed in the current version.

### Rendering errors don't fail the test
Check that you're building in profile or release mode (not debug). Or explicitly set:
```bash
--dart-define=PATROL_FAIL_ON_RENDER_ERROR=true
```
