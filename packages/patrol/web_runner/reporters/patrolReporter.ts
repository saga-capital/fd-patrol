import * as fs from "fs"
import * as path from "path"

import type { FullConfig, FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter"

interface StepData {
  title: string
  duration: number
  startTime: number
  error?: string
  errorStack?: string
  screenshotFile?: string
  params?: Record<string, unknown>
}

interface TestData {
  name: string
  slug: string
  duration: number
  status: string
  error?: string
  errorStack?: string
  steps: StepData[]
  videoFile?: string
  consoleLogs?: string
}

class PatrolReporter implements Reporter {
  private outputFolder: string
  private tests: TestData[] = []

  constructor(options: { outputFolder?: string } = {}) {
    this.outputFolder = options.outputFolder || "./playwright-report"
  }

  onBegin(_config: FullConfig) {
    // noop
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const assetsDir = path.join(this.outputFolder, "patrol-assets")
    fs.mkdirSync(assetsDir, { recursive: true })

    const testSlug = test.title.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 80)

    const steps = this.collectSteps(result.steps, assetsDir, testSlug)

    let videoFile: string | undefined
    const videoAttachment = result.attachments.find(a => a.name === "video" && a.contentType === "video/webm")
    if (videoAttachment?.path) {
      try {
        const dest = `${testSlug}-video.webm`
        fs.copyFileSync(videoAttachment.path, path.join(assetsDir, dest))
        videoFile = dest
      } catch {
        // Video file may not exist
      }
    }

    // Extract console logs from attachments
    let consoleLogs: string | undefined
    const consoleAttachment = result.attachments.find(a => a.name === "console-log" && a.contentType === "text/plain")
    if (consoleAttachment?.body) {
      consoleLogs = consoleAttachment.body.toString("utf-8")
    } else if (consoleAttachment?.path) {
      try {
        consoleLogs = fs.readFileSync(consoleAttachment.path, "utf-8")
      } catch {
        // noop
      }
    }

    this.tests.push({
      name: test.title,
      slug: testSlug,
      duration: result.duration,
      status: result.status,
      error: result.error?.message,
      errorStack: result.error?.stack,
      steps,
      videoFile,
      consoleLogs,
    })
  }

  private collectSteps(steps: TestStep[], assetsDir: string, testSlug: string): StepData[] {
    const collected: StepData[] = []

    for (const step of steps) {
      if (step.category === "test.step") {
        const imageAttachment = step.attachments.find(a => a.contentType === "image/png")
        let screenshotFile: string | undefined

        if (imageAttachment?.path) {
          try {
            const filename = `${testSlug}-${path.basename(imageAttachment.path)}`
            fs.copyFileSync(imageAttachment.path, path.join(assetsDir, filename))
            screenshotFile = filename
          } catch {
            // noop
          }
        } else if (imageAttachment?.body) {
          try {
            const filename = `${testSlug}-step-${collected.length}.png`
            fs.writeFileSync(path.join(assetsDir, filename), imageAttachment.body)
            screenshotFile = filename
          } catch {
            // noop
          }
        }

        collected.push({
          title: step.title,
          duration: step.duration,
          startTime: step.startTime.getTime(),
          error: step.error?.message,
          errorStack: step.error?.stack,
          screenshotFile,
        })
      }

      if (step.steps.length > 0) {
        collected.push(...this.collectSteps(step.steps, assetsDir, testSlug))
      }
    }

    return collected
  }

  async onEnd(_result: FullResult) {
    if (this.tests.length === 0) return

    fs.mkdirSync(this.outputFolder, { recursive: true })

    // Generate per-test detail pages
    for (const test of this.tests) {
      const html = this.generateDetailPage(test)
      const outputPath = path.join(this.outputFolder, `patrol-report-${test.slug}.html`)
      fs.writeFileSync(outputPath, html, "utf-8")
    }

    // Generate index page
    const indexHtml = this.generateIndexPage()
    const indexPath = path.join(this.outputFolder, "patrol-report.html")
    fs.writeFileSync(indexPath, indexHtml, "utf-8")

    // eslint-disable-next-line no-console
    console.log(`\nPatrol report: ${indexPath}`)
  }

  private generateIndexPage(): string {
    const passed = this.tests.filter(t => t.status === "passed").length
    const failed = this.tests.filter(t => t.status === "failed").length
    const total = this.tests.reduce((s, t) => s + t.duration, 0)

    const testRows = this.tests
      .map(t => {
        const statusClass = t.status === "passed" ? "passed" : "failed"
        const icon = t.status === "passed" ? "&#x2713;" : "&#x2717;"
        const stepCount = t.steps.length
        const screenshotCount = t.steps.filter(s => s.screenshotFile).length
        return `<a class="test-row ${statusClass}" href="patrol-report-${this.esc(t.slug)}.html">
          <span class="test-status">${icon}</span>
          <span class="test-name">${this.esc(t.name)}</span>
          <span class="test-meta">${stepCount} steps &middot; ${screenshotCount} screenshots</span>
          <span class="test-duration">${this.fmtDuration(t.duration)}</span>
        </a>`
      })
      .join("\n")

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Patrol Test Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; }
  .header { padding: 24px 32px; background: #16213e; border-bottom: 1px solid #2a2a4a; }
  .header h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  .summary { display: flex; gap: 16px; font-size: 14px; color: #aaa; }
  .summary .passed { color: #52b788; }
  .summary .failed { color: #ff6b6b; }
  .test-list { max-width: 900px; margin: 24px auto; }
  .test-row { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: #16213e; margin-bottom: 2px; border-radius: 6px; text-decoration: none; color: #e0e0e0; transition: background 0.1s; }
  .test-row:hover { background: #1e1e3a; }
  .test-row.failed { border-left: 3px solid #ff6b6b; }
  .test-row.passed { border-left: 3px solid #52b788; }
  .test-status { font-size: 16px; width: 24px; text-align: center; }
  .test-row.passed .test-status { color: #52b788; }
  .test-row.failed .test-status { color: #ff6b6b; }
  .test-name { flex: 1; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .test-meta { font-size: 12px; color: #666; white-space: nowrap; }
  .test-duration { font-size: 13px; color: #888; white-space: nowrap; min-width: 60px; text-align: right; }
</style>
</head><body>
<div class="header">
  <h1>Patrol Test Report</h1>
  <div class="summary">
    <span class="passed">${passed} passed</span>
    <span class="failed">${failed} failed</span>
    <span>${this.tests.length} total</span>
    <span>${this.fmtDuration(total)}</span>
  </div>
</div>
<div class="test-list">${testRows}</div>
</body></html>`
  }

  private generateDetailPage(testData: TestData): string {
    const testsJSON = JSON.stringify(testData)

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this.esc(testData.name)} - Patrol Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; }

  .header { padding: 12px 24px; background: #16213e; border-bottom: 1px solid #2a2a4a; display: flex; align-items: center; gap: 12px; }
  .header a { color: #6c63ff; text-decoration: none; font-size: 13px; }
  .header a:hover { text-decoration: underline; }
  .header h1 { font-size: 15px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .badge.passed { background: #1b4332; color: #52b788; }
  .badge.failed { background: #3d0000; color: #ff6b6b; }
  .header .duration { font-size: 13px; color: #888; }

  /* Error banner */
  .error-banner { background: #2d0000; border-bottom: 1px solid #4a0000; padding: 12px 24px; }
  .error-banner summary { color: #ff6b6b; font-size: 13px; cursor: pointer; font-weight: 500; }
  .error-banner pre { color: #ff9999; font-size: 12px; margin-top: 8px; white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow: auto; line-height: 1.5; }

  /* Tabs */
  .tabs { display: flex; background: #16213e; border-bottom: 1px solid #2a2a4a; }
  .tab { padding: 8px 20px; cursor: pointer; font-size: 13px; color: #888; border-bottom: 2px solid transparent; user-select: none; }
  .tab:hover { color: #ccc; }
  .tab.active { color: #e0e0e0; border-bottom-color: #6c63ff; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Filmstrip */
  .filmstrip { padding: 10px 24px; background: #0f0f23; border-bottom: 1px solid #2a2a4a; overflow-x: auto; white-space: nowrap; display: flex; gap: 4px; align-items: end; }
  .filmstrip-item { position: relative; flex-shrink: 0; }
  .filmstrip-thumb { width: 80px; height: 50px; object-fit: cover; object-position: top; border: 2px solid transparent; border-radius: 4px; cursor: pointer; opacity: 0.7; transition: all 0.15s; }
  .filmstrip-thumb:hover { opacity: 1; border-color: #4a4a8a; }
  .filmstrip-thumb.active { opacity: 1; border-color: #6c63ff; }
  .filmstrip-time { position: absolute; bottom: 2px; left: 2px; font-size: 9px; color: #aaa; background: rgba(0,0,0,0.7); padding: 1px 3px; border-radius: 2px; }

  /* Two-panel layout */
  .panels { display: flex; height: calc(100vh - 180px); }

  /* Left: step list */
  .step-list { width: 400px; min-width: 400px; overflow-y: auto; border-right: 1px solid #2a2a4a; background: #16213e; }
  .step-item { border-bottom: 1px solid #1a1a2e; transition: background 0.1s; font-size: 13px; }
  .step-item:hover { background: #1e1e3a; }
  .step-item.active { background: #252560; border-left: 3px solid #6c63ff; }
  .step-item.has-error { border-left: 3px solid #ff6b6b; }
  .step-row { padding: 10px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
  .step-chevron { width: 14px; flex-shrink: 0; color: #555; font-size: 10px; transition: transform 0.15s; }
  .step-item.expanded .step-chevron { transform: rotate(90deg); }
  .step-icon { width: 16px; flex-shrink: 0; text-align: center; font-size: 12px; }
  .step-icon.ok { color: #52b788; }
  .step-icon.err { color: #ff6b6b; }
  .step-icon.img { color: #6c63ff; font-size: 11px; }
  .step-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step-duration { color: #888; font-size: 12px; flex-shrink: 0; }
  .step-details { display: none; padding: 0 16px 10px 54px; font-size: 12px; color: #999; line-height: 1.6; }
  .step-item.expanded .step-details { display: block; }
  .step-details pre { background: #111128; padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .step-details .error-text { color: #ff9999; }

  /* Right: preview */
  .preview { flex: 1; overflow: auto; display: flex; flex-direction: column; align-items: center; justify-content: start; background: #111128; padding: 16px; }
  .preview img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  .preview .placeholder { color: #555; font-size: 14px; margin-top: 30vh; }

  /* Video */
  .video-container { display: flex; justify-content: center; padding: 24px; background: #111128; height: calc(100vh - 140px); }
  .video-container video { max-width: 100%; max-height: 100%; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  .video-container .placeholder { color: #555; font-size: 14px; padding-top: 30vh; }

  /* Console panel */
  .console-panel { padding: 12px; background: #0d0d1a; height: calc(100vh - 180px); overflow-y: auto; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; line-height: 1.6; }
  .console-toolbar { padding: 6px 12px; background: #16213e; border-bottom: 1px solid #2a2a4a; display: flex; gap: 8px; align-items: center; }
  .console-toolbar label { font-size: 12px; color: #888; cursor: pointer; display: flex; align-items: center; gap: 4px; }
  .console-toolbar input[type="checkbox"] { cursor: pointer; }
  .console-line { padding: 1px 12px; border-bottom: 1px solid #1a1a2e; white-space: pre-wrap; word-break: break-all; }
  .console-line.log { color: #ccc; }
  .console-line.error, .console-line.page-error { color: #ff6b6b; background: #1a0000; }
  .console-line.warning { color: #ffb347; }
  .console-line.patrol-log { color: #6c63ff; }
  .console-line.debug { color: #888; }

  @media (max-width: 768px) {
    .panels { flex-direction: column; height: auto; }
    .step-list { width: 100%; min-width: auto; max-height: 40vh; }
    .preview { min-height: 50vh; }
  }
</style>
</head><body>

<div class="header">
  <a href="patrol-report.html">&larr; All tests</a>
  <span class="badge ${testData.status === "passed" ? "passed" : "failed"}">${testData.status === "passed" ? "Passed" : "Failed"}</span>
  <h1>${this.esc(testData.name)}</h1>
  <span class="duration">${this.fmtDuration(testData.duration)}</span>
</div>

${this.renderErrorBanner(testData)}

<div id="tabs-bar" class="tabs">
  <div class="tab active" data-tab="steps-content">Steps (${testData.steps.length})</div>
  ${testData.consoleLogs ? '<div class="tab" data-tab="console-content">Console</div>' : ""}
  ${testData.videoFile ? '<div class="tab" data-tab="video-content">Video</div>' : ""}
</div>

<div id="steps-content" class="tab-content active"></div>
${
  testData.consoleLogs
    ? `<div id="console-content" class="tab-content">
  <div class="console-panel" id="console-panel"></div>
</div>`
    : ""
}
${
  testData.videoFile
    ? `<div id="video-content" class="tab-content">
  <div class="video-container"><video controls src="patrol-assets/${testData.videoFile}"></video></div>
</div>`
    : ""
}

<script>
const ASSETS = 'patrol-assets/';
const test = ${testsJSON};

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// Build steps view
const stepsContainer = document.getElementById('steps-content');
const screenshotSteps = test.steps.filter(s => s.screenshotFile);

// Filmstrip
if (screenshotSteps.length > 0) {
  const filmstrip = document.createElement('div');
  filmstrip.className = 'filmstrip';
  const t0 = test.steps.length > 0 ? test.steps[0].startTime : 0;

  screenshotSteps.forEach(step => {
    const idx = test.steps.indexOf(step);
    const item = document.createElement('div');
    item.className = 'filmstrip-item';
    item.innerHTML = '<img class="filmstrip-thumb" data-idx="' + idx + '" src="' + ASSETS + step.screenshotFile + '">' +
      '<div class="filmstrip-time">' + fmtDuration(step.startTime - t0) + '</div>';
    item.querySelector('img').addEventListener('click', () => selectStep(idx));
    filmstrip.appendChild(item);
  });
  stepsContainer.appendChild(filmstrip);
}

// Panels
const panels = document.createElement('div');
panels.className = 'panels';

const stepList = document.createElement('div');
stepList.className = 'step-list';

test.steps.forEach((step, i) => {
  const item = document.createElement('div');
  item.className = 'step-item' + (step.error ? ' has-error' : '');
  item.dataset.idx = String(i);

  const hasDetails = step.error || step.params;
  const chevron = hasDetails ? '&#x25B6;' : '';
  const statusIcon = step.error ? '<span class="step-icon err">&#x2717;</span>' : '<span class="step-icon ok">&#x2713;</span>';
  const imgIcon = step.screenshotFile ? ' <span class="step-icon img">&#x1F4F7;</span>' : '';

  let detailsHTML = '';
  if (step.error) {
    detailsHTML += '<div class="error-text">' + escapeHtml(step.error) + '</div>';
    if (step.errorStack) {
      detailsHTML += '<pre class="error-text">' + escapeHtml(step.errorStack) + '</pre>';
    }
  }

  item.innerHTML =
    '<div class="step-row">' +
      '<span class="step-chevron">' + chevron + '</span>' +
      statusIcon + imgIcon +
      '<span class="step-title">' + escapeHtml(step.title) + '</span>' +
      '<span class="step-duration">' + fmtDuration(step.duration) + '</span>' +
    '</div>' +
    (detailsHTML ? '<div class="step-details">' + detailsHTML + '</div>' : '');

  // Click: select step for preview + toggle details
  item.querySelector('.step-row').addEventListener('click', (e) => {
    selectStep(i);
    if (detailsHTML) {
      item.classList.toggle('expanded');
    }
  });

  stepList.appendChild(item);
});

panels.appendChild(stepList);

const preview = document.createElement('div');
preview.className = 'preview';
preview.id = 'preview';
preview.innerHTML = '<div class="placeholder">Select a step to view its screenshot</div>';
panels.appendChild(preview);

stepsContainer.appendChild(panels);

// Auto-select first screenshot
if (screenshotSteps.length > 0) {
  selectStep(test.steps.indexOf(screenshotSteps[0]));
}

function selectStep(idx) {
  const step = test.steps[idx];

  // Active step
  stepList.querySelectorAll('.step-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  // Active filmstrip
  document.querySelectorAll('.filmstrip-thumb').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.idx) === idx);
  });

  // Preview
  const p = document.getElementById('preview');
  if (step.screenshotFile) {
    p.innerHTML = '<img src="' + ASSETS + step.screenshotFile + '" alt="' + escapeHtml(step.title) + '">';
  } else {
    p.innerHTML = '<div class="placeholder">No screenshot for this step</div>';
  }

  // Scroll into view
  const active = stepList.querySelector('.step-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function fmtDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Console panel
if (test.consoleLogs) {
  const panel = document.getElementById('console-panel');
  if (panel) {
    const lines = test.consoleLogs.split('\\n');
    lines.forEach(line => {
      const div = document.createElement('div');
      div.className = 'console-line ' + classifyLine(line);
      div.textContent = line;
      panel.appendChild(div);
    });
  }
}

function classifyLine(line) {
  // Lines may start with a timestamp like "00:01.234 [type] ..."
  var rest = line.replace(/^\\d{2}:\\d{2}\\.\\d{3}\\s*/, '');
  if (rest.startsWith('[PAGE_ERROR]')) return 'page-error';
  if (rest.startsWith('[error]')) return 'error';
  if (rest.startsWith('[warning]')) return 'warning';
  if (rest.includes('PATROL_LOG')) return 'patrol-log';
  if (rest.startsWith('[debug]')) return 'debug';
  return 'log';
}
</script>
</body></html>`
  }

  private renderErrorBanner(testData: TestData): string {
    if (!testData.error) return ""

    // Parse the error: first non-empty line is the message, rest is stack trace
    const rawError = testData.error.replace(/^Error:\s*/i, "")
    const lines = rawError.split("\n")

    // Find the error message (first non-empty line) and stack trace (lines starting with "at" or whitespace+"at")
    let message = ""
    const stackLines: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!message && trimmed) {
        message = trimmed
      } else if (trimmed.startsWith("at ") || trimmed.startsWith("at\t")) {
        stackLines.push(line)
      } else if (trimmed.startsWith("Context:") || trimmed.startsWith("Library:")) {
        stackLines.push(line)
      }
    }

    // Keep only the first 10 stack frames
    const visibleStack = stackLines.slice(0, 10)
    const hiddenCount = stackLines.length - visibleStack.length

    const stackText = visibleStack.join("\n") + (hiddenCount > 0 ? `\n    ... ${hiddenCount} more frames` : "")

    return `<details class="error-banner" open>
  <summary>${this.esc(message)}</summary>
  <pre>${this.esc(stackText)}</pre>
</details>`
  }

  private esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  private fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }
}

export default PatrolReporter
