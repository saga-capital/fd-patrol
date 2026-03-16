import { Page } from "playwright"

export async function takeScreenshot(page: Page) {
  // Wait for the browser to paint the latest Flutter frame
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
}
