'use client'

import { motion as fm } from 'framer-motion'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export function TahoeWaves({
  height = 180,
  className = '',
}: {
  height?: number
  className?: string
}) {
  const { theme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const currentTheme = mounted ? (theme === 'system' ? resolvedTheme : theme) ?? 'light' : 'light'

  // Dynamic theme-specific wave palettes matching SIMBLIP global themes (sea, mountains, etc.)
  const isSea = currentTheme === 'sea'
  const isMountain = currentTheme === 'mountains' || currentTheme === 'mountain'
  const isLily = currentTheme === 'lily' || currentTheme === 'im-just-a-girl'
  const isSepia = currentTheme === 'sepia'
  const isSolarized = currentTheme === 'solarized'
  const isDiva = currentTheme === 'diva'
  const isDarkFamily =
    currentTheme === 'dark' ||
    currentTheme === 'midnight' ||
    currentTheme === 'dim' ||
    currentTheme === 'contrast'

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 overflow-hidden ${className}`}
      style={{ height }}
    >
      {/* Frosted Glass Gradient Meshes / Ambient Glow according to theme */}
      <div className="absolute inset-0 bg-gradient-to-b from-rose-200/30 via-amber-100/15 to-transparent dark:from-rose-950/20 dark:via-purple-950/15 dark:to-transparent backdrop-blur-[2px]" />

      <svg
        className="h-full w-full object-cover"
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="tahoe-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop
              offset="0%"
              stopColor={
                isSea
                  ? '#0284c7'
                  : isMountain
                  ? '#0f766e'
                  : isLily
                  ? '#ec4899'
                  : isSepia
                  ? '#d97706'
                  : isSolarized
                  ? '#b58900'
                  : isDiva
                  ? '#7c3aed'
                  : isDarkFamily
                  ? '#881337'
                  : 'var(--accent-rose, #fca5a5)'
              }
              stopOpacity={isDarkFamily ? '0.85' : '0.75'}
            />
            <stop
              offset="50%"
              stopColor={
                isSea
                  ? '#06b6d4'
                  : isMountain
                  ? '#047857'
                  : isLily
                  ? '#f43f5e'
                  : isSepia
                  ? '#b45309'
                  : isSolarized
                  ? '#cb4b16'
                  : isDiva
                  ? '#c026d3'
                  : isDarkFamily
                  ? '#581c87'
                  : 'var(--accent-violet, #f472b6)'
              }
              stopOpacity={isDarkFamily ? '0.75' : '0.65'}
            />
            <stop
              offset="100%"
              stopColor={
                isSea
                  ? '#10b981'
                  : isMountain
                  ? '#115e59'
                  : isLily
                  ? '#fb923c'
                  : isSepia
                  ? '#78350f'
                  : isSolarized
                  ? '#2aa198'
                  : isDiva
                  ? '#4c1d95'
                  : isDarkFamily
                  ? '#1e3a8a'
                  : 'var(--accent-amber, #fb923c)'
              }
              stopOpacity={isDarkFamily ? '0.8' : '0.7'}
            />
          </linearGradient>

          <linearGradient id="tahoe-grad-2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop
              offset="0%"
              stopColor={
                isSea
                  ? '#38bdf8'
                  : isMountain
                  ? '#334155'
                  : isLily
                  ? '#fbcfe8'
                  : isSepia
                  ? '#f59e0b'
                  : isSolarized
                  ? '#859900'
                  : isDiva
                  ? '#a855f7'
                  : isDarkFamily
                  ? '#4c0519'
                  : 'var(--accent-blue, #60a5fa)'
              }
              stopOpacity={isDarkFamily ? '0.8' : '0.6'}
            />
            <stop
              offset="100%"
              stopColor={
                isSea
                  ? '#34d399'
                  : isMountain
                  ? '#065f46'
                  : isLily
                  ? '#fecdd3'
                  : isSepia
                  ? '#92400e'
                  : isSolarized
                  ? '#268bd2'
                  : isDiva
                  ? '#e11d48'
                  : isDarkFamily
                  ? '#312e81'
                  : 'var(--accent-amber, #fed7aa)'
              }
              stopOpacity={isDarkFamily ? '0.65' : '0.55'}
            />
          </linearGradient>

          <linearGradient id="tahoe-grad-3" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop
              offset="0%"
              stopColor={
                isSea
                  ? '#0ea5e9'
                  : isMountain
                  ? '#475569'
                  : isLily
                  ? '#fda4af'
                  : isSepia
                  ? '#d97706'
                  : isSolarized
                  ? '#d33682'
                  : isDiva
                  ? '#9333ea'
                  : isDarkFamily
                  ? '#9f1239'
                  : 'var(--accent-mint, #34d399)'
              }
              stopOpacity="0.45"
            />
            <stop
              offset="100%"
              stopColor={
                isSea
                  ? '#059669'
                  : isMountain
                  ? '#10b981'
                  : isLily
                  ? '#fb7185'
                  : isSepia
                  ? '#451a03'
                  : isSolarized
                  ? '#6c71c4'
                  : isDiva
                  ? '#581c87'
                  : isDarkFamily
                  ? '#78350f'
                  : 'var(--accent-violet, #fb7185)'
              }
              stopOpacity="0.5"
            />
          </linearGradient>

          {/* Frosted Glass Specular Filter */}
          <filter id="frosted-glass-blur">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            />
          </filter>
        </defs>

        {/* Moving Wave Layer 1 */}
        <fm.path
          d="M -100 0 L 1100 0 L 1100 170 C 850 230, 650 90, 450 160 C 250 230, 100 120, -100 190 Z"
          className="fill-[url(#tahoe-grad-1)]"
          animate={{
            d: [
              'M -100 0 L 1100 0 L 1100 170 C 850 230, 650 90, 450 160 C 250 230, 100 120, -100 190 Z',
              'M -100 0 L 1100 0 L 1100 190 C 880 130, 620 230, 420 120 C 220 180, 80 230, -100 150 Z',
              'M -100 0 L 1100 0 L 1100 150 C 830 210, 670 110, 470 180 C 270 210, 120 140, -100 180 Z',
              'M -100 0 L 1100 0 L 1100 170 C 850 230, 650 90, 450 160 C 250 230, 100 120, -100 190 Z',
            ],
          }}
          transition={{
            duration: 16,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Moving Wave Layer 2 */}
        <fm.path
          d="M -100 0 L 1100 0 L 1100 130 C 880 190, 680 70, 420 130 C 220 190, 60 100, -100 140 Z"
          className="fill-[url(#tahoe-grad-2)] opacity-85"
          animate={{
            d: [
              'M -100 0 L 1100 0 L 1100 130 C 880 190, 680 70, 420 130 C 220 190, 60 100, -100 140 Z',
              'M -100 0 L 1100 0 L 1100 150 C 820 90, 640 180, 390 100 C 190 150, 40 170, -100 120 Z',
              'M -100 0 L 1100 0 L 1100 110 C 860 170, 690 90, 450 150 C 250 170, 80 110, -100 135 Z',
              'M -100 0 L 1100 0 L 1100 130 C 880 190, 680 70, 420 130 C 220 190, 60 100, -100 140 Z',
            ],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Moving Wave Layer 3 */}
        <fm.path
          d="M -100 0 L 1100 0 L 1100 90 C 820 140, 600 60, 380 110 C 180 150, 40 80, -100 100 Z"
          className="fill-[url(#tahoe-grad-3)] opacity-60"
          animate={{
            d: [
              'M -100 0 L 1100 0 L 1100 90 C 820 140, 600 60, 380 110 C 180 150, 40 80, -100 100 Z',
              'M -100 0 L 1100 0 L 1100 120 C 780 70, 560 140, 340 80 C 150 120, 20 130, -100 80 Z',
              'M -100 0 L 1100 0 L 1100 90 C 820 140, 600 60, 380 110 C 180 150, 40 80, -100 100 Z',
            ],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Animated Contour Lines */}
        <fm.path
          d="M -50 175 C 180 120, 360 220, 580 130 C 760 60, 920 180, 1050 140"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={isDarkFamily ? 'text-white/80' : 'text-stone-900/80'}
          animate={{
            d: [
              'M -50 175 C 180 120, 360 220, 580 130 C 760 60, 920 180, 1050 140',
              'M -50 150 C 160 190, 380 110, 610 180 C 790 120, 940 140, 1050 165',
              'M -50 175 C 180 120, 360 220, 580 130 C 760 60, 920 180, 1050 140',
            ],
          }}
          transition={{
            duration: 14,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        <fm.path
          d="M -50 195 C 150 150, 340 240, 550 160 C 740 90, 890 205, 1050 165"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          className={isDarkFamily ? 'text-white/50' : 'text-stone-900/60'}
          animate={{
            d: [
              'M -50 195 C 150 150, 340 240, 550 160 C 740 90, 890 205, 1050 165',
              'M -50 170 C 140 210, 360 140, 570 200 C 760 130, 910 170, 1050 185',
              'M -50 195 C 150 150, 340 240, 550 160 C 740 90, 890 205, 1050 165',
            ],
          }}
          transition={{
            duration: 11,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        <fm.path
          d="M -50 215 C 200 180, 420 260, 640 180 C 800 130, 940 220, 1050 195"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          className={isDarkFamily ? 'text-white/30' : 'text-stone-900/35'}
          animate={{
            d: [
              'M -50 215 C 200 180, 420 260, 640 180 C 800 130, 940 220, 1050 195',
              'M -50 190 C 180 230, 400 170, 620 220 C 780 150, 930 190, 1050 210',
              'M -50 215 C 200 180, 420 260, 640 180 C 800 130, 940 220, 1050 195',
            ],
          }}
          transition={{
            duration: 13,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </svg>

      {/* Frosted Glass Overlay with Highlight Shine */}
      <div className="absolute inset-0 bg-white/10 backdrop-blur-[1.5px] dark:bg-black/10" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/15" />
    </div>
  )
}
