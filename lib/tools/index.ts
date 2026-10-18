'use client'

// Importing this file registers every tool. The panel, the MCP bridge and
// WebMCP all start here.

import './scene'
import './pages'
import './learn'
import './course-corpus'

export { listTools, getTool, runTool, toolSpecs, toolSchema, setToolGenerator } from './registry'
export { activeContext } from './context'
export type { Tool, ToolContext, ToolResult } from './types'
