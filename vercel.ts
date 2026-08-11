import type { VercelConfig } from '@vercel/config/v1'

// Function region pinned to Mumbai: users are in Nepal/India, and the
// project was defaulting to iad1 (US East) — every board-live WebSocket
// message and DB round-trip was paying a full India<->US Atlantic hop, the
// dominant cost behind "live sync is laggy" (single-digit ms once
// connected, ~1s+ during handshake/auth against the far region).
export const config: VercelConfig = {
  regions: ['bom1'],
}
