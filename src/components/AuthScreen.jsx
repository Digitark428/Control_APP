import { useState } from 'react'

const IcEye     = ({ off }) => off
  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>

const IcLogo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
    <rect width="32" height="32" rx="10" fill="url(#g)"/>
    <path d="M8 22l4-12 4 8 3-5 5 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stopColor="#30D158"/>
        <stop offset="1" stopColor="#00A342"/>
      </linearGradient>
    </defs>
  </svg>
)

const Field = ({ label, type = 'text', value, onChange, placeholder, action }) => {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#636366', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type={isPassword && show ? 'text' : type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize={type === 'email' ? 'none' : 'words'}
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: '100%',
            background: '#1C1C1E',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: isPassword ? '14px 44px 14px 16px' : '14px 16px',
            fontSize: 16,
            color: '#fff',
            outline: 'none',
            WebkitAppearance: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => { e.target.style.borderColor = 'rgba(48,209,88,0.5)'; e.target.style.boxShadow = '0 0 0 3px rgba(48,209,88,0.08)' }}
          onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = 'none' }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            style={{ position: 'absolute', right: 14, color: '#636366', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
          >
            <IcEye off={show} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'confirm'
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [firstName, setFirstName] = useState('')
  const [username, setUsername]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const handleSubmit = async () => {
    setError('')
    if (!email || !password) { setError('Email et mot de passe requis.'); return }
    if (mode === 'signup' && (!firstName || !username)) { setError('Prénom et nom d\'utilisateur requis.'); return }
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

  if (mode === 'confirm') {
    return (
      <div style={wrap}>
        <div style={inner}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 40 }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(48,209,88,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', margin: 0, marginBottom: 10 }}>Vérifie ta messagerie</h2>
            <p style={{ fontSize: 15, color: '#8E8E93', lineHeight: 1.5, margin: 0, maxWidth: 280 }}>
              Un lien de confirmation a été envoyé à <strong style={{ color: '#C7C7CC' }}>{email}</strong>.<br/>Clique dessus pour activer ton compte.
            </p>
          </div>
          <button onClick={() => setMode('login')} style={btnSecondary}>
            Retour à la connexion
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <style>{`
        input::placeholder { color: #48484A; }
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0 100px #1C1C1E inset !important; -webkit-text-fill-color: #fff !important; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        .au { animation: fadeUp 0.45s cubic-bezier(.22,1,.36,1) both; }
      `}</style>

      <div style={inner} className="au">
        {/* Logo + titre */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 36 }}>
          <IcLogo />
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.8px', margin: '14px 0 6px' }}>
            {mode === 'login' ? 'Bon retour 👋' : 'Créer un compte'}
          </h1>
          <p style={{ fontSize: 15, color: '#8E8E93', margin: 0, textAlign: 'center' }}>
            {mode === 'login' ? 'Connecte-toi à ton espace financier' : 'Ton espace financier personnel'}
          </p>
        </div>

        {/* Formulaire */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mode === 'signup' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Prénom" value={firstName} onChange={setFirstName} placeholder="Marie" />
              <Field label="Pseudo" value={username} onChange={setUsername} placeholder="@marie" />
            </div>
          )}
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="marie@exemple.fr" />
          <Field label="Mot de passe" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
        </div>

        {/* Erreur */}
        {error && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,69,58,0.1)', borderRadius: 12, border: '1px solid rgba(255,69,58,0.2)', fontSize: 13, color: '#FF453A', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ ...btnPrimary, marginTop: 24, opacity: loading ? 0.6 : 1 }}
        >
          {loading
            ? <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}/>
            : (mode === 'login' ? 'Se connecter' : 'Créer mon compte')
          }
        </button>

        {/* Toggle mode */}
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <span style={{ fontSize: 14, color: '#8E8E93' }}>
            {mode === 'login' ? 'Pas encore de compte ? ' : 'Déjà un compte ? '}
          </span>
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
            style={{ fontSize: 14, fontWeight: 600, color: '#30D158', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {mode === 'login' ? 'S\'inscrire' : 'Se connecter'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
    </div>
  )
}

const wrap = {
  minHeight: '100vh',
  background: '#000',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 20px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
  WebkitFontSmoothing: 'antialiased',
}

const inner = {
  width: '100%',
  maxWidth: 380,
}

const btnPrimary = {
  width: '100%',
  padding: '16px',
  background: '#30D158',
  border: 'none',
  borderRadius: 16,
  fontSize: 16,
  fontWeight: 700,
  color: '#000',
  cursor: 'pointer',
  letterSpacing: '-0.2px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  transition: 'opacity 0.15s',
}

const btnSecondary = {
  width: '100%',
  padding: '16px',
  background: '#1C1C1E',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  cursor: 'pointer',
  touchAction: 'manipulation',
}
