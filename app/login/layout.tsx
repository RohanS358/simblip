import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false }, // account page, nothing to index
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
