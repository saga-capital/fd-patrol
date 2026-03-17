import { test as base } from "@playwright/test"
import { initialise } from "./initialise"
import { logger } from "./logger"
import { exposePatrolPlatformHandler } from "./patrolPlatformHandler"
import { deobfuscateStackTrace, destroySourceMap } from "./sourceMapResolver"
import { PatrolTestEntry } from "./types"

function fmtElapsed(ms: number): string {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

const tests: PatrolTestEntry[] = process.env.PATROL_TESTS ? JSON.parse(process.env.PATROL_TESTS) : []
if (tests.length === 0) {
  logger.error("PATROL_TESTS env is empty")
}

export const patrolTest = base.extend({
  page: async ({ page }, use, testInfo) => {
    const consoleLogs: string[] = []

    const t0 = Date.now()

    page.on("console", message => {
      const text = message.text()
      const ms = Date.now() - t0
      const entry = `${fmtElapsed(ms)} [${message.type()}] ${text}`
      consoleLogs.push(entry)

      if (text.startsWith("PATROL_LOG")) {
        // eslint-disable-next-line no-console
        console.log(text)
        return
      }

      // eslint-disable-next-line no-console
      console.log(`Playwright: ${text}`)
    })

    page.on("pageerror", error => {
      consoleLogs.push(`${fmtElapsed(Date.now() - t0)} [PAGE_ERROR] ${error.message}`)
      if (error.stack) {
        consoleLogs.push(error.stack)
      }
    })

    // exposeBinding must be called BEFORE page.goto so that
    // __patrol__platformHandler is available when the Dart code runs.
    // With dart2js builds, main() executes immediately on load and may
    // call platformHandler before post-navigation setup completes.
    await exposePatrolPlatformHandler(page)

    await page.goto("/", { waitUntil: "load" })

    await initialise(page)

    await use(page)

    // Deobfuscate console logs using source maps before attaching
    const deobfuscatedLogs = await deobfuscateStackTrace(consoleLogs.join("\n"))
    if (deobfuscatedLogs.length > 0) {
      await testInfo.attach("console-log", {
        body: Buffer.from(deobfuscatedLogs),
        contentType: "text/plain",
      })
    }
  },
})

for (const { name, skip, tags } of tests) {
  patrolTest(name, { tag: tags }, async ({ page }) => {
    patrolTest.skip(skip)

    await page.waitForFunction(() => window.__patrol__runTest, {
      timeout: 300000,
    })

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = await page.evaluate(async name => await window.__patrol__runTest!(name), name)
    if (result?.result === "failure") {
      // Deobfuscate dart2js stack traces to readable Dart source locations
      const rawDetails = result.details?.trim() || `Test "${name}" failed`
      const details = await deobfuscateStackTrace(rawDetails)
      throw new Error(details)
    }
  })
}

// Clean up source map consumer when all tests are done
process.on("exit", () => destroySourceMap())
