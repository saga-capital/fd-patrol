import * as path from "path"

import { test, TestStepInfo } from "@playwright/test"
import { Page } from "playwright"
import { actions } from "./actions"
import { PatrolNativeRequest, WebSelector } from "./contracts"
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

  const stepLabel = buildStepLabel(action, params)

  return test.step(stepLabel, async (step) => {
    try {
      const result = await actionFn(page, params as any)

      if (screenshotMode === "on" || screenshotMode === "each-step") {
        await takeStepScreenshot(page, stepLabel, step)
      }

      return result
    } catch (e) {
      if (screenshotMode !== "off") {
        await takeStepScreenshot(page, `${stepLabel}-FAILED`, step).catch(screenshotErr => {
          logger.warn(`Failed to take failure screenshot: ${screenshotErr}`)
        })
      }

      logger.error(e, "Failed to handle patrol platform request")
      throw e
    }
  })
}

function describeSelector(selector: WebSelector | null | undefined): string {
  if (!selector) return ""
  return selector.testId || selector.text || selector.label || selector.role || selector.cssOrXpath || ""
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildStepLabel(action: string, params: any): string {
  const p = params as Record<string, unknown> | undefined
  const sel = describeSelector(p?.selector as WebSelector | undefined)

  switch (action) {
    case "enterText":
      return sel ? `enterText "${p?.text}" into ${sel}` : `enterText "${p?.text}"`
    case "tap":
      return sel ? `tap ${sel}` : "tap"
    case "scrollTo":
      return sel ? `scrollTo ${sel}` : "scrollTo"
    case "pressKey":
      return `pressKey "${p?.key}"`
    case "pressKeyCombo":
      return `pressKeyCombo ${(p?.keys as string[])?.join("+")}`
    case "resizeWindow":
      return `resizeWindow ${p?.width}x${p?.height}`
    case "takeScreenshot":
      return (p?.action as string) || "takeScreenshot"
    default:
      return action
  }
}

async function takeStepScreenshot(page: Page, action: string, step: TestStepInfo) {
  stepCounter++
  const stepNum = String(stepCounter).padStart(3, "0")
  const sanitizedAction = action.replace(/[^a-zA-Z0-9_-]/g, "_")
  const screenshotPath = path.join(outputDir, "steps", `${stepNum}-${sanitizedAction}.png`)

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await step.attach(`${stepNum}-${sanitizedAction}`, {
      path: screenshotPath,
      contentType: "image/png",
    })
    logger.info(`Step screenshot saved: ${screenshotPath}`)
  } catch (e) {
    logger.warn(`Failed to take step screenshot: ${e}`)
  }
}