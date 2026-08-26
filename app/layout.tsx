import React from 'react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import localFont from 'next/font/local'
import {
  JetBrains_Mono,
  Roboto,
  Open_Sans,
  Lato,
  Montserrat,
  Merriweather,
  Playfair_Display,
  Nunito,
  Raleway,
  Arimo,
  Tinos,
  Cousine,
  Gelasio,
  Oswald,
  Anton,
  EB_Garamond,
  Cormorant_Garamond,
  Caveat,
  Comic_Neue,
  Noto_Sans,
} from 'next/font/google'
import { ConsentedAnalytics } from '@/components/legal/consented-analytics'
import { TermsGate } from '@/components/legal/terms-gate'
import { StorageNotice } from '@/components/legal/storage-notice'
import { ThemeProvider } from '@/components/theme-provider'
import { PwaRegister } from '@/components/pwa-register'
import { WheelToHorizontal } from '@/components/wheel-to-horizontal'
import { RouteLoader } from '@/components/route-loader'
import { InstallPrompt } from '@/components/install-prompt'
import { Toaster } from '@/components/ui/sonner'
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

// ── Opt-in typography fonts ─────────────────────────────────────────────────
// preload:false → no <link rel="preload"> is added to the document head.
// The browser only fetches a font file when it encounters text that uses it
// (via font-family in CSS), so these are zero-cost until a user actually
// applies one to a text object. display:'swap' keeps text readable (FOUT)
// while the file arrives instead of hiding it (FOIT).
const roboto = Roboto({ subsets: ['latin'], weight: ['300','400','500','700','900'], variable: '--font-roboto', preload: false, display: 'swap' })
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans', preload: false, display: 'swap' })
const lato = Lato({ subsets: ['latin'], weight: ['300','400','700','900'], variable: '--font-lato', preload: false, display: 'swap' })
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', preload: false, display: 'swap' })
const merriweather = Merriweather({ subsets: ['latin'], weight: ['300','400','700','900'], variable: '--font-merriweather', preload: false, display: 'swap' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', preload: false, display: 'swap' })
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', preload: false, display: 'swap' })
const raleway = Raleway({ subsets: ['latin'], variable: '--font-raleway', preload: false, display: 'swap' })

// ── Web-safe font backing ───────────────────────────────────────────────────
// The "web-safe" families in TEXT_FONTS (Arial, Verdana, Impact, Papyrus…)
// are only web-safe on a machine that happens to have them installed, which
// is a Windows/macOS assumption. On Linux — and on any machine missing one —
// the whole stack falls through to the generic keyword and the text renders
// as ordinary sans, so picking "Impact" or "Papyrus" visibly did NOTHING.
// Confirmed locally with fc-match: Verdana, Tahoma, Trebuchet, Impact,
// Garamond, Copperplate, Brush Script and Papyrus all resolved to Noto Sans.
//
// Each is now backed by a real webfont appended to its stack, so an installed
// local copy still wins (identical rendering where it already worked) and
// everyone else gets something with the right character instead of a silent
// no-op.
//
// The first four are METRIC-COMPATIBLE clones — same advance widths as the
// fonts they stand in for, so line breaks and measured box heights do not
// shift for documents authored on a machine that had the originals. They are
// also exactly what fontconfig already substitutes locally.
const arimo = Arimo({ subsets: ['latin'], variable: '--font-arimo', preload: false, display: 'swap' })         // Arial / Helvetica
const tinos = Tinos({ subsets: ['latin'], weight: ['400','700'], variable: '--font-tinos', preload: false, display: 'swap' })      // Times New Roman
const cousine = Cousine({ subsets: ['latin'], weight: ['400','700'], variable: '--font-cousine', preload: false, display: 'swap' }) // Courier New
const gelasio = Gelasio({ subsets: ['latin'], variable: '--font-gelasio', preload: false, display: 'swap' })   // Georgia
// Not metric-compatible, chosen for matching CHARACTER instead: a condensed
// grotesque for Impact, garaldes for Garamond/Palatino/Bookman, a casual
// script for Comic Sans/Brush Script.
const oswald = Oswald({ subsets: ['latin'], variable: '--font-oswald', preload: false, display: 'swap' })      // Impact (condensed)
const anton = Anton({ subsets: ['latin'], weight: '400', variable: '--font-anton', preload: false, display: 'swap' }) // Impact (heavy display)
const ebGaramond = EB_Garamond({ subsets: ['latin'], variable: '--font-eb-garamond', preload: false, display: 'swap' }) // Garamond
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['300','400','500','600','700'], variable: '--font-cormorant', preload: false, display: 'swap' }) // Palatino / Bookman
const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', preload: false, display: 'swap' })      // Brush Script
const comicNeue = Comic_Neue({ subsets: ['latin'], weight: ['300','400','700'], variable: '--font-comic-neue', preload: false, display: 'swap' }) // Comic Sans
// Verdana/Tahoma/Trebuchet are humanist sans with no free metric clone; Noto
// Sans is the closest widely-available match and is what fontconfig already
// falls back to for them, so this makes the existing behaviour explicit
// rather than accidental.
const notoSans = Noto_Sans({ subsets: ['latin'], variable: '--font-noto-sans', preload: false, display: 'swap' })

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://simblip.rohan-singh.com.np'
  
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'SIMBLIP — The Engineering Notebook That Simulates',
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
  // iOS/macOS Safari ignore manifest.ts's display:'standalone' for "Add to
  // Home Screen" — without this, an installed SIMBLIP still shows Safari's
  // URL bar/chrome instead of launching as a real standalone window.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SIMBLIP',
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
  viewportFit: 'cover',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Reading the CSP nonce here (set by proxy.ts) is what makes Next apply it
  // to its own inline hydration scripts — see proxy.ts. next-themes injects
  // its own no-flash inline script outside that mechanism, so it needs the
  // nonce passed explicitly too.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={[
          jakarta.variable,
          jetbrainsMono.variable,
          roboto.variable,
          openSans.variable,
          lato.variable,
          montserrat.variable,
          merriweather.variable,
          playfair.variable,
          nunito.variable,
          raleway.variable,
          arimo.variable,
          tinos.variable,
          cousine.variable,
          gelasio.variable,
          oswald.variable,
          anton.variable,
          ebGaramond.variable,
          cormorant.variable,
          caveat.variable,
          comicNeue.variable,
          notoSans.variable,
          'font-sans antialiased',
        ].join(' ')}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
          themes={[
            'light',
            'sepia',
            'lily',
            'solarized',
            'sea',
            'im-just-a-girl',
            'dark',
            'dim',
            'midnight',
            'contrast',
            'mountains',
            'diva',
            'system',
          ]}
        >
          {children}
          {/* Terms first, then the storage notice — both no-op until an
              account is signed in, and both skip room-board displays. */}
          <TermsGate />
          <StorageNotice />
          <RouteLoader />
          <Toaster position="bottom-right" />
        </ThemeProvider>
        <WheelToHorizontal />
        <PwaRegister />
        <InstallPrompt />
        <ConsentedAnalytics />
      </body>
    </html>
  )
}
