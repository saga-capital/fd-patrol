import * as path from "path"

import { Page } from "playwright"
import { actions } from "./actions"
import { PatrolNativeRequest } from "./contracts"
import { logger } from "./logger"

const screenshotMode = process.env.PATROL_WEB_SCREENSHOT ?? "off"
const outputDir = process.env.PATROL_TEST_RESULTS_DIR || "./test-results"

let stepCounter = 0

export async function exposePatrolPlatformHandler(page: Page) {
  await page.exposeBinding("__patrol__platformHandler", async ({ page }, request) =>
    handlePatrolPlatformAction(page, request),
  )
}

async function handlePatrolPlatformAction(page: Page, { action, params }: PatrolNativeRequest) {
  logger.info(params, `Received action: ${action}`)

  const actionFn = actions[action as keyof typeof actions]

  if (!actionFn) {
    throw new Error(`Action ${action} not found`)
  }

  try {
    const result = await actionFn(page, params as any)

    if (screenshotMode === "on" || screenshotMode === "each-step") {
      await takeStepScreenshot(page, action)
    }

    return result
  } catch (e) {
    if (screenshotMode !== "off") {
      await takeStepScreenshot(page, `${action}-FAILED`).catch(screenshotErr => {
        logger.warn(`Failed to take failure screenshot: ${screenshotErr}`)
      })
    }

    logger.error(e, "Failed to handle patrol platform request")
    throw e
  }
}

async function takeStepScreenshot(page: Page, action: string) {
  stepCounter++
  const stepNum = String(stepCounter).padStart(3, "0")
  const sanitizedAction = action.replace(/[^a-zA-Z0-9_-]/g, "_")
  const screenshotPath = path.join(outputDir, "steps", `${stepNum}-${sanitizedAction}.png`)

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true })
    logger.info(`Step screenshot saved: ${screenshotPath}`)
  } catch (e) {
    logger.warn(`Failed to take step screenshot: ${e}`)
  }
}