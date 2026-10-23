// The signed-in user's token for /api/ai, which refuses anonymous callers on a cloud deployment
// (lib/server/ai-guard.ts). On a local install there is no server-side account; the header is harmless there.

import { getAccessToken } from '@/lib/auth/store'

export function aiAuthHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** What to tell the person when the server turns an AI request away. */
export async function describeAiRefusal(res: Response): Promise<string> {
  let said = ''
  try {
    said = String(((await res.json()) as { error?: unknown })?.error ?? '')
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return said || 'Sign in again to use the AI assistant.'
  if (res.status === 429) {
    const wait = res.headers.get('Retry-After')
    return `${said || 'Too many AI requests.'}${wait ? ` Try again in ${wait} s.` : ''}`
  }
  if (res.status === 413) return 'That request is too large for the AI assistant.'
  return said || `The AI assistant could not answer (error ${res.status}).`
}
