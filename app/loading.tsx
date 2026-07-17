// Global route-transition loader — a branded liquid-glass mark with a soft
// orbital sweep. Reduced motion gets a static fade, not a spinner.

export default function Loading() {
  return (
    <div className="canvas-dots flex h-dvh items-center justify-center bg-background [background-size:24px_24px]">
      <style>{`
        @keyframes sl-orbit { to { transform: rotate(360deg) } }
        @keyframes sl-breathe { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .sl-ring { animation: none !important; opacity: .4 }
          .sl-mark { animation: none !important }
        }
      `}</style>
      <div className="liquid-glass relative flex h-28 w-28 items-center justify-center rounded-[2rem]">
        <span
          className="sl-ring absolute inset-2 rounded-[1.6rem] border-2 border-transparent"
          style={{
            borderTopColor: 'var(--accent-blue)',
            animation: 'sl-orbit 1.1s linear infinite',
          }}
        />
        <span
          className="sl-mark text-[15px] font-extrabold tracking-tight"
          style={{ animation: 'sl-breathe 1.6s ease-in-out infinite' }}
        >
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
      </div>
    </div>
  )
}
