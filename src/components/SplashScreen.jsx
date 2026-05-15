import { useEffect, useState } from 'react'

/* ─────────────────────────────────────────────────────────────
   Control. — SplashScreen
   Écran d'ouverture premium façon Apple / fintech moderne.
   Logo apparaît, scale léger, flare discret, baseline.
   Transition fluide vers l'app.
   ───────────────────────────────────────────────────────────── */

export default function SplashScreen({ onDone, duration = 1900 }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), duration)
    const t2 = setTimeout(() => onDone?.(), duration + 520)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone, duration])

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      zIndex: 9999,
      opacity: leaving ? 0 : 1,
      transition: 'opacity 500ms cubic-bezier(.22,1,.36,1)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", sans-serif',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      pointerEvents: leaving ? 'none' : 'auto',
    }}>
      <style>{`
        @keyframes splashLogoIn {
          0%   { opacity: 0; transform: scale(0.86); }
          55%  { opacity: 1; }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes splashHaloIn {
          0%   { opacity: 0; transform: scale(0.7); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes splashTextIn {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes splashFlare {
          0%   { transform: translateX(0)    skewX(-18deg); opacity: 0; }
          15%  { opacity: 1; }
          60%  { transform: translateX(260%) skewX(-18deg); opacity: 1; }
          75%  { transform: translateX(260%) skewX(-18deg); opacity: 0; }
          100% { transform: translateX(260%) skewX(-18deg); opacity: 0; }
        }
        .splash-logo-wrap { animation: splashLogoIn 1100ms cubic-bezier(.22,1,.36,1) both; }
        .splash-halo      { animation: splashHaloIn 1300ms cubic-bezier(.22,1,.36,1) both; }
        .splash-text      { animation: splashTextIn 700ms cubic-bezier(.22,1,.36,1) 600ms both; }
        .splash-flare     { animation: splashFlare 2200ms cubic-bezier(.4,0,.2,1) 700ms both; }
      `}</style>

      {/* Backdrop subtil */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(ellipse 70% 50% at 50% 45%, rgba(255,255,255,0.05) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />

      {/* Logo */}
      <div className="splash-logo-wrap" style={{
        position: 'relative',
        width: 112,
        height: 112,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {/* Halo */}
        <div className="splash-halo" style={{
          position: 'absolute',
          inset: -28,
          background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 70%)',
          filter: 'blur(16px)',
          pointerEvents: 'none',
        }} />
        {/* Logo + flare */}
        <div style={{
          position: 'relative',
          width: 112,
          height: 112,
          borderRadius: 26,
          overflow: 'hidden',
          boxShadow: '0 24px 70px -12px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.05)',
        }}>
          <img
            src="/logo.png"
            alt="Control."
            width={112}
            height={112}
            style={{ width: 112, height: 112, display: 'block', objectFit: 'cover' }}
          />
          <div className="splash-flare" style={{
            position: 'absolute',
            top: 0,
            left: '-60%',
            width: '50%',
            height: '100%',
            background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.34) 50%, rgba(255,255,255,0.18) 55%, transparent 70%)',
            filter: 'blur(2px)',
            pointerEvents: 'none',
            mixBlendMode: 'screen',
          }} />
        </div>
      </div>

      {/* Baseline */}
      <p className="splash-text" style={{
        marginTop: 28,
        fontSize: 15,
        color: '#8E8E93',
        letterSpacing: '-0.1px',
        fontWeight: 400,
        textAlign: 'center',
      }}>
        Reprenez le contrôle de vos finances.
      </p>
    </div>
  )
}
