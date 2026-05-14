import { useState } from 'react'

/* ─────────────────────────────────────────────────────────────
   Control. — AuthScreen
   Direction artistique : noir profond, glow blanc, glassmorphism,
   typo SF Pro, boutons blanc argenté façon Apple.
   ───────────────────────────────────────────────────────────── */

const IcEye = ({ off }) => off
  ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>

const IcUser = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
)
const IcMail = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
  </svg>
)
const IcLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
)
const IcGoogle = () => (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
  </svg>
)

/* ─── Champ texte premium ─────────────────────────────────────── */
const Field = ({ icon, type = 'text', value, onChange, placeholder, autoComplete }) => {
  const [show, setShow] = useState(false)
  const [focused, setFocused] = useState(false)
  const isPassword = type === 'password'

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${focused ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 14,
        transition: 'border-color .2s, background .2s',
        boxShadow: focused ? '0 0 0 4px rgba(255,255,255,0.04)' : 'none',
      }}
    >
      <span style={{ position: 'absolute', left: 16, color: focused ? '#E5E5EA' : '#6E6E73', display: 'flex', transition: 'color .2s' }}>
        {icon}
      </span>
      <input
        type={isPassword && show ? 'text' : type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize={type === 'email' ? 'none' : 'off'}
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderRadius: 14,
          padding: isPassword ? '16px 48px 16px 46px' : '16px 16px 16px 46px',
          fontSize: 16,
          fontWeight: 500,
          color: '#fff',
          outline: 'none',
          WebkitAppearance: 'none',
          boxSizing: 'border-box',
          letterSpacing: '-0.1px',
        }}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          style={{ position: 'absolute', right: 14, color: '#8E8E93', background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}
        >
          <IcEye off={show} />
        </button>
      )}
    </div>
  )
}

export default function AuthScreen({ onAuth }) {
  const [mode, setMode]           = useState('signup') // 'login' | 'signup' | 'confirm'
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [firstName, setFirstName] = useState('')
  const [username, setUsername]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const handleSubmit = async () => {
    setError('')
    if (!email || !password) { setError('Email et mot de passe requis.'); return }
    if (mode === 'signup' && (!firstName || !username)) { setError('Prénom et pseudo requis.'); return }
    if (mode === 'signup' && password.length < 6) { setError('Mot de passe : 6 caractères minimum.'); return }

    setLoading(true)
    const ok = await onAuth(mode, { email, password, firstName, username })
    setLoading(false)

    if (!ok.success) {
      setError(ok.error || 'Une erreur est survenue.')
    } else if (mode === 'signup' && ok.needsConfirm) {
      setMode('confirm')
    }
  }

  /* ─── Écran de confirmation email ─────────────────────────── */
  if (mode === 'confirm') {
    return (
      <div style={wrap}>
        <style>{globalStyles}</style>
        <Backdrop />
        <div style={inner} className="au-fade">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 32 }}>
            <Logo size={84} />
            <h2 style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.6px', margin: '24px 0 10px' }}>
              Vérifie ta messagerie
            </h2>
            <p style={{ fontSize: 15, color: '#8E8E93', lineHeight: 1.5, margin: 0, maxWidth: 300 }}>
              Un lien de confirmation a été envoyé à<br/>
              <strong style={{ color: '#E5E5EA', fontWeight: 600 }}>{email}</strong>
            </p>
          </div>
          <div style={card}>
            <button onClick={() => setMode('login')} style={btnSecondary}>
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ─── Écran principal (login / signup) ─────────────────────── */
  return (
    <div style={wrap}>
      <style>{globalStyles}</style>
      <Backdrop />

      <div style={inner} className="au-fade">
        {/* ── Logo + Wordmark ────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 32 }}>
          <Logo size={96} />
          <h1 className="wordmark" style={{
            fontSize: 56,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '-2.4px',
            margin: '18px 0 6px',
            lineHeight: 1,
          }}>
            Control<span style={{ color: '#fff' }}>.</span>
          </h1>
          <p style={{
            fontSize: 15,
            color: '#8E8E93',
            margin: 0,
            textAlign: 'center',
            letterSpacing: '-0.1px',
            fontWeight: 400,
          }}>
            Reprenez le contrôle de vos finances.
          </p>
        </div>

        {/* ── Carte glass ────────────────────────────────────── */}
        <div style={card}>
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', margin: 0, marginBottom: 6 }}>
              {mode === 'login' ? 'Se connecter' : 'Créer un compte'}
            </h2>
            <p style={{ fontSize: 14, color: '#8E8E93', margin: 0, letterSpacing: '-0.1px' }}>
              {mode === 'login' ? 'Bon retour parmi nous.' : 'Commencez gratuitement.'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'signup' && (
              <>
                <Field icon={<IcUser/>} value={firstName} onChange={setFirstName} placeholder="Prénom" autoComplete="given-name" />
                <Field icon={<IcUser/>} value={username}  onChange={setUsername}  placeholder="Pseudo"  autoComplete="username" />
              </>
            )}
            <Field icon={<IcMail/>} type="email"    value={email}    onChange={setEmail}    placeholder="Adresse e-mail" autoComplete="email" />
            <Field icon={<IcLock/>} type="password" value={password} onChange={setPassword} placeholder="Mot de passe"   autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>

          {error && (
            <div style={{
              marginTop: 14,
              padding: '12px 14px',
              background: 'rgba(255,69,58,0.08)',
              borderRadius: 12,
              border: '1px solid rgba(255,69,58,0.18)',
              fontSize: 13,
              color: '#FF6961',
              textAlign: 'center',
              letterSpacing: '-0.1px',
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ ...btnPrimary, marginTop: 18, opacity: loading ? 0.7 : 1 }}
          >
            {loading
              ? <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid rgba(0,0,0,0.25)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}/>
              : (mode === 'login' ? 'Se connecter' : 'Créer mon compte')
            }
          </button>

          {/* ── Séparateur ──────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            <span style={{ fontSize: 12, color: '#6E6E73', letterSpacing: '0.04em' }}>ou</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>

          <button style={btnGoogle} disabled>
            <IcGoogle />
            <span>Continuer avec Google</span>
          </button>
        </div>

        {/* ── Toggle login/signup ────────────────────────────── */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <span style={{ fontSize: 14, color: '#8E8E93', letterSpacing: '-0.1px' }}>
            {mode === 'login' ? 'Vous n\'avez pas de compte ? ' : 'Vous avez déjà un compte ? '}
          </span>
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
            style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '-0.1px' }}
          >
            {mode === 'login' ? 'S\'inscrire' : 'Se connecter'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Composants visuels ──────────────────────────────────────── */
const Logo = ({ size = 96 }) => (
  <div style={{
    position: 'relative',
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }}>
    <div style={{
      position: 'absolute',
      inset: -20,
      background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)',
      filter: 'blur(12px)',
      pointerEvents: 'none',
    }} />
    <img
      src="/logo.png"
      alt="Control."
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.235,
        position: 'relative',
        boxShadow: '0 20px 60px -10px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
        objectFit: 'cover',
      }}
    />
  </div>
)

