import * as fs from "fs"
import * as path from "path"

import { SourceMapConsumer, type RawSourceMap } from "source-map"

let cachedConsumer: SourceMapConsumer | null = null
let sourceMapLoadAttempted = false

async function getConsumer(): Promise<SourceMapConsumer | null> {
  if (cachedConsumer) return cachedConsumer
  if (sourceMapLoadAttempted) return null
  sourceMapLoadAttempted = true

  const baseUrl = process.env.BASE_URL
  if (!baseUrl) return null

  // Try to find the source map file from the build output.
  // Typically at build/web/main.dart.js.map relative to the project root.
  const possiblePaths = [
    path.resolve(process.cwd(), "build/web/main.dart.js.map"),
    // When running from web_runner, the project root is a few levels up
    path.resolve(process.cwd(), "../../../build/web/main.dart.js.map"),
  ]

  // Also check PATROL_SOURCE_MAP env var for explicit path
  if (process.env.PATROL_SOURCE_MAP) {
    possiblePaths.unshift(process.env.PATROL_SOURCE_MAP)
  }

  for (const mapPath of possiblePaths) {
    try {
      if (fs.existsSync(mapPath)) {
        const rawMap = JSON.parse(fs.readFileSync(mapPath, "utf-8")) as RawSourceMap
        cachedConsumer = await new SourceMapConsumer(rawMap)
        return cachedConsumer
      }
    } catch {
      // Try next path
    }
  }

  return null
}

/**
 * Resolves obfuscated dart2js stack trace lines to original Dart source locations.
 *
 * Transforms lines like:
 *   at Object.fail (http://localhost:8091/main.dart.js:40987:16)
 * Into:
 *   at Object.fail (package:matcher/src/expect/expect.dart:149:30)
 */
export async function deobfuscateStackTrace(text: string): Promise<string> {
  const consumer = await getConsumer()
  if (!consumer) return text

  // Match dart2js stack trace patterns:
  //   at FunctionName (http://host/main.dart.js:LINE:COL)
  //   at http://host/main.dart.js:LINE:COL
  const jsLinePattern = /(?:at\s+.*?\(|at\s+)(https?:\/\/[^/]+\/main\.dart\.js):(\d+):(\d+)\)?/g

  return text.replace(jsLinePattern, (match, _url, lineStr, colStr) => {
    const line = parseInt(lineStr, 10)
    const column = parseInt(colStr, 10)
    const orig = consumer.originalPositionFor({ line, column })

    if (orig.source && orig.line != null) {
      // Clean up the source path for readability
      let source = orig.source
      // Remove org-dartlang-sdk prefix
      source = source.replace(/^org-dartlang-sdk:\/\/\//, "dart-sdk/")
      // Simplify relative paths
      source = source.replace(/^\.\.\/+/g, "")

      const prefix = match.includes("(") ? match.substring(0, match.indexOf("(") + 1) : "at "
      const suffix = match.includes("(") ? ")" : ""
      return `${prefix}${source}:${orig.line}:${orig.column}${suffix}`
    }

    return match
  })
}

export function destroySourceMap() {
  cachedConsumer?.destroy()
  cachedConsumer = null
}
