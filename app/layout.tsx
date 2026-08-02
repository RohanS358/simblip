import React from 'react'
import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { PwaRegister } from '@/components/pwa-register'
import { Toaster } from '@/components/ui/sonner'
import 'katex/dist/katex.min.css'
import './globals.css'

const jakarta = localFont({
  src: [
    {
      path: '../public/fonts/PlusJakartaSans-Variable.woff2',
      weight: '200 800',
      style: 'normal',
    },
    {
      path: '../public/fonts/PlusJakartaSans-Italic-Variable.woff2',
      weight: '200 800',
      style: 'italic',
    },
  ],
  variable: '--font-jakarta',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://simblip.rohan-singh.com.np'
  
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'SIMBLIP',
    template: '%s · SIMBLIP',
  },
  description:
    'Notes, live physics simulations, circuits, equations and graphs on one infinite canvas. Draw a shape, give it a behavior, press Play — the engineering operating system for students. Built by Rohan Singh.',
  applicationName: 'SIMBLIP',
  authors: [{ name: 'Rohan Singh', url: 'https://github.com/RohanS358' }],
  creator: 'Rohan Singh',
  publisher: 'Rohan Singh',
  keywords: [
    'engineering notebook',
    'physics simulation',
    'circuit simulator',
    'infinite canvas',
    'interactive physics',
    'STEM education',
    'live graphs',
    'formula engine',
    'mechanics simulator',
    'digital logic simulator',
    'SIMBLIP',
    'Rohan Singh',
  ],
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'SIMBLIP',
    title: 'SIMBLIP — The Engineering Notebook That Simulates',
    description:
      'Draw it. Behave it. Play it. Notes, simulations, circuits, equations and live graphs on one infinite canvas.',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SIMBLIP — The Engineering Notebook That Simulates',
    description:
      'Notes, physics simulations, circuits and live graphs on one infinite canvas. Built by Rohan Singh.',
    creator: '@RohanSingh',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  icons: {
    icon: [
      { url: '/logo.png', media: '(prefers-color-scheme: light)' },
      { url: '/logo.png', media: '(prefers-color-scheme: dark)' },
    ],
    apple: '/apple-icon.png',
  },
  category: 'education',
  // Drop a Search Console verification code in .env as
  // NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION to prove ownership without another
  // deploy — unindexed is far more often "never verified/submitted" than a
  // markup problem.
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          themes={['light', 'sepia', 'lily', 'dark', 'dim', 'midnight', 'contrast', 'system']}
        >
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
        <PwaRegister />
        <Analytics />
      </body>
    </html>
  )
}
