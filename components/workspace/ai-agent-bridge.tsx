'use client'

// Mounts the MCP bridge for as long as "AI agents" is switched on. Renders
// nothing.

import { useEffect } from 'react'
import { refreshBridgeTools, startBridge, stopBridge, useBridge } from '@/lib/tools/bridge'
import { registerWebMcp, unregisterWebMcp } from '@/lib/tools/webmcp'

export function AiAgentBridge() {
  const mode = useBridge((s) => s.mode)
  useEffect(() => {
    if (mode === 'off') {
      stopBridge()
      unregisterWebMcp()
      return
    }
    startBridge()
    refreshBridgeTools()
    registerWebMcp(mode)
    return () => unregisterWebMcp()
  }, [mode])
  useEffect(() => stopBridge, [])
  return null
}
