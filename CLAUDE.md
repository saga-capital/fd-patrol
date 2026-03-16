# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Patrol is a multiplatform E2E UI testing framework for Flutter apps. This is a Melos-managed monorepo with packages in Dart/Flutter, Kotlin (Android), Swift (iOS/macOS), and TypeScript (web).

## Packages

- **`patrol`** — Core testing framework with native platform integrations (Android/iOS/macOS/Web)
- **`patrol_cli`** — CLI tool for running tests (`patrol test`, `patrol develop`)
- **`patrol_finders`** — Custom widget finders library (usable standalone)
- **`patrol_log`** — Logging library
- **`patrol_gen`** — Contract generator from `schema.dart`
- **`patrol_devtools_extension`** — Flutter DevTools extension
- **`adb`** — Dart wrapper around Android Debug Bridge
- **`dev/e2e_app`** — Integration test application

## Common Commands

```bash
# Bootstrap all packages
melos run get:all

# Lint everything (analyze + format check)
melos run lint:all

# Run analyze or format individually
melos run analyze
melos run format

# Run tests across all packages that have them
melos run test

# Run tests for a single package
cd packages/patrol_finders && flutter test .

# Run a single test file
cd packages/patrol_cli && flutter test test/some_test.dart

# Activate patrol_cli locally for development
dart pub global activate --source path packages/patrol_cli

# Or run patrol_cli without installing
dart run packages/patrol_cli <command>

# Web runner (packages/patrol/web_runner)
npm install && npm run lint && npm run format
```

## Architecture

### Package Dependency Graph

```
patrol_cli → patrol → patrol_finders → patrol_log
                   → adb
                   → native code (Kotlin, Swift, Playwright)
```

### Native Code Contract System

Native method APIs are generated from `schema.dart` in the repo root. To add/modify native methods:
1. Edit `schema.dart`
2. Run `./gen_from_schema` to regenerate contracts
3. Implement the methods on each native platform

Native code locations:
- Android: `packages/patrol/android/src/main/kotlin/pl/leancode/patrol/`
- iOS/macOS: `packages/patrol/darwin/Classes/`
- Web: `packages/patrol/web_runner/` (Playwright-based)

### Test Tag System

E2E tests in `dev/e2e_app/patrol_test/` use tags for CI filtering:
- **Platform**: `android`, `ios`, `web`, `macos`
- **Environment**: `physical_device`, `emulator`, `simulator`
- **Features**: `webview`, `locale_testing_android`, `locale_testing_ios`

Tests are selected with boolean expressions: `--tags='android && emulator'`

## Code Style

- All Dart packages use `leancode_lint` for analysis rules
- Dart formatting: `dart format . --set-exit-if-changed`
- Flutter analysis: `flutter analyze --fatal-infos`
- Web runner: ESLint + Prettier
- iOS/macOS: swift-format, clang-format
- Android: ktlint

## SDK Requirements

- Dart SDK: >=3.8.0
- Flutter: 3.32.x (stable)
- Melos: >=3.1.1
- Node.js 24 (for web runner and docs)

## Adding Localization Strings

### iOS
1. Add/edit files in `packages/patrol/darwin/Resources/<language>/Localizable.strings`
2. Register in `getLocalizedStrings` in `IOSAutomator.swift`
3. Add to `supportedLanguages` in `Localization.swift`

### Android
1. Add/edit files in `packages/patrol/android/src/main/res/values-<language>/strings.xml`
2. Use strings in `Automator.kt` functions
3. Register in `getLocalizedString` in `Localization.kt`

## PR Guidelines

- Update the changelog for modified packages (use `## Unreleased` if unsure about version)
- Reference the related issue in the PR description
- `test android emulator` workflows require repo write access — contributors need a maintainer to re-run them