const Backdrop = () => (
  <div style={{
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    background:
      'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 60%),' +
      'radial-gradient(ellipse 60% 40% at 100% 100%, rgba(255,255,255,0.025) 0%, transparent 70%),' +
      'radial-gradient(ellipse 50% 40% at 0% 60%, rgba(255,255,255,0.02) 0%, transparent 70%)',
    zIndex: 0,
  }} />
)

/* ─── Styles ───────────────────────────────────────────────────── */
const wrap = {
  minHeight: '100vh',
  background: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px 20px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", sans-serif',
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  position: 'relative',
  overflow: 'hidden',
}

const inner = {
  width: '100%',
  maxWidth: 400,
  position: 'relative',
  zIndex: 1,
}

const card = {
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: 24,
  padding: 24,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: '0 24px 60px -20px rgba(0,0,0,0.6)',
}

const btnPrimary = {
  width: '100%',
  padding: '16px',
  background: 'linear-gradient(180deg, #FAFAFA 0%, #C7C7CC 100%)',
  border: '1px solid rgba(255,255,255,0.4)',
  borderRadius: 14,
  fontSize: 16,
  fontWeight: 600,
  color: '#000',
  cursor: 'pointer',
  letterSpacing: '-0.2px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  transition: 'opacity 0.15s, transform 0.15s',
  boxShadow: '0 4px 20px -4px rgba(255,255,255,0.15), inset 0 1px 0 rgba(255,255,255,0.6)',
}

const btnSecondary = {
  width: '100%',
  padding: '16px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  cursor: 'pointer',
  touchAction: 'manipulation',
  letterSpacing: '-0.1px',
}

const btnGoogle = {
  width: '100%',
  padding: '14px',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  touchAction: 'manipulation',
  letterSpacing: '-0.1px',
  opacity: 0.85,
}

const globalStyles = `
  input::placeholder { color: #5C5C61; font-weight: 500; }
  input:-webkit-autofill {
    -webkit-box-shadow: 0 0 0 100px rgba(20,20,22,1) inset !important;
    -webkit-text-fill-color: #fff !important;
    caret-color: #fff;
    border-radius: 14px;
  }
  @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .au-fade { animation: fadeUp 0.55s cubic-bezier(.22,1,.36,1) both; }
  .wordmark {
    text-shadow: 0 0 40px rgba(255,255,255,0.15), 0 0 80px rgba(255,255,255,0.08);
  }
`
