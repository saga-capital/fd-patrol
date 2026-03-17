# Fix: Patrol Reporter Not Generating Output

## Problem

The patrol custom reporter (`patrolReporter.ts`) never produces its HTML report (`patrol-report.html` + per-test detail pages with filmstrip/step screenshots). The Playwright HTML report generates fine, but the patrol-specific report is completely missing.

## Root Cause

In `packages/patrol/web_runner/playwright.config.ts` line 98:

```typescript
case "patrol":
  return [require.resolve("./reporters/patrolReporter"), { outputFolder }] satisfies ReporterDescription
```

`require.resolve("./reporters/patrolReporter")` fails with `MODULE_NOT_FOUND` because Node.js's `require.resolve` does NOT resolve `.ts` files — it only tries `.js`, `.json`, `.node` extensions. The file is `reporters/patrolReporter.ts` with no compiled `.js` counterpart.

When this throws inside `mapReporters()`, the config's `reporter` variable fails to initialize, and the fallback kicks in:

```typescript
reporter: reporter ?? [["html", { outputFolder, open: "never" }]],
```

Result: only the built-in HTML reporter runs. The patrol reporter is silently skipped. This also means `PATROL_LOG` messages aren't forwarded to stdout, so `PatrolLogReader` shows "Total: 0" in the CLI summary even though tests actually execute.

## Fix Applied

**File:** `packages/patrol/web_runner/playwright.config.ts` line 98

```diff
- return [require.resolve("./reporters/patrolReporter"), { outputFolder }] satisfies ReporterDescription
+ return [require.resolve("./reporters/patrolReporter.ts"), { outputFolder }] satisfies ReporterDescription
```

Adding the `.ts` extension makes `require.resolve` find the file. Playwright's TypeScript loader then compiles and loads it correctly as a reporter module.

## Verification

```bash
# Without .ts extension — fails:
cd packages/patrol/web_runner
node -e "require.resolve('./reporters/patrolReporter')"
# → MODULE_NOT_FOUND

# With .ts extension — works:
node -e "require.resolve('./reporters/patrolReporter.ts')"
# → /path/to/web_runner/reporters/patrolReporter.ts
```

After the fix, running `patrol test --web-reporter '["patrol", "html"]'` should produce:
- `playwright-report/patrol-report.html` — index page listing all tests
- `playwright-report/patrol-report-{test-slug}.html` — per-test detail pages with filmstrip, step screenshots, video
- `playwright-report/patrol-assets/` — screenshots and videos copied for the patrol report

## After Tagging

Update the git ref in the consuming repo (`future_driver_flutter`):
- `apps/web/pubspec.yaml` — patrol package `ref:`
- `.github/workflows/e2e-web.yaml` — patrol_cli install `--git-ref`
- `.github/workflows/e2e-web-split.yaml` — patrol_cli install `--git-ref`