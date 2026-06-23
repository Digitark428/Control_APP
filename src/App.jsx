import React, { useState, useEffect, useMemo, useRef } from 'react';
import { loadState, saveState, deleteAccountData } from './lib/db';
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import SplashScreen from './components/SplashScreen';
import { LegalModal } from './components/Legal';
import { Plus, ChevronLeft, ChevronRight, X, Trash2, Wallet, Edit3, Check, Home, BarChart3, Receipt, Sliders, AlertCircle, Power, Bell, Clock, FileText, EyeOff, ShoppingBag, User, TrendingUp, Users, Camera, Lock, Mail, Target, Download, AlertTriangle, Calendar, Shield, ScrollText } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const MONTHS_SHORT = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const DEFAULT_ACTIVITIES = [];
const DEFAULT_CATEGORIES = [];
const DEFAULT_EXPENSES = [];
const SEED_TRANSACTIONS = [];
const DEFAULT_VAR_CATEGORIES = [
  { id: 'essence',    name: 'Essence',      color: '#FF9F0A', order: 1 },
  { id: 'boissons',   name: 'Boissons',     color: '#30D158', order: 2 },
  { id: 'encas',      name: 'Encas',        color: '#FF6B35', order: 3 },
  { id: 'parking',    name: 'Parking',      color: '#636366', order: 4 },
  { id: 'depropro',   name: 'Dépenses pro', color: '#5E5CE6', order: 5 },
  { id: 'courses',    name: 'Courses',      color: '#34C759', order: 6 },
  { id: 'restaurants',name: 'Restaurants',  color: '#FF453A', order: 7 },
  { id: 'loisirs',    name: 'Loisirs',      color: '#BF5AF2', order: 8 },
];

const STORAGE_KEY = 'finapp_state_v2';
const LEGACY_KEY = 'finapp_state_v1';
const TODAY = new Date();
const TODAY_MONTH = TODAY.getMonth();
const TODAY_YEAR = TODAY.getFullYear();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Flag global pour le toggle "Afficher les décimales".
// Maintenu en sync avec state.settings.showDecimals via useEffect dans App.
// - ON  : tous les montants affichent 2 décimales (1 250,42 €)
// - OFF : tous les montants affichent 0 décimale (1 250 €)
// Les calculs sous-jacents restent toujours précis : seul l'affichage est concerné.
// Le paramètre `decimals` des appelants est intentionnellement ignoré : ce sont les
// préférences utilisateur qui priment, pas les choix locaux d'affichage.
let __SHOW_DECIMALS__ = true;
const setShowDecimalsFlag = (v) => { __SHOW_DECIMALS__ = v !== false; };

const fmt = (n) => {
  const v = Number(n) || 0;
  const d = __SHOW_DECIMALS__ ? 2 : 0;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
};

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + 'k';
  return Math.round(v).toString();
};

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Compresse une image en data URL carrée (256px) — léger, idéal pour avatar
const readAvatarFile = (file) => new Promise((resolve, reject) => {
  if (!file || !file.type.startsWith('image/')) { reject(new Error('Fichier image requis')); return; }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Lecture impossible'));
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => reject(new Error('Image invalide'));
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Crop carré centré
      const ratio = Math.min(img.width, img.height);
      const sx = (img.width - ratio) / 2;
      const sy = (img.height - ratio) / 2;
      ctx.drawImage(img, sx, sy, ratio, ratio, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

const isExpenseDueInMonth = (exp, year, month) => {
  if (exp.frequency === 'monthly') return true;
  if (exp.frequency === 'bimonthly') return ((month - (exp.startMonth ?? 0)) % 2 + 2) % 2 === 0;
  if (exp.frequency === 'annual') return month === (exp.dueMonth ?? 0);
  return false;
};

const getQuarter = (month) => Math.floor(month / 3) + 1;
const getQuarterMonths = (q) => [(q - 1) * 3, (q - 1) * 3 + 1, (q - 1) * 3 + 2];

const getNextDeclarationDate = (frequency) => {
  const now = new Date();
  if (frequency === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth() + 1, 30);
  }
  const m = now.getMonth();
  const q = Math.floor(m / 3);
  const nextDeadlineMonth = (q + 1) * 3 + 1;
  const year = now.getFullYear() + (nextDeadlineMonth > 11 ? 1 : 0);
  return new Date(year, nextDeadlineMonth % 12, 0);
};

// ---------------------------------------------------------------------------
// State + migration
// ---------------------------------------------------------------------------

const DEFAULT_STATE = {
  activities: DEFAULT_ACTIVITIES,
  categories: DEFAULT_CATEGORIES,
  expenses: DEFAULT_EXPENSES,
  transactions: SEED_TRANSACTIONS,
  paidExpenses: {},
  expenseOverrides: {},
  varCategories: DEFAULT_VAR_CATEGORIES,
  varExpenses: [],
  clients: [],
  profile: {
    avatar: null, // data URL (base64) ou null
  },
  controls: [],
  settings: {
    ursaffRate: 0,
    ursaffEnabled: true,
    showDecimals: true,
    weeklyUberObjective: 460,
    declarationFrequency: 'quarterly',
    notificationsEnabled: true,
    expenseReminderDays: 7,
  },
  notes: {},
};

const migrateState = (legacy) => {
  if (!legacy) return null;
  const acts = (legacy.activities || []).map(a => ({ ...a, active: a.active !== false }));
  const cats = DEFAULT_CATEGORIES.slice();
  const catMap = {};
  cats.forEach(c => { catMap[c.name] = c.id; });
  const exps = (legacy.expenses || []).map(e => {
    if (e.categoryId) return e;
    const id = catMap[e.category] || 'logement';
    const { category, ...rest } = e;
    return { ...rest, categoryId: id };
  });
  return {
    activities: acts,
    categories: cats,
    expenses: exps,
    transactions: legacy.transactions || [],
    paidExpenses: legacy.paidExpenses || {},
    expenseOverrides: legacy.expenseOverrides || {},
    varCategories: legacy.varCategories || DEFAULT_VAR_CATEGORIES,
    varExpenses: legacy.varExpenses || [],
    clients: legacy.clients || [],
    controls: legacy.controls || [],
    profile: legacy.profile || { avatar: null },
    settings: {
      ursaffRate: legacy.settings?.ursaffRate ?? 0,
      ursaffEnabled: legacy.settings?.ursaffEnabled !== false,
      showDecimals: legacy.settings?.showDecimals !== false,
      weeklyUberObjective: legacy.settings?.weeklyUberObjective ?? 460,
      declarationFrequency: 'quarterly',
      notificationsEnabled: true,
      expenseReminderDays: 7,
    },
    notes: legacy.notes || {},
  };
};

const loadLocalState = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) return migrateState(JSON.parse(legacyRaw));
  } catch {}
  return null;
};

const useAppState = (user) => {
  const [state, setState] = useState(() => loadLocalState() || DEFAULT_STATE);
  const [synced, setSynced] = useState(false);
  const saveTimer = useRef(null);

  // Recharge depuis Supabase quand l'utilisateur se connecte
  useEffect(() => {
    if (!user) {
      // Déconnexion : remet l'état par défaut, nettoie localStorage
      setState(DEFAULT_STATE);
      setSynced(false);
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return;
    }

    setSynced(false);
    // Nettoie le localStorage avant de charger — évite de contaminer un nouveau compte
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setState(DEFAULT_STATE);

    loadState().then(remote => {
      if (remote) {
        // Backfill des nouveaux champs (profile, controls, settings) pour anciens états distants
        const merged = {
          ...DEFAULT_STATE,
          ...remote,
          profile: { ...DEFAULT_STATE.profile, ...(remote.profile || {}) },
          controls: remote.controls || [],
          settings: { ...DEFAULT_STATE.settings, ...(remote.settings || {}) },
        };
        setState(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
      setSynced(true);
    });
  }, [user?.id]);

  // Sauvegarde : localStorage immédiat + Supabase avec debounce
  useEffect(() => {
    if (!synced || !user) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveState(state); }, 1500);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state, synced, user]);

  return [state, setState, synced];
};

// ---------------------------------------------------------------------------
// Derived computations
// ---------------------------------------------------------------------------

const computeMonth = (state, year, month) => {
  const txs = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const byActivity = {};
  let brutTaxable = 0;
  let brutNonTaxable = 0;

  state.activities.forEach(a => {
    const items = txs.filter(t => t.activityId === a.id);
    const total = items.reduce((s, t) => s + Number(t.amount || 0), 0);
    byActivity[a.id] = { total, count: items.length };
    if (a.taxable) brutTaxable += total;
    else brutNonTaxable += total;
  });

  const brut = brutTaxable + brutNonTaxable;
  // Si l'utilisateur a désactivé la gestion URSSAF, on neutralise les cotisations
  // partout. Le taux est préservé pour une réactivation simple.
  const ursaffActive = state.settings.ursaffEnabled !== false;
  const ursaff = ursaffActive ? brutTaxable * state.settings.ursaffRate : 0;

  const dueExpenses = state.expenses
    .filter(e => isExpenseDueInMonth(e, year, month))
    .map(e => {
      const key = `${year}-${month}-${e.id}`;
      const amount = state.expenseOverrides[key] !== undefined ? state.expenseOverrides[key] : e.amount;
      const paid = !!state.paidExpenses[key];
      return { ...e, amount, paid, key };
    });
  const charges = dueExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const chargesPaid = dueExpenses.filter(e => e.paid).reduce((s, e) => s + Number(e.amount || 0), 0);

  const net = brut - ursaff - charges;
  const argentReel = brut - ursaff - chargesPaid;

  return {
    txs, byActivity,
    brut, brutTaxable, brutNonTaxable,
    ursaff, charges, chargesPaid, dueExpenses,
    net, argentReel,
  };
};

const computeQuarter = (state, year, quarter) => {
  const months = getQuarterMonths(quarter);
  let brutTaxable = 0;
  let brutNonTaxable = 0;
  months.forEach(m => {
    const d = computeMonth(state, year, m);
    brutTaxable += d.brutTaxable;
    brutNonTaxable += d.brutNonTaxable;
  });
  return {
    months,
    brutTaxable,
    brutNonTaxable,
    ursaffDue: (state.settings.ursaffEnabled !== false) ? brutTaxable * state.settings.ursaffRate : 0,
  };
};

// ---------------------------------------------------------------------------
// Variable expenses computation
// ---------------------------------------------------------------------------

const computeVarMonth = (state, year, month) => {
  const items = (state.varExpenses || []).filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
  const byCategory = {};
  items.forEach(e => {
    const cid = e.categoryId || 'autre';
    byCategory[cid] = (byCategory[cid] || 0) + Number(e.amount || 0);
  });
  return { items, total, byCategory };
};

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------

const Card = ({ children, className = '', onClick, style = {} }) => (
  <div
    onClick={onClick}
    style={{
      background: 'rgba(255,255,255,0.035)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: '0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.5)',
      ...style,
    }}
    className={`rounded-2xl ${onClick ? 'active:bg-white/[0.05] active:scale-[0.985] cursor-pointer transition-all duration-150' : ''} ${className}`}
  >
    {children}
  </div>
);

// Avatar : photo si dispo, sinon initiale sur fond glass argenté
const Avatar = ({ src, initial = '?', size = 40, onClick, ring = false }) => {
  const fontSize = Math.round(size * 0.4);
  return (
    <button
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: src
          ? 'transparent'
          : 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)',
        border: ring ? '2px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.08)',
        padding: 0,
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: '0 4px 16px -4px rgba(0,0,0,0.5)',
      }}
      className={onClick ? 'active:scale-95 transition-transform' : ''}
    >
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ color: '#fff', fontSize, fontWeight: 600, letterSpacing: '-0.02em' }}>{initial}</span>
      }
    </button>
  );
};

const TopBar = ({ title, subtitle, right }) => (
  <div className="flex items-end justify-between px-5 pt-8 pb-4">
    <div>
      {subtitle && <div className="text-[11px] text-zinc-500 font-semibold tracking-[0.12em] uppercase mb-1.5">{subtitle}</div>}
      <h1 className="text-[28px] font-bold text-white leading-tight" style={{ letterSpacing: '-0.7px' }}>{title}</h1>
    </div>
    {right}
  </div>
);

const MonthSwitcher = ({ year, month, onChange }) => {
  const go = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    onChange(y, m);
  };
  const isCurrent = year === TODAY_YEAR && month === TODAY_MONTH;
  return (
    <div className="flex items-center gap-0.5 rounded-full px-1 py-1" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <button onClick={() => go(-1)} className="w-8 h-8 flex items-center justify-center rounded-full active:bg-white/[0.08]">
        <ChevronLeft className="w-4 h-4 text-zinc-400" />
      </button>
      <div className="px-2 text-[13px] font-semibold text-white min-w-[78px] text-center" style={{ letterSpacing: '-0.1px' }}>
        {MONTHS_SHORT[month]} {String(year).slice(2)}
        {isCurrent && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 align-middle" />}
      </div>
      <button onClick={() => go(1)} className="w-8 h-8 flex items-center justify-center rounded-full active:bg-white/[0.08]">
        <ChevronRight className="w-4 h-4 text-zinc-400" />
      </button>
    </div>
  );
};

const Sheet = ({ open, onClose, children, title }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" style={{ WebkitBackdropFilter: 'blur(8px)' }} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-t-[28px] pb-8 max-h-[90vh] overflow-y-auto"
        style={{
          animation: 'slideUp 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
          background: 'linear-gradient(180deg, #161618 0%, #0E0E10 100%)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderBottom: 'none',
          boxShadow: '0 -24px 60px -10px rgba(0,0,0,0.7)',
        }}
      >
        <div className="sticky top-0 pt-3 pb-3 px-5 rounded-t-[28px] z-10" style={{ background: 'linear-gradient(180deg, #161618 70%, rgba(22,22,24,0))' }}>
          <div className="w-9 h-[3px] bg-white/15 rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-bold text-white" style={{ letterSpacing: '-0.4px' }}>{title}</h2>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.06] border border-white/[0.08] active:bg-white/[0.1]">
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        </div>
        <div className="px-5 pt-2">{children}</div>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); }}`}</style>
    </div>
  );
};

const Toggle = ({ value, onChange, color = '#00D26A' }) => (
  <button
    onClick={() => onChange(!value)}
    className="w-12 h-7 rounded-full transition-colors relative flex-shrink-0"
    style={{ backgroundColor: value ? color : '#48484A' }}
  >
    <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform shadow-md ${value ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
  </button>
);

// ---------------------------------------------------------------------------
// Local reminders engine
// ---------------------------------------------------------------------------

const useReminders = (state) => {
  return useMemo(() => {
    if (!state.settings.notificationsEnabled) return [];
    const reminders = [];
    const now = new Date();
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const reminderDays = state.settings.expenseReminderDays || 7;

    const dueExps = state.expenses.filter(e => isExpenseDueInMonth(e, todayY, todayM));
    dueExps.forEach(e => {
      const key = `${todayY}-${todayM}-${e.id}`;
      if (state.paidExpenses[key]) return;
      const dueDay = e.dueDay || 1;
      const dueDate = new Date(todayY, todayM, dueDay);
      const daysUntil = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      if (daysUntil < 0) {
        reminders.push({ type: 'overdue', expense: e, daysUntil, key });
      } else if (daysUntil <= reminderDays) {
        reminders.push({ type: 'upcoming', expense: e, daysUntil, key });
      }
    });

    const deadline = getNextDeclarationDate(state.settings.declarationFrequency || 'quarterly');
    const daysToDeadline = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
    if (daysToDeadline >= 0 && daysToDeadline <= 14) {
      reminders.push({ type: 'declaration', daysUntil: daysToDeadline, deadline });
    }

    return reminders;
  }, [state]);
};

// ---------------------------------------------------------------------------
// Activity sales sheet — détail des ventes d'une activité pour un mois donné
// ---------------------------------------------------------------------------

const ActivitySalesSheet = ({ activity, state, setState, year, month, onClose, openAddTx }) => {
  const open = !!activity;
  const txs = useMemo(() => {
    if (!activity) return [];
    return state.transactions
      .filter(t => {
        const d = new Date(t.date);
        return t.activityId === activity.id && d.getFullYear() === year && d.getMonth() === month;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [activity, state.transactions, year, month]);

  const clientMap = useMemo(() => {
    const m = {};
    (state.clients || []).forEach(c => { m[c.id] = c; });
    return m;
  }, [state.clients]);

  const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const avg = txs.length > 0 ? total / txs.length : 0;

  const deleteTx = (id) => {
    setState(s => ({ ...s, transactions: s.transactions.filter(t => t.id !== id) }));
  };

  if (!activity) return null;

  return (
    <Sheet open={open} onClose={onClose} title={activity.name}>
      {/* Résumé */}
      <div className="mt-1 mb-4 rounded-2xl p-4" style={{
        background: 'linear-gradient(135deg, #1C1C1E 0%, #252527 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activity.color }} />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
            {MONTHS_FR[month]} {year}
          </span>
          {!activity.taxable && (
            <span className="px-1.5 py-px rounded bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider">non URSSAF</span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[34px] font-bold text-white leading-none tracking-tight">{fmt(total, { decimals: 0 })}</span>
          <span className="text-[18px] text-zinc-500 font-medium">€</span>
        </div>
        <div className="flex items-center gap-4 mt-3 text-[11px] text-zinc-500">
          <span><span className="text-zinc-300 font-semibold">{txs.length}</span> vente{txs.length !== 1 ? 's' : ''}</span>
          {txs.length > 0 && (
            <span>Panier moyen <span className="text-zinc-300 font-semibold">{fmt(avg, { decimals: 0 })} €</span></span>
          )}
        </div>
      </div>

      {/* Liste des ventes */}
      {txs.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-[13px] text-zinc-500 mb-4">Aucune vente sur {MONTHS_FR[month]}.</div>
          <button
            onClick={() => { onClose(); openAddTx && openAddTx(); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[13px] font-medium text-white active:bg-white/[0.1]"
          >
            <Plus className="w-3.5 h-3.5" /> Ajouter une vente
          </button>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {txs.map((t, i) => {
            const client = t.clientId ? clientMap[t.clientId] : null;
            return (
              <div
                key={t.id}
                className={`flex items-center justify-between p-4 ${i < txs.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <div className="text-[14px] font-medium text-white truncate">
                    {t.description || 'Sans description'}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2">
                    <span>{new Date(t.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                    {client && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="flex items-center gap-1 truncate">
                          <Users className="w-2.5 h-2.5" />
                          <span className="truncate">{client.name}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-[14px] font-semibold text-white">{fmt(t.amount, { decimals: 2 })} €</div>
                  <button onClick={() => deleteTx(t.id)} className="text-zinc-600 active:text-rose-400 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const Dashboard = ({ state, setState, year, month, setMonth, openAddTx, openAddVar, setTab, user }) => {
  const data = useMemo(() => computeMonth(state, year, month), [state, year, month]);
  const varData = useMemo(() => computeVarMonth(state, year, month), [state, year, month]);
  const quarter = getQuarter(month);
  const qData = useMemo(() => computeQuarter(state, year, quarter), [state, year, quarter]);
  const reminders = useReminders(state);

  const activeActivities = useMemo(() =>
    state.activities.filter(a => a.active !== false).sort((a, b) => a.order - b.order),
    [state.activities]);

  const last6 = useMemo(() => {
    const arr = [];
    for (let i = 5; i >= 0; i--) {
      let m = month - i, y = year;
      while (m < 0) { m += 12; y -= 1; }
      const d = computeMonth(state, y, m);
      arr.push({ month: m, year: y, net: d.net, brut: d.brut });
    }
    return arr;
  }, [state, year, month]);

  const benefice = data.brut - data.ursaff;
  const argentVrai = benefice - data.chargesPaid - varData.total;
  const chargesUnpaid = data.charges - data.chargesPaid;
  const chargesPaidCount = data.dueExpenses.filter(e => e.paid).length;
  const userFirstName = user?.user_metadata?.username || user?.user_metadata?.first_name || 'toi';

  // Détail des ventes par activité (sheet)
  const [activitySheet, setActivitySheet] = useState(null);
  const [controlSheet, setControlSheet] = useState(null); // Control. à valider
  // "Mes activités" est replié par défaut pour alléger le dashboard ; l'utilisateur
  // le déplie d'un tap sur le header pour voir le détail des activités.
  const [activitiesOpen, setActivitiesOpen] = useState(false);

  // ── Suivi des dépenses du jour ──────────────────────────────────────────
  // Calcule le total des vraies dépenses (varExpenses) sur la journée en cours.
  // Les Control. non validés ne sont PAS comptés ici — seuls les paiements réels.
  const todayKey = useMemo(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }, []);
  const todayExpenses = useMemo(() => {
    return (state.varExpenses || [])
      .filter(e => (e.date || '').slice(0, 10) === todayKey)
      .reduce((s, e) => s + Number(e.amount || 0), 0);
  }, [state.varExpenses, todayKey]);

  // ── Control. prévus aujourd'hui ─────────────────────────────────────────
  // Récupère tous les Control. dont la date est aujourd'hui et qui ne sont pas
  // encore validés (status undefined ou 'pending'). Le plus proche en premier.
  const todayControls = useMemo(() => {
    return (state.controls || [])
      .filter(c => (c.date || '').slice(0, 10) === todayKey && c.status !== 'validated' && c.status !== 'cancelled')
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }, [state.controls, todayKey]);

  return (
    <div className="pb-32">

      {/* ── WELCOME HEADER ───────────────────────────────────────────────── */}
      <div className="px-5 pt-8 pb-3 flex items-center justify-between anim-1">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            src={state.profile?.avatar}
            initial={(user?.user_metadata?.username || user?.user_metadata?.first_name || user?.email || '?')[0].toUpperCase()}
            size={56}
            ring
            onClick={() => setTab('profile')}
          />
          <div className="min-w-0">
            <div className="text-[12px] text-zinc-500 font-medium tracking-wide">{MONTHS_FR[month]} {year}</div>
            <h1 className="text-[22px] font-bold text-white leading-tight tracking-tight truncate" style={{ letterSpacing: '-0.4px' }}>
              Bonjour {userFirstName}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <MonthSwitcher year={year} month={month} onChange={(y, m) => setMonth(y, m)} />
        </div>
      </div>

      {/* ── QUICK ACTIONS ────────────────────────────────────────────────── */}
      <div className="px-5 mb-3 anim-1">
        <div className="flex gap-2">
          <button
            onClick={openAddTx}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-white text-black rounded-2xl text-[13px] font-semibold active:scale-[0.97] transition-transform"
          >
            <Plus className="w-4 h-4" /> Ajouter une vente
          </button>
          <button
            onClick={openAddVar}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1C1C1E] border border-zinc-800/60 text-white rounded-2xl text-[13px] font-semibold active:scale-[0.97] transition-transform"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-rose-400" /> Ajouter une dépense
          </button>
        </div>
      </div>

      {/* ── BANDEAU "AUJOURD'HUI" : dépenses + Control. prévu ───────────── */}
      {(todayExpenses > 0 || todayControls.length > 0) && (
        <div className="px-5 mb-3 anim-1">
          <div className="flex gap-2">
            {/* Dépenses aujourd'hui */}
            {todayExpenses > 0 && (
              <button
                onClick={() => setTab('varexp')}
                className={`${todayControls.length > 0 ? 'flex-1' : 'flex-1'} text-left rounded-2xl p-3.5 active:scale-[0.98] transition-transform`}
                style={{
                  background: 'linear-gradient(135deg, rgba(255,69,58,0.08) 0%, rgba(255,69,58,0.03) 100%)',
                  border: '1px solid rgba(255,69,58,0.15)',
                }}
              >
                <div className="text-[10px] uppercase tracking-wider text-rose-400/70 font-semibold mb-0.5">Aujourd'hui</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[18px] font-bold text-rose-300 leading-none">{fmt(todayExpenses, { decimals: 2 })}</span>
                  <span className="text-[12px] text-rose-400/60 font-medium">€</span>
                </div>
                <div className="text-[10px] text-rose-400/50 mt-1">dépensés</div>
              </button>
            )}

            {/* Control. prévu */}
            {todayControls.length > 0 && (() => {
              const c = todayControls[0];
              const total = (c.items || []).reduce((s, it) => s + Number(it.amount || 0), 0);
              const isIncome = (c.kind || 'expense') === 'income';
              const palette = isIncome
                ? { bg: 'rgba(48,209,88,0.10)', bg2: 'rgba(48,209,88,0.04)', border: 'rgba(48,209,88,0.20)', label: 'text-emerald-400/80', sub: 'text-emerald-300/70' }
                : { bg: 'rgba(94,92,230,0.10)', bg2: 'rgba(94,92,230,0.04)', border: 'rgba(94,92,230,0.18)', label: 'text-indigo-400/80', sub: 'text-indigo-300/70' };
              return (
                <button
                  onClick={() => setControlSheet(c)}
                  className={`${todayExpenses > 0 ? 'flex-1' : 'w-full'} text-left rounded-2xl p-3.5 active:scale-[0.98] transition-transform`}
                  style={{
                    background: `linear-gradient(135deg, ${palette.bg} 0%, ${palette.bg2} 100%)`,
                    border: `1px solid ${palette.border}`,
                  }}
                >
                  <div className={`text-[10px] uppercase tracking-wider ${palette.label} font-semibold mb-0.5 flex items-center gap-1`}>
                    {isIncome ? <TrendingUp className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                    Control. {isIncome ? 'revenu' : ''}{c.time ? ` · ${c.time}` : ''}
                  </div>
                  <div className="text-[13px] font-bold text-white truncate leading-tight">{c.name || 'Sans nom'}</div>
                  <div className={`text-[11px] ${palette.sub} mt-0.5`}>
                    {isIncome ? '+' : ''}{fmt(total, { decimals: 0 })} € {isIncome ? 'attendus' : 'prévus'}
                  </div>
                </button>
              );
            })()}
          </div>
        </div>
      )}

      {/* Reminders strip */}
      {reminders.length > 0 && (
        <div className="px-5 mb-3 anim-1">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
            {reminders.slice(0, 5).map((r, i) => (
              <button
                key={i}
                onClick={() => setTab(r.type === 'declaration' ? 'year' : 'expenses')}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-full text-[12px] font-medium ${
                  r.type === 'overdue' ? 'bg-rose-500/15 text-rose-400' :
                  r.type === 'declaration' ? 'bg-orange-500/15 text-orange-400' :
                  'bg-zinc-800/80 text-zinc-300'
                }`}
              >
                {r.type === 'overdue' && <AlertCircle className="w-3.5 h-3.5" />}
                {r.type === 'upcoming' && <Clock className="w-3.5 h-3.5" />}
                {r.type === 'declaration' && <FileText className="w-3.5 h-3.5" />}
                <span className="whitespace-nowrap">
                  {r.type === 'overdue' && `${r.expense.name} en retard`}
                  {r.type === 'upcoming' && `${r.expense.name} dans ${r.daysUntil}j`}
                  {r.type === 'declaration' && `Déclaration dans ${r.daysUntil}j`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── BLOC 1 : Chiffre d'affaires ─────────────────────────────────── */}
      <div className="px-5 anim-1">
        <div
          className="rounded-3xl p-6 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #1C1C1E 0%, #252527 100%)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-zinc-500 mb-1">
            Chiffre d'affaires
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-[44px] font-bold tracking-tight leading-none text-white">
              {fmt(data.brut, { decimals: 0 })}
            </span>
            <span className="text-2xl font-medium text-zinc-500">€</span>
          </div>
          {/* Activity micro-bars */}
          <div className="mt-4 flex gap-1 h-1 rounded-full overflow-hidden">
            {activeActivities.map(a => {
              const d = data.byActivity[a.id] || { total: 0 };
              const pct = data.brut > 0 ? (d.total / data.brut) * 100 : 0;
              return pct > 0 ? (
                <div key={a.id} style={{ width: `${pct}%`, backgroundColor: a.color, borderRadius: 99 }} />
              ) : null;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeActivities.map(a => {
              const d = data.byActivity[a.id] || { total: 0, count: 0 };
              if (d.total === 0) return null;
              return (
                <button
                  key={a.id}
                  onClick={() => setActivitySheet(a)}
                  className="flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full active:scale-[0.97] transition-transform"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-[11px] text-zinc-400">{a.name}</span>
                  <span className="text-[11px] font-semibold text-zinc-200">{fmt(d.total, { decimals: 0 })} €</span>
                  <ChevronRight className="w-3 h-3 text-zinc-600 -mr-0.5" strokeWidth={2.5} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── BLOC 2 : Bénéfice après URSSAF ──────────────────────────────── */}
      {state.settings.ursaffEnabled !== false && (
      <div className="px-5 mt-3 anim-2">
        <div
          className="rounded-3xl p-6 relative overflow-hidden"
          style={{
            background: benefice >= 0
              ? 'linear-gradient(135deg, #0D2B1A 0%, #0A2015 100%)'
              : 'linear-gradient(135deg, #2B0D0D 0%, #200A0A 100%)',
            border: benefice >= 0 ? '1px solid rgba(48,209,88,0.18)' : '1px solid rgba(255,69,58,0.18)'
          }}
        >
          <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full opacity-10 blur-2xl pointer-events-none"
            style={{ backgroundColor: benefice >= 0 ? '#30D158' : '#FF453A' }} />
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.16em] uppercase mb-1"
                style={{ color: benefice >= 0 ? 'rgba(48,209,88,0.6)' : 'rgba(255,69,58,0.6)' }}>
                Bénéfice après URSSAF
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-[44px] font-bold tracking-tight leading-none ${benefice >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {benefice >= 0 ? '+' : ''}{fmt(benefice, { decimals: 0 })}
                </span>
                <span className="text-2xl font-medium" style={{ color: benefice >= 0 ? 'rgba(48,209,88,0.5)' : 'rgba(255,69,58,0.5)' }}>€</span>
              </div>
              <div className="text-[12px] mt-1.5" style={{ color: benefice >= 0 ? 'rgba(48,209,88,0.45)' : 'rgba(255,69,58,0.45)' }}>
                CA − URSSAF
              </div>
            </div>
            <div className="mt-1 text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium mb-1">URSSAF</div>
              <div className="text-[15px] font-bold text-orange-400">−{fmt(data.ursaff, { decimals: 0 })} €</div>
              <div className="text-[10px] text-zinc-600 mt-0.5">{Math.round(state.settings.ursaffRate * 100)}% du CA</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: data.brut > 0 ? `${Math.min(100, (benefice / data.brut) * 100)}%` : '0%',
                  background: benefice >= 0 ? 'linear-gradient(90deg, #30D158, #00D26A)' : 'linear-gradient(90deg, #FF453A, #FF6B6B)'
                }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-zinc-700">0 €</span>
              <span className="text-[10px] text-zinc-700">{fmt(data.brut, { decimals: 0 })} €</span>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── DÉPENSES DU MOIS (rouge) ─────────────────────────────────────── */}
      <div className="px-5 mt-3 anim-3">
        <Card className="p-5" onClick={() => setTab('varexp')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/15 flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="w-4 h-4 text-rose-400" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                  {MONTHS_SHORT[month]} · Dépenses
                </div>
                <div className="text-[15px] font-bold text-white mt-0.5">
                  {varData.items.length} dépense{varData.items.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium mb-0.5">Total</div>
              <div className="text-[15px] font-bold text-rose-400">−{fmt(varData.total, { decimals: 0 })} €</div>
            </div>
          </div>
        </Card>
      </div>

      {/* ── DÉCLARATION URSSAF ───────────────────────────────────────────── */}
      {state.settings.ursaffEnabled !== false && (
      <div className="px-5 mt-2 anim-4">
        <Card className="p-5" onClick={() => setTab('year')}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                  {state.settings.declarationFrequency === 'monthly' ? 'Ce mois' : `T${quarter}`} · À déclarer
                </div>
                <div className="text-[15px] font-bold text-white mt-0.5">
                  {fmt(qData.brutTaxable, { decimals: 0 })} €
                  <span className="text-zinc-500 text-[12px] font-normal ml-1">CA</span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium mb-0.5">À reverser</div>
              <div className="text-[15px] font-bold text-orange-400">{fmt(qData.ursaffDue, { decimals: 0 })} €</div>
            </div>
          </div>
        </Card>
      </div>
      )}

      {/* ── ACTIVITÉS (repliable) ───────────────────────────────────────── */}
      <div className="px-5 mt-6 anim-5">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setActivitiesOpen(v => !v)}
            className="flex items-center gap-2 active:opacity-60 transition-opacity"
          >
            <h3 className="text-sm font-semibold text-white tracking-tight">Mes activités</h3>
            {activeActivities.length > 0 && (
              <span className="text-[11px] text-zinc-500 font-medium">{activeActivities.length}</span>
            )}
            <ChevronRight
              className="w-4 h-4 text-zinc-500 transition-transform"
              strokeWidth={2.5}
              style={{ transform: activitiesOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            />
          </button>
          <button onClick={openAddTx} className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-400 active:opacity-60 bg-emerald-400/10 px-3 py-1.5 rounded-full">
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>

        {activitiesOpen && (
          <div className="space-y-2">
            {activeActivities.map(a => {
              const d = data.byActivity[a.id] || { total: 0, count: 0 };
              const pct = data.brut > 0 ? Math.min(100, (d.total / data.brut) * 100) : 0;
              return (
                <Card key={a.id} className="p-4" onClick={() => setActivitySheet(a)}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-white leading-tight truncate">{a.name}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {d.count} {d.count > 1 ? 'ventes' : 'vente'}
                          {!a.taxable && <span className="ml-1.5 px-1.5 py-px rounded-md bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider">non URSSAF</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-[16px] font-bold text-white">{fmt(d.total, { decimals: 0 })} €</div>
                      <ChevronRight className="w-4 h-4 text-zinc-600" strokeWidth={2.5} />
                    </div>
                  </div>
                  <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: a.color, opacity: d.total > 0 ? 1 : 0 }}
                    />
                  </div>
                </Card>
              );
            })}
            {activeActivities.length === 0 && (
              <Card className="p-4 text-center text-zinc-500 text-sm">
                Aucune activité active. Va dans Réglages pour en créer.
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ── 6 DERNIERS MOIS — ÉVOLUTION DU CA ────────────────────────────── */}
      <div className="px-5 mt-6 anim-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white tracking-tight">Évolution du CA</h3>
          {(() => {
            // Tendance : compare le dernier mois au mois précédent
            const cur = last6[last6.length - 1]?.brut || 0;
            const prev = last6[last6.length - 2]?.brut || 0;
            if (prev === 0 && cur === 0) return null;
            const diff = cur - prev;
            const pct = prev > 0 ? (diff / prev) * 100 : (cur > 0 ? 100 : 0);
            const up = diff >= 0;
            return (
              <div className={`flex items-center gap-1 text-[12px] font-semibold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                <TrendingUp className="w-3.5 h-3.5" style={{ transform: up ? 'none' : 'scaleY(-1)' }} />
                {up ? '+' : ''}{pct.toFixed(0)}%
              </div>
            );
          })()}
        </div>
        <Card className="p-5">
          {(() => {
            const W = 320, H = 130, padX = 6, padTop = 14, padBottom = 22;
            const vals = last6.map(d => d.brut);
            const maxV = Math.max(1, ...vals);
            const minV = Math.min(...vals);
            const range = Math.max(1, maxV - minV);
            const innerH = H - padTop - padBottom;
            const stepX = (W - padX * 2) / Math.max(1, last6.length - 1);

            // Points (x,y). On laisse un petit "fond" sous la courbe : si tout est
            // identique, la ligne reste horizontale au milieu.
            const pts = last6.map((d, i) => {
              const x = padX + i * stepX;
              const ratio = maxV === minV ? 0.5 : (d.brut - minV) / range;
              const y = padTop + innerH * (1 - ratio);
              return { x, y, d };
            });

            // Courbe lissée (Catmull-Rom → Bézier) pour un rendu Apple-like
            const linePath = pts.map((p, i) => {
              if (i === 0) return `M ${p.x},${p.y}`;
              const p0 = pts[i - 1];
              const cx = (p0.x + p.x) / 2;
              return `C ${cx},${p0.y} ${cx},${p.y} ${p.x},${p.y}`;
            }).join(' ');
            const areaPath = `${linePath} L ${pts[pts.length - 1].x},${padTop + innerH} L ${pts[0].x},${padTop + innerH} Z`;
            const last = pts[pts.length - 1];

            return (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="caArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(48,209,88,0.28)" />
                    <stop offset="100%" stopColor="rgba(48,209,88,0)" />
                  </linearGradient>
                  <linearGradient id="caLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#34D399" />
                    <stop offset="100%" stopColor="#30D158" />
                  </linearGradient>
                </defs>

                {/* Aire sous la courbe */}
                <path d={areaPath} fill="url(#caArea)" />
                {/* Ligne */}
                <path d={linePath} fill="none" stroke="url(#caLine)" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round" />

                {/* Points + labels */}
                {pts.map((p, i) => {
                  const isLast = i === pts.length - 1;
                  return (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={isLast ? 4 : 2.5}
                        fill={isLast ? '#30D158' : '#1C1C1E'}
                        stroke={isLast ? '#0A0A0A' : '#30D158'}
                        strokeWidth={isLast ? 2 : 1.5} />
                      {/* Valeur du dernier point */}
                      {isLast && p.d.brut > 0 && (
                        <text x={p.x} y={p.y - 10} textAnchor="middle"
                          fill="#FFFFFF" fontSize="11" fontWeight="700">
                          {fmt(p.d.brut, { decimals: 0 })}€
                        </text>
                      )}
                      {/* Mois en bas */}
                      <text x={p.x} y={H - 4} textAnchor="middle"
                        fill={isLast ? '#FFFFFF' : '#52525B'} fontSize="10"
                        fontWeight={isLast ? '600' : '500'}>
                        {MONTHS_SHORT[p.d.month]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </Card>
      </div>

      <ActivitySalesSheet
        activity={activitySheet}
        state={state}
        setState={setState}
        year={year}
        month={month}
        openAddTx={openAddTx}
        onClose={() => setActivitySheet(null)}
      />

      {/* Validation d'un Control. ouvert depuis la carte du dashboard */}
      <ControlValidationSheet
        control={controlSheet}
        state={state}
        setState={setState}
        onClose={() => setControlSheet(null)}
        onEdit={null}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Revenue page
// ---------------------------------------------------------------------------

const RevenuePage = ({ state, setState, year, month, setMonth, openAddTx }) => {
  const data = useMemo(() => computeMonth(state, year, month), [state, year, month]);
  // Activités repliées par défaut : on stocke les ids dépliés dans un Set.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleActivity = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const visibleActivities = useMemo(() =>
    [...state.activities].sort((a, b) => a.order - b.order),
    [state.activities]);

  const clientMap = useMemo(() => {
    const m = {};
    (state.clients || []).forEach(c => { m[c.id] = c; });
    return m;
  }, [state.clients]);

  const deleteTx = (id) => {
    setState(s => ({ ...s, transactions: s.transactions.filter(t => t.id !== id) }));
  };

  return (
    <div className="pb-32">
      <TopBar
        subtitle="Revenus"
        title={MONTHS_FR[month] + ' ' + year}
        right={<MonthSwitcher year={year} month={month} onChange={(y, m) => setMonth(y, m)} />}
      />

      <div className="px-5">
        {state.settings.ursaffEnabled !== false ? (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Card className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">CA URSSAF</div>
              <div className="text-xl font-bold text-white">{fmt(data.brutTaxable, { decimals: 0 })} €</div>
              <div className="text-[11px] text-orange-400 mt-1">
                → {fmt(data.ursaff, { decimals: 0 })} € de cotisations
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">Hors URSSAF</div>
              <div className="text-xl font-bold text-white">{fmt(data.brutNonTaxable, { decimals: 0 })} €</div>
              <div className="text-[11px] text-zinc-500 mt-1">non déclaré</div>
            </Card>
          </div>
        ) : (
          <Card className="p-5 mb-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1">Chiffre d'affaires</div>
            <div className="text-3xl font-bold text-white">{fmt(data.brut, { decimals: 0 })} €</div>
            <div className="text-[11px] text-zinc-500 mt-1">{data.txs.length} vente{data.txs.length !== 1 ? 's' : ''}</div>
          </Card>
        )}

        <button
          onClick={openAddTx}
          className="w-full mb-5 bg-white text-black font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" /> Ajouter une vente
        </button>

        {visibleActivities.map(a => {
          const txs = data.txs.filter(t => t.activityId === a.id);
          if (txs.length === 0) return null;
          const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
          const isOpen = expanded.has(a.id);
          return (
            <div key={a.id} className="mb-3">
              {/* Header cliquable — replie/déplie le détail des ventes */}
              <button
                onClick={() => toggleActivity(a.id)}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-[#1C1C1E] border border-zinc-800/60 active:bg-[#252527] transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ChevronRight
                    className="w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform"
                    strokeWidth={2.5}
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  />
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-[14px] font-semibold text-white truncate">{a.name}</span>
                  {a.active === false && <EyeOff className="w-3 h-3 text-zinc-600 flex-shrink-0" />}
                  {!a.taxable && <span className="px-1.5 py-px rounded bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider flex-shrink-0">non URSSAF</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[14px] font-bold text-white">{fmt(total, { decimals: 2 })} €</span>
                  <span className="text-[11px] text-zinc-600">{txs.length}</span>
                </div>
              </button>

              {isOpen && (
                <Card className="mt-2">
                  {txs.map((t, i) => {
                    const client = t.clientId ? clientMap[t.clientId] : null;
                    return (
                    <div key={t.id} className={`flex items-center justify-between p-4 ${i < txs.length - 1 ? 'border-b border-zinc-800/60' : ''}`}>
                      <div className="flex-1 min-w-0 pr-3">
                        <div className="text-[14px] font-medium text-white truncate">{t.description || 'Sans description'}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2">
                          <span>{new Date(t.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                          {client && (
                            <>
                              <span className="text-zinc-700">·</span>
                              <span className="flex items-center gap-1 truncate">
                                <Users className="w-2.5 h-2.5" />
                                <span className="truncate">{client.name}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-[14px] font-semibold text-white">{fmt(t.amount, { decimals: 2 })} €</div>
                        <button onClick={() => deleteTx(t.id)} className="text-zinc-600 active:text-rose-400 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </Card>
              )}
            </div>
          );
        })}

        {data.txs.length === 0 && (
          <div className="text-center py-12 text-zinc-500 text-sm">
            Aucune vente pour {MONTHS_FR[month]}.<br />
            Appuie sur « Ajouter une vente » pour commencer.
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Expenses page
// ---------------------------------------------------------------------------

const ExpensesPage = ({ state, setState, year, month, setMonth }) => {
  const [addExpense, setAddExpense] = useState(null);
  const data = useMemo(() => computeMonth(state, year, month), [state, year, month]);
  const catMap = useMemo(() => {
    const m = {};
    state.categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [state.categories]);

  const togglePaid = (key) => {
    setState(s => {
      const next = { ...s.paidExpenses };
      if (next[key]) delete next[key]; else next[key] = true;
      return { ...s, paidExpenses: next };
    });
  };

  const byCategory = {};
  data.dueExpenses.forEach(e => {
    const catId = e.categoryId || 'autre';
    if (!byCategory[catId]) byCategory[catId] = [];
    byCategory[catId].push(e);
  });

  const sortedCatIds = Object.keys(byCategory).sort((a, b) => {
    const oa = catMap[a]?.order ?? 999;
    const ob = catMap[b]?.order ?? 999;
    return oa - ob;
  });

  const totalPaid = data.dueExpenses.filter(e => e.paid).reduce((s, e) => s + e.amount, 0);
  const pct = data.charges > 0 ? (totalPaid / data.charges) * 100 : 0;
  const now = new Date();

  return (
    <div className="pb-32">
      <TopBar
        subtitle="Charges"
        title={MONTHS_FR[month] + ' ' + year}
        right={<MonthSwitcher year={year} month={month} onChange={(y, m) => setMonth(y, m)} />}
      />

      <div className="px-5">
        <button
          onClick={() => setAddExpense({ id: 'new', name: '', amount: 0, frequency: 'monthly', dueDay: 1, categoryId: state.categories[0]?.id || '' })}
          className="w-full mb-5 bg-white text-black font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" /> Créer une charge
        </button>
        <Card className="p-5 mb-5">
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1">Total du mois</div>
              <div className="text-3xl font-bold text-white">{fmt(data.charges, { decimals: 2 })} €</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-zinc-500 mb-1">Payé</div>
              <div className="text-base font-semibold text-emerald-400">{fmt(totalPaid, { decimals: 0 })} €</div>
            </div>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </Card>

        {sortedCatIds.map(catId => {
          const cat = catMap[catId];
          const items = byCategory[catId];
          return (
            <div key={catId} className="mb-5">
              <div className="flex items-center gap-2 mb-2 px-1">
                {cat && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />}
                <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">{cat?.name || 'Autre'}</div>
              </div>
              <Card>
                {items.map((e, i) => {
                  const dueDate = new Date(year, month, e.dueDay || 1);
                  const isOverdue = !e.paid && dueDate < now && (year === now.getFullYear() && month === now.getMonth());
                  return (
                    <div
                      key={e.id}
                      onClick={() => togglePaid(e.key)}
                      className={`flex items-center gap-3 p-4 active:bg-[#252527] cursor-pointer ${i < items.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${e.paid ? 'bg-emerald-400' : isOverdue ? 'border-2 border-rose-400' : 'border-2 border-zinc-700'}`}>
                        {e.paid && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-[14px] font-medium ${e.paid ? 'text-zinc-500 line-through' : 'text-white'}`}>{e.name}</div>
                        <div className={`text-[11px] mt-0.5 ${isOverdue ? 'text-rose-400 font-medium' : 'text-zinc-500'}`}>
                          {isOverdue && 'En retard · '}
                          {e.frequency === 'monthly' && 'Mensuel'}
                          {e.frequency === 'bimonthly' && 'Bimestriel'}
                          {e.frequency === 'annual' && 'Annuel'}
                          {e.dueDay && ` · le ${e.dueDay}`}
                        </div>
                      </div>
                      <div className={`text-[14px] font-semibold ${e.paid ? 'text-zinc-500' : 'text-white'}`}>
                        {fmt(e.amount, { decimals: 2 })} €
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>
          );
        })}

        {data.dueExpenses.length === 0 && (
          <div className="text-center py-12 text-zinc-500 text-sm">
            Aucune charge ce mois-ci.<br />
            Crée-en une avec le bouton ci-dessus.
          </div>
        )}
      </div>

      <ExpenseEditor
        expense={addExpense}
        state={state}
        setState={setState}
        onClose={() => setAddExpense(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Year page
// ---------------------------------------------------------------------------

const YearPage = ({ state, year, setMonth, setTab }) => {
  // Pour l'année en cours, on n'agrège que jusqu'au mois actuel afin de ne pas
  // gonfler artificiellement les charges fixes récurrentes des mois futurs
  // (qui ne sont pas encore "dues" du point de vue financier réel).
  // Pour une année passée, on agrège les 12 mois normalement.
  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const lastMonth = isCurrentYear ? now.getMonth() : 11;
  const monthsCount = lastMonth + 1;

  const yearData = useMemo(() => {
    const arr = [];
    for (let m = 0; m <= lastMonth; m++) arr.push({ month: m, ...computeMonth(state, year, m) });
    return arr;
  }, [state, year, lastMonth]);

  const totals = yearData.reduce((acc, d) => ({
    brut: acc.brut + d.brut,
    brutTaxable: acc.brutTaxable + d.brutTaxable,
    brutNonTaxable: acc.brutNonTaxable + d.brutNonTaxable,
    ursaff: acc.ursaff + d.ursaff,
    charges: acc.charges + d.charges,
    net: acc.net + d.net,
  }), { brut: 0, brutTaxable: 0, brutNonTaxable: 0, ursaff: 0, charges: 0, net: 0 });

  const quarters = useMemo(() => {
    return [1, 2, 3, 4].map(q => ({ q, ...computeQuarter(state, year, q) }));
  }, [state, year]);

  // Dépenses variables — agrégat annuel
  const varYear = useMemo(() => {
    const items = (state.varExpenses || []).filter(e => new Date(e.date).getFullYear() === year);
    const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byCat = {};
    items.forEach(e => {
      const cid = e.categoryId || 'autre';
      if (!byCat[cid]) byCat[cid] = { total: 0, count: 0 };
      byCat[cid].total += Number(e.amount || 0);
      byCat[cid].count += 1;
    });
    const catMap = {};
    (state.varCategories || []).forEach(c => { catMap[c.id] = c; });
    const top = Object.entries(byCat)
      .map(([cid, v]) => ({ cid, cat: catMap[cid], total: v.total, count: v.count }))
      .sort((a, b) => b.total - a.total);
    return { total, count: items.length, top };
  }, [state.varExpenses, state.varCategories, year]);

  return (
    <div className="pb-32">
      <TopBar subtitle={year.toString()} title="Année" />

      <div className="px-5">
        <Card className="p-5 mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Bilan {year}</div>
            {isCurrentYear && (
              <div className="text-[10px] text-zinc-600 font-medium">à fin {MONTHS_FR[lastMonth].toLowerCase()}</div>
            )}
          </div>
          {state.settings.ursaffEnabled !== false ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-zinc-500">CA URSSAF</div>
                <div className="text-xl font-bold text-white">{fmt(totals.brutTaxable, { decimals: 0 })} €</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">Hors URSSAF</div>
                <div className="text-xl font-bold text-zinc-300">{fmt(totals.brutNonTaxable, { decimals: 0 })} €</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">URSSAF dû</div>
                <div className="text-xl font-bold text-orange-400">{fmt(totals.ursaff, { decimals: 0 })} €</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">Charges</div>
                <div className="text-xl font-bold text-rose-400">{fmt(totals.charges, { decimals: 0 })} €</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-zinc-500">Chiffre d'affaires</div>
                <div className="text-xl font-bold text-white">{fmt(totals.brut, { decimals: 0 })} €</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">Charges</div>
                <div className="text-xl font-bold text-rose-400">{fmt(totals.charges, { decimals: 0 })} €</div>
              </div>
            </div>
          )}
          <div className="border-t border-zinc-800 mt-4 pt-3 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Net annuel</div>
            <div className={`text-2xl font-bold ${totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totals.net >= 0 ? '+' : ''}{fmt(totals.net, { decimals: 0 })} €
            </div>
          </div>
        </Card>

        {state.settings.ursaffEnabled !== false && (<>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Déclarations URSSAF</div>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {quarters.map(q => (
            <Card key={q.q} className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Trimestre {q.q}</div>
              <div className="text-[15px] font-bold text-white mt-1">{fmt(q.brutTaxable, { decimals: 0 })} €</div>
              <div className="text-[11px] text-orange-400 mt-0.5">{fmt(q.ursaffDue, { decimals: 0 })} € URSSAF</div>
            </Card>
          ))}
        </div>
        </>)}

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Dépenses annuelles</div>
        <Card className="p-5 mb-5">
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 font-semibold mb-1.5">Total {year}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[32px] font-bold text-rose-400 leading-none" style={{ letterSpacing: '-0.8px' }}>
                  −{fmt(varYear.total, { decimals: 0 })}
                </span>
                <span className="text-[18px] text-rose-400/60 font-medium">€</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-zinc-500">{varYear.count} dépense{varYear.count !== 1 ? 's' : ''}</div>
              <div className="text-[13px] font-semibold text-zinc-400 mt-0.5">{varYear.top.length} catégorie{varYear.top.length !== 1 ? 's' : ''}</div>
            </div>
          </div>

          {varYear.top.length > 0 ? (
            <>
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-600 font-semibold mb-3">Top catégories</div>
              <div className="space-y-3">
                {varYear.top.slice(0, 5).map(({ cid, cat, total, count }) => {
                  const pct = varYear.total > 0 ? (total / varYear.total) * 100 : 0;
                  return (
                    <div key={cid}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat?.color || '#8E8E93' }} />
                          <span className="text-[13.5px] font-semibold text-white truncate" style={{ letterSpacing: '-0.1px' }}>
                            {cat?.name || 'Autre'}
                          </span>
                          <span className="text-[11px] text-zinc-600 flex-shrink-0">{count}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5 flex-shrink-0">
                          <span className="text-[13.5px] font-semibold text-white">{fmt(total, { decimals: 0 })} €</span>
                          <span className="text-[11px] text-zinc-500 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: cat?.color || '#8E8E93' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-[13px] text-zinc-600 text-center py-2">Aucune dépense variable cette année.</div>
          )}
        </Card>

        {/* ── PAR ACTIVITÉ ── */}
        {state.activities.length > 0 && (() => {
          const byActivity = {};
          state.activities.forEach(a => { byActivity[a.id] = 0; });
          state.transactions.forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === year) byActivity[t.activityId] = (byActivity[t.activityId] || 0) + Number(t.amount || 0);
          });
          const sorted = [...state.activities]
            .filter(a => (byActivity[a.id] || 0) > 0)
            .sort((a, b) => (byActivity[b.id] || 0) - (byActivity[a.id] || 0));
          if (sorted.length === 0) return null;
          return (
            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Par activité</div>
              <Card>
                {sorted.map((a, i) => {
                  const total = byActivity[a.id] || 0;
                  const pct = totals.brut > 0 ? (total / totals.brut) * 100 : 0;
                  const rank = i + 1; // 1, 2, 3...
                  const isPodium = rank <= 3;
                  const isTop1 = rank === 1;
                  return (
                    <div
                      key={a.id}
                      className={`p-4 ${i < sorted.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
                      style={isTop1 ? {
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 100%)',
                      } : {}}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isPodium && (
                            <span className={`text-[10px] font-bold tabular-nums w-4 text-center ${
                              isTop1 ? 'text-white' : rank === 2 ? 'text-zinc-300' : 'text-zinc-500'
                            }`} style={isTop1 ? { textShadow: '0 0 8px rgba(255,255,255,0.35)' } : {}}>
                              {rank}
                            </span>
                          )}
                          <div className={`rounded-full flex-shrink-0 ${isTop1 ? 'w-3 h-3' : 'w-2.5 h-2.5'}`}
                            style={{
                              backgroundColor: a.color,
                              boxShadow: isTop1 ? `0 0 10px ${a.color}80` : 'none',
                            }} />
                          <div className={`font-medium text-white truncate ${isTop1 ? 'text-[15px]' : 'text-[14px]'}`}
                            style={isTop1 ? { letterSpacing: '-0.2px' } : {}}>
                            {a.name}
                          </div>
                          {isTop1 && pct >= 40 && (
                            <span className="px-1.5 py-px rounded-md text-[9px] font-semibold uppercase tracking-wider flex-shrink-0"
                              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              Source principale
                            </span>
                          )}
                          {rank === 2 && pct >= 20 && (
                            <span className="px-1.5 py-px rounded-md bg-zinc-800/80 text-zinc-400 text-[9px] uppercase tracking-wider flex-shrink-0">
                              Activité clé
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1.5 flex-shrink-0">
                          <span className={`font-bold text-white ${isTop1 ? 'text-[15px]' : 'text-[14px]'}`}>
                            {fmt(total, { decimals: 0 })} €
                          </span>
                          <span className="text-[11px] text-zinc-500 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: a.color }} />
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>
          );
        })()}

        {/* ── PAR CLIENT ── */}
        {(state.clients || []).length > 0 && (() => {
          const byClient = {};
          state.transactions.forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === year && t.clientId) {
              byClient[t.clientId] = (byClient[t.clientId] || 0) + Number(t.amount || 0);
            }
          });
          const sorted = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
          if (sorted.length === 0) return null;
          return (
            <div className="mt-6 mb-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Par client</div>
              <Card>
                {sorted.map(([cid, total], i) => {
                  const client = (state.clients || []).find(c => c.id === cid);
                  const pct = totals.brut > 0 ? (total / totals.brut) * 100 : 0;
                  const rank = i + 1;
                  const isPodium = rank <= 3;
                  const isTop1 = rank === 1;
                  return (
                    <div
                      key={cid}
                      className={`p-4 ${i < sorted.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
                      style={isTop1 ? {
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 100%)',
                      } : {}}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isPodium && (
                            <span className={`text-[10px] font-bold tabular-nums w-4 text-center ${
                              isTop1 ? 'text-white' : rank === 2 ? 'text-zinc-300' : 'text-zinc-500'
                            }`} style={isTop1 ? { textShadow: '0 0 8px rgba(255,255,255,0.35)' } : {}}>
                              {rank}
                            </span>
                          )}
                          <div className={`rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 ${isTop1 ? 'w-8 h-8' : 'w-7 h-7'}`}
                            style={isTop1 ? { boxShadow: '0 0 14px rgba(96,165,250,0.25)' } : {}}>
                            <User className={`text-zinc-400 ${isTop1 ? 'w-4 h-4' : 'w-3.5 h-3.5'}`} />
                          </div>
                          <div className={`font-medium text-white truncate ${isTop1 ? 'text-[15px]' : 'text-[14px]'}`}
                            style={isTop1 ? { letterSpacing: '-0.2px' } : {}}>
                            {client?.name || 'Client inconnu'}
                          </div>
                          {isTop1 && pct >= 30 && (
                            <span className="px-1.5 py-px rounded-md text-[9px] font-semibold uppercase tracking-wider flex-shrink-0"
                              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.08)' }}>
                              Client stratégique
                            </span>
                          )}
                          {rank === 2 && pct >= 15 && (
                            <span className="px-1.5 py-px rounded-md bg-zinc-800/80 text-zinc-400 text-[9px] uppercase tracking-wider flex-shrink-0">
                              Partenaire clé
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1.5 flex-shrink-0">
                          <span className={`font-bold text-white ${isTop1 ? 'text-[15px]' : 'text-[14px]'}`}>
                            {fmt(total, { decimals: 0 })} €
                          </span>
                          <span className="text-[11px] text-zinc-500 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

const SettingsPage = ({ state, setState, user, onSignOut, onBack, onExport }) => {
  const [editActivity, setEditActivity] = useState(null);
  const [editExpense, setEditExpense] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const [ursaffInput, setUrsaffInput] = useState((state.settings.ursaffRate * 100).toString());
  const [resetSheet, setResetSheet] = useState(false);

  useEffect(() => {
    setUrsaffInput((state.settings.ursaffRate * 100).toString());
  }, [state.settings.ursaffRate]);

  const saveUrsaff = () => {
    const v = parseFloat(ursaffInput.replace(',', '.'));
    if (!isNaN(v) && v >= 0 && v <= 100) {
      setState(s => ({ ...s, settings: { ...s.settings, ursaffRate: v / 100 } }));
    } else {
      setUrsaffInput((state.settings.ursaffRate * 100).toString());
    }
  };

  const setSetting = (key, value) => {
    setState(s => ({ ...s, settings: { ...s.settings, [key]: value } }));
  };

  const txCountByActivity = useMemo(() => {
    const m = {};
    state.transactions.forEach(t => { m[t.activityId] = (m[t.activityId] || 0) + 1; });
    return m;
  }, [state.transactions]);

  return (
    <div className="pb-32">
      <TopBar subtitle="Paramètres" title="Réglages" right={onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-zinc-400 active:opacity-60">
          <ChevronLeft className="w-4 h-4" /> Profil
        </button>
      )} />

      <div className="px-5">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Affichage</div>
        <Card className="mb-5">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800/60">
            <div className="flex-1 pr-3">
              <div className="text-[14px] font-medium text-white">Afficher les décimales</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {state.settings.showDecimals !== false ? '1 250,42 €' : '1 250 €'}
                <span className="text-zinc-600"> · les calculs restent précis</span>
              </div>
            </div>
            <Toggle value={state.settings.showDecimals !== false} onChange={v => setSetting('showDecimals', v)} />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex-1 pr-3">
              <div className="text-[14px] font-medium text-white">Gestion URSSAF activée</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                {state.settings.ursaffEnabled !== false
                  ? 'Cotisations, taux et déclarations actifs'
                  : 'Mode budget classique — URSSAF masqué partout'}
              </div>
            </div>
            <Toggle value={state.settings.ursaffEnabled !== false} onChange={v => setSetting('ursaffEnabled', v)} />
          </div>
        </Card>

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Données</div>
        <Card className="mb-5">
          <button
            onClick={() => onExport && onExport()}
            className="w-full flex items-center justify-between p-4 active:bg-[#252527]"
          >
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <FileText className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="text-left">
                <div className="text-[14px] font-medium text-white">Exporter mes données</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Revenus, dépenses, bilans · CSV</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>
        </Card>

        {state.settings.ursaffEnabled !== false && (<>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Cotisations</div>
        <Card className="mb-5">
          <div className="p-4 border-b border-zinc-800/60">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[14px] font-medium text-white">Taux URSSAF</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Appliqué aux revenus déclarés · 0% = désactivé</div>
              </div>
              <div className="flex items-center gap-1 bg-zinc-800 rounded-lg px-3 py-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={ursaffInput}
                  onChange={(e) => setUrsaffInput(e.target.value)}
                  className="bg-transparent text-white text-[14px] font-semibold w-12 text-right outline-none"
                />
                <span className="text-zinc-400 text-[14px]">%</span>
              </div>
            </div>
            {/* Bouton de validation explicite — apparaît seulement si la valeur saisie diffère du taux enregistré */}
            {(() => {
              const v = parseFloat(ursaffInput.replace(',', '.'));
              const valid = !isNaN(v) && v >= 0 && v <= 100;
              const current = (state.settings.ursaffRate * 100);
              const dirty = !isNaN(v) && Math.abs(v - current) > 0.001;
              if (!dirty) return null;
              return (
                <button
                  onClick={saveUrsaff}
                  disabled={!valid}
                  className="w-full mt-2 py-2.5 rounded-xl bg-white text-black text-[13px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={3} /> Valider {valid ? `${v}%` : ''}
                </button>
              );
            })()}
          </div>
          <div className="p-4">
            <div className="text-[14px] font-medium text-white mb-2">Fréquence de déclaration</div>
            <div className="grid grid-cols-2 gap-2">
              {[{ k: 'monthly', l: 'Mensuelle' }, { k: 'quarterly', l: 'Trimestrielle' }].map(o => (
                <button
                  key={o.k}
                  onClick={() => setSetting('declarationFrequency', o.k)}
                  className={`py-2.5 rounded-xl text-[13px] font-medium transition-colors ${state.settings.declarationFrequency === o.k ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        </Card>
        </>)}

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Notifications</div>
        <Card className="mb-5">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800/60">
            <div className="flex items-center gap-3">
              <Bell className="w-4 h-4 text-zinc-400" />
              <div>
                <div className="text-[14px] font-medium text-white">Rappels activés</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Charges à venir, retards, déclarations</div>
              </div>
            </div>
            <Toggle value={!!state.settings.notificationsEnabled} onChange={v => setSetting('notificationsEnabled', v)} />
          </div>
          {state.settings.notificationsEnabled && (
            <div className="p-4">
              <div className="text-[14px] font-medium text-white mb-2">Prévenir X jours avant</div>
              <div className="grid grid-cols-4 gap-2">
                {[3, 7, 10, 14].map(d => (
                  <button
                    key={d}
                    onClick={() => setSetting('expenseReminderDays', d)}
                    className={`py-2.5 rounded-xl text-[13px] font-medium transition-colors ${state.settings.expenseReminderDays === d ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
                  >
                    {d}j
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">
          Activités <span className="text-zinc-600">· {state.activities.filter(a => a.active !== false).length} actives</span>
        </div>
        <Card className="mb-5">
          {[...state.activities].sort((a, b) => a.order - b.order).map((a, i) => (
            <div
              key={a.id}
              onClick={() => setEditActivity(a)}
              className={`flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer ${i < state.activities.length - 1 ? 'border-b border-zinc-800/60' : ''} ${a.active === false ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-white truncate flex items-center gap-1.5">
                    {a.name}
                    {a.active === false && <EyeOff className="w-3 h-3 text-zinc-600" />}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {a.taxable ? 'Soumis URSSAF' : 'Non soumis URSSAF'}
                    {txCountByActivity[a.id] > 0 && ` · ${txCountByActivity[a.id]} tx`}
                  </div>
                </div>
              </div>
              <Edit3 className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            </div>
          ))}
          <button
            onClick={() => setEditActivity({ id: 'new', name: '', color: '#5E5CE6', taxable: true, active: true, order: state.activities.length + 1 })}
            className="w-full p-4 flex items-center justify-center gap-2 border-t border-zinc-800/60 text-emerald-400 text-[14px] font-medium active:bg-[#252527]"
          >
            <Plus className="w-4 h-4" /> Nouvelle activité
          </button>
        </Card>

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Catégories de charges</div>
        <Card className="mb-5">
          {[...state.categories].sort((a, b) => a.order - b.order).map((c, i) => (
            <div
              key={c.id}
              onClick={() => setEditCategory(c)}
              className={`flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer ${i < state.categories.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <div className="text-[14px] font-medium text-white">{c.name}</div>
              </div>
              <Edit3 className="w-4 h-4 text-zinc-500" />
            </div>
          ))}
          <button
            onClick={() => setEditCategory({ id: 'new', name: '', color: '#5E5CE6', order: state.categories.length + 1 })}
            className="w-full p-4 flex items-center justify-center gap-2 border-t border-zinc-800/60 text-emerald-400 text-[14px] font-medium active:bg-[#252527]"
          >
            <Plus className="w-4 h-4" /> Nouvelle catégorie
          </button>
        </Card>

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Charges récurrentes</div>
        <Card>
          {state.expenses.map((e, i) => {
            const cat = state.categories.find(c => c.id === e.categoryId);
            return (
              <div
                key={e.id}
                onClick={() => setEditExpense(e)}
                className={`flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer ${i < state.expenses.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <div className="text-[14px] font-medium text-white truncate">{e.name}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1.5">
                    {cat && <span className="w-1 h-1 rounded-full" style={{ backgroundColor: cat.color }} />}
                    {cat?.name || 'Sans catégorie'} · {e.frequency === 'monthly' ? 'Mensuel' : e.frequency === 'bimonthly' ? 'Bimestriel' : 'Annuel'}
                  </div>
                </div>
                <div className="text-[14px] font-semibold text-white mr-2">{fmt(e.amount)} €</div>
                <Edit3 className="w-4 h-4 text-zinc-500" />
              </div>
            );
          })}
          <button
            onClick={() => setEditExpense({ id: 'new', name: '', categoryId: state.categories[0]?.id || '', amount: 0, frequency: 'monthly', dueDay: 1 })}
            className="w-full p-4 flex items-center justify-center gap-2 border-t border-zinc-800/60 text-emerald-400 text-[14px] font-medium active:bg-[#252527]"
          >
            <Plus className="w-4 h-4" /> Nouvelle charge
          </button>
        </Card>

        <div className="mt-8 mb-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Réinitialisation</div>
          <Card>
            <button
              onClick={() => setResetSheet(true)}
              className="w-full flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-xl bg-rose-500/15 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                </div>
                <span className="text-[14px] font-medium text-rose-400">Réinitialiser mon compte</span>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-600" />
            </button>
          </Card>
        </div>

        <div className="mt-8 mb-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Compte</div>
          <Card>
            <div className="flex items-center gap-3 p-4 border-b border-zinc-800/60">
              <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-400 text-[15px] font-bold">
                  {(user?.user_metadata?.first_name || user?.email || '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white truncate">
                  {user?.user_metadata?.first_name
                    ? `${user.user_metadata.first_name}${user.user_metadata.username ? ' · @' + user.user_metadata.username : ''}`
                    : 'Mon compte'
                  }
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{user?.email}</div>
              </div>
            </div>
            <button
              onClick={onSignOut}
              className="w-full flex items-center justify-between p-4 border-b border-zinc-800/60 active:bg-[#252527] cursor-pointer"
            >
              <span className="text-[14px] font-medium text-rose-400">Se déconnecter</span>
              <ChevronRight className="w-4 h-4 text-zinc-600" />
            </button>
            <button
              onClick={async () => {
                if (window.confirm('Supprimer définitivement ton compte et toutes tes données ? Cette action est irréversible.')) {
                  await supabase.from('app_state').delete().eq('user_id', user.id);
                  await supabase.auth.signOut();
                }
              }}
              className="w-full flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer"
            >
              <span className="text-[14px] font-medium text-zinc-500">Supprimer mon compte</span>
              <ChevronRight className="w-4 h-4 text-zinc-700" />
            </button>
          </Card>
        </div>

        <div className="mt-4 mb-8 text-center text-[11px] text-zinc-600">
          v2.0 · Données synchronisées
        </div>
      </div>

      <ActivityEditor activity={editActivity} setState={setState} state={state} onClose={() => setEditActivity(null)} txCount={editActivity ? (txCountByActivity[editActivity.id] || 0) : 0} />
      <ExpenseEditor expense={editExpense} setState={setState} state={state} onClose={() => setEditExpense(null)} />
      <CategoryEditor category={editCategory} setState={setState} state={state} onClose={() => setEditCategory(null)} />

      <Sheet open={resetSheet} onClose={() => setResetSheet(false)} title="Réinitialiser">
        <div className="space-y-3 pb-2">
          <p className="text-[13px] text-zinc-400 leading-relaxed">
            Choisis ce que tu veux réinitialiser. Cette action est <span className="text-rose-400 font-medium">irréversible</span>.
          </p>

          <button
            onClick={() => {
              if (!window.confirm('Effacer toutes les transactions, ventes et dépenses ? Tes activités et catégories seront conservées.')) return;
              setState(s => ({ ...s, transactions: [], varExpenses: [], paidExpenses: {}, expenseOverrides: {}, notes: {}, controls: [] }));
              setResetSheet(false);
            }}
            className="w-full p-4 bg-[#2C2C2E] rounded-2xl text-left active:bg-[#3A3A3C]"
          >
            <div className="text-[14px] font-semibold text-white mb-1">Réinitialiser les chiffres</div>
            <div className="text-[12px] text-zinc-500 leading-relaxed">Supprime toutes les ventes, dépenses et historique. Tes activités et catégories sont conservées.</div>
          </button>

          <button
            onClick={() => {
              if (!window.confirm('Tout réinitialiser ? Activités, catégories, données… tout sera effacé. Cette action est irréversible.')) return;
              setState(DEFAULT_STATE);
              setResetSheet(false);
            }}
            className="w-full p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-left active:bg-rose-500/20"
          >
            <div className="text-[14px] font-semibold text-rose-400 mb-1">Tout réinitialiser</div>
            <div className="text-[12px] text-zinc-500 leading-relaxed">Remet l'application à zéro complet : activités, catégories, données, tout.</div>
          </button>
        </div>
      </Sheet>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

const COLORS = ['#00D26A', '#FF9F0A', '#5E5CE6', '#FF375F', '#0A84FF', '#BF5AF2', '#FFD60A', '#64D2FF', '#30D158', '#FF453A', '#8E8E93', '#A78BFA'];

const ActivityEditor = ({ activity, setState, onClose, txCount }) => {
  const [form, setForm] = useState(null);
  useEffect(() => { if (activity) setForm({ ...activity, active: activity.active !== false }); }, [activity]);

  if (!activity || !form) return null;
  const isNew = activity.id === 'new';
  const hasTransactions = !isNew && txCount > 0;

  const save = () => {
    if (!form.name.trim()) return;
    setState(s => {
      if (isNew) return { ...s, activities: [...s.activities, { ...form, id: newId() }] };
      return { ...s, activities: s.activities.map(a => a.id === form.id ? form : a) };
    });
    onClose();
  };

  const deactivate = () => {
    setState(s => ({ ...s, activities: s.activities.map(a => a.id === form.id ? { ...a, active: false } : a) }));
    onClose();
  };

  const remove = () => {
    setState(s => ({ ...s, activities: s.activities.filter(a => a.id !== form.id) }));
    onClose();
  };

  return (
    <Sheet open={!!activity} onClose={onClose} title={isNew ? 'Nouvelle activité' : 'Modifier'}>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Nom</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ex. Mon activité"
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none focus:bg-[#3A3A3C]"
          />
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Couleur</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`w-8 h-8 rounded-full transition-transform ${form.color === c ? 'scale-110 ring-2 ring-white' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between bg-[#2C2C2E] rounded-xl px-4 py-3">
          <div>
            <div className="text-[14px] text-white font-medium">Soumis à l'URSSAF</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{form.taxable ? 'Compte dans le CA et les cotisations' : 'Hors CA URSSAF, hors cotisations'}</div>
          </div>
          <Toggle value={form.taxable} onChange={v => setForm({ ...form, taxable: v })} />
        </div>

        {!isNew && (
          <div className="flex items-center justify-between bg-[#2C2C2E] rounded-xl px-4 py-3">
            <div>
              <div className="text-[14px] text-white font-medium">Actif</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{form.active ? 'Visible dans les écrans actifs' : 'Masqué (historique préservé)'}</div>
            </div>
            <Toggle value={form.active} onChange={v => setForm({ ...form, active: v })} />
          </div>
        )}

        <button onClick={save} className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform">
          {isNew ? 'Créer' : 'Enregistrer'}
        </button>

        {!isNew && (
          hasTransactions ? (
            <div className="text-center">
              <div className="text-[11px] text-zinc-500 mb-2">
                Cette activité a {txCount} transaction{txCount > 1 ? 's' : ''}.<br />
                Suppression désactivée pour préserver l'historique.
              </div>
              {form.active && (
                <button onClick={deactivate} className="w-full text-orange-400 text-[14px] font-medium py-2 flex items-center justify-center gap-2">
                  <Power className="w-3.5 h-3.5" /> Désactiver à la place
                </button>
              )}
            </div>
          ) : (
            <button onClick={remove} className="w-full text-rose-400 text-[14px] font-medium py-2">
              Supprimer cette activité
            </button>
          )
        )}
      </div>
    </Sheet>
  );
};

const ExpenseEditor = ({ expense, setState, state, onClose }) => {
  const [form, setForm] = useState(null);
  useEffect(() => { if (expense) setForm({ ...expense }); }, [expense]);

  if (!expense || !form) return null;
  const isNew = expense.id === 'new';

  const save = () => {
    if (!form.name.trim()) return;
    const amount = parseFloat(String(form.amount).replace(',', '.')) || 0;
    const dueDay = Math.max(1, Math.min(31, parseInt(form.dueDay) || 1));
    setState(s => {
      const payload = { ...form, amount, dueDay };
      if (isNew) return { ...s, expenses: [...s.expenses, { ...payload, id: newId() }] };
      return { ...s, expenses: s.expenses.map(e => e.id === payload.id ? payload : e) };
    });
    onClose();
  };

  const remove = () => {
    setState(s => ({ ...s, expenses: s.expenses.filter(e => e.id !== form.id) }));
    onClose();
  };

  const FREQS = [{ k: 'monthly', l: 'Mensuel' }, { k: 'bimonthly', l: 'Bimestriel' }, { k: 'annual', l: 'Annuel' }];

  return (
    <Sheet open={!!expense} onClose={onClose} title={isNew ? 'Nouvelle charge' : 'Modifier'}>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Nom</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Montant</label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 mt-0.5">€</span>
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Jour</label>
            <input
              type="number"
              min={1}
              max={31}
              value={form.dueDay || ''}
              onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
              className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Catégorie</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {[...state.categories].sort((a, b) => a.order - b.order).map(c => (
              <button
                key={c.id}
                onClick={() => setForm({ ...form, categoryId: c.id })}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 ${form.categoryId === c.id ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Fréquence</label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {FREQS.map(f => (
              <button
                key={f.k}
                onClick={() => setForm({ ...form, frequency: f.k })}
                className={`py-2.5 rounded-xl text-[13px] font-medium transition-colors ${form.frequency === f.k ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
              >
                {f.l}
              </button>
            ))}
          </div>
        </div>

        {form.frequency === 'annual' && (
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Mois (annuel)</label>
            <div className="grid grid-cols-6 gap-1.5 mt-2">
              {MONTHS_SHORT.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setForm({ ...form, dueMonth: i })}
                  className={`py-2 rounded-lg text-[11px] font-medium ${form.dueMonth === i ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={save} className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform">
          {isNew ? 'Créer' : 'Enregistrer'}
        </button>

        {!isNew && (
          <button onClick={remove} className="w-full text-rose-400 text-[14px] font-medium py-2">
            Supprimer cette charge
          </button>
        )}
      </div>
    </Sheet>
  );
};

const CategoryEditor = ({ category, setState, state, onClose }) => {
  const [form, setForm] = useState(null);
  useEffect(() => { if (category) setForm({ ...category }); }, [category]);

  if (!category || !form) return null;
  const isNew = category.id === 'new';

  const usedBy = !isNew ? state.expenses.filter(e => e.categoryId === form.id).length : 0;

  const save = () => {
    if (!form.name.trim()) return;
    setState(s => {
      if (isNew) return { ...s, categories: [...s.categories, { ...form, id: newId() }] };
      return { ...s, categories: s.categories.map(c => c.id === form.id ? form : c) };
    });
    onClose();
  };

  const remove = () => {
    if (usedBy > 0) return;
    setState(s => ({ ...s, categories: s.categories.filter(c => c.id !== form.id) }));
    onClose();
  };

  return (
    <Sheet open={!!category} onClose={onClose} title={isNew ? 'Nouvelle catégorie' : 'Modifier'}>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Nom</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ex. Logement"
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Couleur</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`w-8 h-8 rounded-full transition-transform ${form.color === c ? 'scale-110 ring-2 ring-white' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <button onClick={save} className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform">
          {isNew ? 'Créer' : 'Enregistrer'}
        </button>

        {!isNew && (
          usedBy > 0 ? (
            <div className="text-center text-[11px] text-zinc-500">
              Utilisée par {usedBy} charge{usedBy > 1 ? 's' : ''}.<br />
              Réaffecte-les avant de supprimer.
            </div>
          ) : (
            <button onClick={remove} className="w-full text-rose-400 text-[14px] font-medium py-2">
              Supprimer cette catégorie
            </button>
          )
        )}
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Add transaction
// ---------------------------------------------------------------------------

const AddTransactionSheet = ({ open, onClose, state, setState, defaultYear, defaultMonth }) => {
  const [step, setStep] = useState(1);
  const [activityId, setActivityId] = useState(null);
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1); setActivityId(null); setAmount(''); setDescription('');
      setClientId(''); setNewClientName(''); setShowNewClient(false);
      const today = new Date();
      if (today.getFullYear() === defaultYear && today.getMonth() === defaultMonth) {
        setDate(today.toISOString().slice(0, 10));
      } else {
        setDate(`${defaultYear}-${String(defaultMonth + 1).padStart(2, '0')}-15`);
      }
    }
  }, [open, defaultYear, defaultMonth]);

  const createAndSelectClient = () => {
    if (!newClientName.trim()) return;
    const id = newId();
    setState(s => ({ ...s, clients: [...(s.clients || []), { id, name: newClientName.trim() }] }));
    setClientId(id);
    setNewClientName('');
    setShowNewClient(false);
  };

  const save = () => {
    const a = parseFloat(amount.replace(',', '.'));
    if (!activityId || isNaN(a) || a <= 0) return;
    const tx = { id: newId(), activityId, clientId: clientId || null, amount: a, description: description.trim(), date };
    setState(s => ({ ...s, transactions: [...s.transactions, tx] }));
    onClose();
  };

  const activity = state.activities.find(a => a.id === activityId);
  const activeActivities = state.activities.filter(a => a.active !== false).sort((a, b) => a.order - b.order);
  const clients = state.clients || [];
  const selectedClient = clients.find(c => c.id === clientId);

  return (
    <Sheet open={open} onClose={onClose} title="Nouvelle vente">
      {step === 1 && (
        <div>
          <div className="text-[13px] text-zinc-400 mb-3">Pour quelle activité ?</div>
          <div className="space-y-2">
            {activeActivities.map(a => (
              <button
                key={a.id}
                onClick={() => { setActivityId(a.id); setStep(2); }}
                className="w-full flex items-center gap-3 p-4 bg-[#2C2C2E] rounded-xl active:bg-[#3A3A3C] transition-colors"
              >
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: a.color }} />
                <div className="text-left flex-1">
                  <div className="text-[15px] font-medium text-white">{a.name}</div>
                  {!a.taxable && <div className="text-[10px] text-zinc-500 mt-0.5 uppercase tracking-wider">non URSSAF</div>}
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-500" />
              </button>
            ))}
            {activeActivities.length === 0 && (
              <div className="text-center text-zinc-500 text-sm py-8">
                Aucune activité active.<br />Va dans Réglages pour en créer.
              </div>
            )}
          </div>
        </div>
      )}

      {step === 2 && activity && (
        <div>
          <div className="flex items-center gap-2 mb-4 px-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activity.color }} />
            <div className="text-[13px] font-medium text-white">{activity.name}</div>
            {!activity.taxable && <span className="px-1.5 py-px rounded bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider">non URSSAF</span>}
            <button onClick={() => setStep(1)} className="ml-auto text-[12px] text-emerald-400">Modifier</button>
          </div>

          <div className="mb-5">
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Montant</label>
            <div className="relative mt-1.5">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                autoFocus
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-[#2C2C2E] rounded-xl px-4 py-4 text-white text-[28px] font-bold outline-none pr-10"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-xl font-bold">€</span>
            </div>
            {/* Estimation URSSAF dynamique — visible uniquement si activité taxable + URSSAF activée + montant > 0 */}
            {(() => {
              const n = parseFloat(String(amount).replace(',', '.'));
              const ursaffEnabled = state.settings.ursaffEnabled !== false;
              if (!activity?.taxable || !ursaffEnabled || isNaN(n) || n <= 0 || !state.settings.ursaffRate) return null;
              const toSave = n * state.settings.ursaffRate;
              return (
                <div className="mt-2 px-3 py-2.5 rounded-xl flex items-center gap-2.5"
                  style={{ background: 'rgba(255,159,10,0.08)', border: '1px solid rgba(255,159,10,0.18)' }}>
                  <div className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-3.5 h-3.5 text-orange-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10.5px] uppercase tracking-wider text-orange-400/70 font-semibold">À mettre de côté</div>
                    <div className="text-[13.5px] font-bold text-orange-300 leading-tight">
                      {fmt(toSave, { decimals: 2 })} € pour l'URSSAF
                    </div>
                  </div>
                  <div className="text-[10px] text-orange-400/60 font-medium tabular-nums">
                    {Math.round(state.settings.ursaffRate * 100)}%
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="mb-5">
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Description (optionnelle)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex. Client TCD Padel"
              className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
            />
          </div>

          <div className="mb-5">
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Client (optionnel)</label>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                onClick={() => setClientId('')}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${!clientId ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
              >
                Aucun
              </button>
              {clients.map(c => (
                <button
                  key={c.id}
                  onClick={() => setClientId(c.id)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 ${clientId === c.id ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
                >
                  <User className="w-3 h-3" />{c.name}
                </button>
              ))}
              {showNewClient ? (
                <div className="flex gap-2 w-full mt-1">
                  <input
                    autoFocus
                    type="text"
                    value={newClientName}
                    onChange={e => setNewClientName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createAndSelectClient()}
                    placeholder="Nom du client"
                    className="flex-1 bg-[#2C2C2E] rounded-xl px-3 py-2 text-white text-[13px] outline-none"
                  />
                  <button onClick={createAndSelectClient} className="px-3 py-2 bg-emerald-500/20 text-emerald-400 rounded-xl text-[12px] font-medium">OK</button>
                  <button onClick={() => setShowNewClient(false)} className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded-xl text-[12px]">✕</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewClient(true)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-emerald-500/10 text-emerald-400 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Nouveau
                </button>
              )}
            </div>
          </div>

          <div className="mb-5">
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
            />
          </div>

          <button
            onClick={save}
            disabled={!amount || parseFloat(amount.replace(',', '.')) <= 0}
            className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform disabled:opacity-40 disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            Enregistrer
          </button>
        </div>
      )}
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Variable expenses page
// ---------------------------------------------------------------------------

const VarExpenseEditor = ({ expense, state, setState, onClose, defaultYear, defaultMonth }) => {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (expense) {
      if (expense.id === 'new') {
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === defaultYear && today.getMonth() === defaultMonth;
        const date = isCurrentMonth
          ? today.toISOString().slice(0, 10)
          : `${defaultYear}-${String(defaultMonth + 1).padStart(2, '0')}-15`;
        setForm({ id: 'new', amount: '', categoryId: state.varCategories?.[0]?.id || '', description: '', date });
      } else {
        setForm({ ...expense });
      }
    }
  }, [expense]);

  if (!expense || !form) return null;
  const isNew = expense.id === 'new';

  const save = () => {
    const a = parseFloat(String(form.amount).replace(',', '.'));
    if (isNaN(a) || a <= 0) return;
    const payload = { ...form, amount: a, id: isNew ? newId() : form.id };
    setState(s => ({
      ...s,
      varExpenses: isNew
        ? [...(s.varExpenses || []), payload]
        : (s.varExpenses || []).map(e => e.id === payload.id ? payload : e),
    }));
    onClose();
  };

  const remove = () => {
    setState(s => ({ ...s, varExpenses: (s.varExpenses || []).filter(e => e.id !== form.id) }));
    onClose();
  };

  const sortedCats = [...(state.varCategories || [])].sort((a, b) => a.order - b.order);

  return (
    <Sheet open={!!expense} onClose={onClose} title={isNew ? 'Nouvelle dépense' : 'Modifier'}>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Montant</label>
          <div className="relative mt-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              autoFocus={isNew}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0"
              className="w-full bg-[#2C2C2E] rounded-xl px-4 py-4 text-white text-[28px] font-bold outline-none pr-10"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 text-xl font-bold">€</span>
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Catégorie</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {sortedCats.map(c => (
              <button
                key={c.id}
                onClick={() => setForm({ ...form, categoryId: c.id })}
                className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5 ${form.categoryId === c.id ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Description (optionnelle)</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Ex. Plein d'essence autoroute"
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>

        <button
          onClick={save}
          disabled={!form.amount || parseFloat(String(form.amount).replace(',', '.')) <= 0}
          className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform disabled:opacity-40 disabled:bg-zinc-700 disabled:text-zinc-500"
        >
          {isNew ? 'Enregistrer' : 'Modifier'}
        </button>

        {!isNew && (
          <button onClick={remove} className="w-full text-rose-400 text-[14px] font-medium py-2">
            Supprimer cette dépense
          </button>
        )}
      </div>
    </Sheet>
  );
};

const VarCategoryEditor = ({ category, state, setState, onClose }) => {
  const [form, setForm] = useState(null);
  useEffect(() => { if (category) setForm({ ...category }); }, [category]);

  if (!category || !form) return null;
  const isNew = category.id === 'new';
  const usedBy = !isNew ? (state.varExpenses || []).filter(e => e.categoryId === form.id).length : 0;

  const save = () => {
    if (!form.name.trim()) return;
    setState(s => {
      const cats = s.varCategories || [];
      if (isNew) return { ...s, varCategories: [...cats, { ...form, id: newId() }] };
      return { ...s, varCategories: cats.map(c => c.id === form.id ? form : c) };
    });
    onClose();
  };

  const remove = () => {
    if (usedBy > 0) return;
    setState(s => ({ ...s, varCategories: (s.varCategories || []).filter(c => c.id !== form.id) }));
    onClose();
  };

  return (
    <Sheet open={!!category} onClose={onClose} title={isNew ? 'Nouvelle catégorie' : 'Modifier'}>
      <div className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Nom</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ex. Transport"
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Couleur</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`w-8 h-8 rounded-full transition-transform ${form.color === c ? 'scale-110 ring-2 ring-white' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <button onClick={save} className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform">
          {isNew ? 'Créer' : 'Enregistrer'}
        </button>
        {!isNew && (
          usedBy > 0 ? (
            <div className="text-center text-[11px] text-zinc-500">
              Utilisée par {usedBy} dépense{usedBy > 1 ? 's' : ''}.<br />
              Réaffecte-les avant de supprimer.
            </div>
          ) : (
            <button onClick={remove} className="w-full text-rose-400 text-[14px] font-medium py-2">
              Supprimer
            </button>
          )
        )}
      </div>
    </Sheet>
  );
};

const VarExpensesPage = ({ state, setState, year, month, setMonth }) => {
  const [addOpen, setAddOpen] = useState(false);
  const [editExpense, setEditExpense] = useState(null);
  const [editCat, setEditCat] = useState(null);
  const [showCatEditor, setShowCatEditor] = useState(false);
  // Catégories repliées par défaut : ids dépliés stockés dans un Set.
  const [expandedCats, setExpandedCats] = useState(() => new Set());
  const toggleCat = (id) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const data = useMemo(() => computeVarMonth(state, year, month), [state, year, month]);
  const sortedCats = useMemo(() => [...(state.varCategories || [])].sort((a, b) => a.order - b.order), [state.varCategories]);
  const catMap = useMemo(() => {
    const m = {};
    (state.varCategories || []).forEach(c => { m[c.id] = c; });
    return m;
  }, [state.varCategories]);

  const byCategory = useMemo(() => {
    const map = {};
    data.items.forEach(e => {
      const cid = e.categoryId || 'autre';
      if (!map[cid]) map[cid] = [];
      map[cid].push(e);
    });
    return map;
  }, [data.items]);

  const sortedCatIds = Object.keys(byCategory).sort((a, b) => {
    return (catMap[a]?.order ?? 999) - (catMap[b]?.order ?? 999);
  });

  return (
    <div className="pb-32">
      <TopBar
        subtitle="Dépenses variables"
        title={MONTHS_FR[month] + ' ' + year}
        right={<MonthSwitcher year={year} month={month} onChange={(y, m) => setMonth(y, m)} />}
      />

      <div className="px-5">
        {/* Summary card */}
        <Card className="p-5 mb-4">
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 font-semibold mb-1.5">Total du mois</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[36px] font-bold text-white leading-none" style={{ letterSpacing: '-1px' }}>{fmt(data.total, { decimals: 2 })}</span>
                <span className="text-[20px] text-zinc-500 font-medium">€</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-zinc-500 mb-1">{data.items.length} dépense{data.items.length !== 1 ? 's' : ''}</div>
              <div className="text-[13px] font-semibold text-zinc-400">{sortedCatIds.length} catégorie{sortedCatIds.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          {sortedCatIds.length > 0 && (
            <div className="flex gap-1 h-1.5 rounded-full overflow-hidden">
              {sortedCatIds.map(cid => {
                const cat = catMap[cid];
                const catTotal = (byCategory[cid] || []).reduce((s, e) => s + e.amount, 0);
                const pct = data.total > 0 ? (catTotal / data.total) * 100 : 0;
                return (
                  <div
                    key={cid}
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: cat?.color || '#8E8E93' }}
                  />
                );
              })}
            </div>
          )}
        </Card>

        {/* Breakdown by category — barres horizontales détaillées */}
        {sortedCatIds.length > 0 && (
          <Card className="p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500 font-semibold">Répartition</div>
              <div className="text-[11px] text-zinc-600">par catégorie</div>
            </div>
            <div className="space-y-3">
              {[...sortedCatIds]
                .map(cid => ({
                  cid,
                  cat: catMap[cid],
                  total: (byCategory[cid] || []).reduce((s, e) => s + e.amount, 0),
                  count: (byCategory[cid] || []).length,
                }))
                .sort((a, b) => b.total - a.total)
                .map(({ cid, cat, total, count }) => {
                  const pct = data.total > 0 ? (total / data.total) * 100 : 0;
                  return (
                    <div key={cid}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat?.color || '#8E8E93' }} />
                          <span className="text-[13.5px] font-semibold text-white truncate" style={{ letterSpacing: '-0.1px' }}>
                            {cat?.name || 'Autre'}
                          </span>
                          <span className="text-[11px] text-zinc-600 flex-shrink-0">{count}</span>
                        </div>
                        <div className="flex items-baseline gap-1.5 flex-shrink-0">
                          <span className="text-[13.5px] font-semibold text-white">{fmt(total, { decimals: 0 })} €</span>
                          <span className="text-[11px] text-zinc-500 tabular-nums">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, backgroundColor: cat?.color || '#8E8E93' }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        )}

        {/* Add button */}
        <button
          onClick={() => setAddOpen(true)}
          className="w-full mb-5 bg-white text-black font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" /> Ajouter une dépense
        </button>

        {/* Expenses by category — sections repliables */}
        {sortedCatIds.map(catId => {
          const cat = catMap[catId];
          const items = byCategory[catId];
          const catTotal = items.reduce((s, e) => s + e.amount, 0);
          const isOpen = expandedCats.has(catId);
          return (
            <div key={catId} className="mb-3">
              {/* Header cliquable — replie/déplie le détail des dépenses */}
              <button
                onClick={() => toggleCat(catId)}
                className="w-full flex items-center justify-between p-4 rounded-2xl bg-[#1C1C1E] border border-zinc-800/60 active:bg-[#252527] transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ChevronRight
                    className="w-4 h-4 text-zinc-500 flex-shrink-0 transition-transform"
                    strokeWidth={2.5}
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  />
                  {cat && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />}
                  <span className="text-[14px] font-semibold text-white truncate">{cat?.name || 'Autre'}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[14px] font-bold text-white">{fmt(catTotal, { decimals: 2 })} €</span>
                  <span className="text-[11px] text-zinc-600">{items.length}</span>
                </div>
              </button>

              {isOpen && (
                <Card className="mt-2">
                  {[...items].sort((a, b) => new Date(b.date) - new Date(a.date)).map((e, i) => (
                    <div
                      key={e.id}
                      onClick={() => setEditExpense(e)}
                      className={`flex items-center gap-3 p-4 active:bg-[#252527] cursor-pointer ${i < items.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium text-white truncate">{e.description || cat?.name || 'Dépense'}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {new Date(e.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                        </div>
                      </div>
                      <div className="text-[14px] font-semibold text-white">{fmt(e.amount, { decimals: 2 })} €</div>
                      <Edit3 className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                    </div>
                  ))}
                </Card>
              )}
            </div>
          );
        })}

        {data.items.length === 0 && (
          <div className="text-center py-12 text-zinc-500 text-sm">
            Aucune dépense pour {MONTHS_FR[month]}.<br />
            Appuie sur « Ajouter une dépense » pour commencer.
          </div>
        )}

        {sortedCats.length === 0 && (
          <div className="text-center py-4">
            <p className="text-zinc-500 text-sm mb-3">Aucune catégorie.</p>
            <button
              onClick={() => setEditCat({ id: 'new', name: '', color: '#5E5CE6', order: 1 })}
              className="px-4 py-2 bg-emerald-400/15 text-emerald-400 rounded-full text-[13px] font-medium"
            >
              <Plus className="w-3.5 h-3.5 inline mr-1" />Créer ma première catégorie
            </button>
          </div>
        )}

        {/* Category management */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">Catégories</div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditCat({ id: 'new', name: '', color: '#5E5CE6', order: sortedCats.length + 1 })}
                className="flex items-center gap-1 text-[12px] text-emerald-400 font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Créer
              </button>
              <button
                onClick={() => setShowCatEditor(v => !v)}
                className="text-[12px] text-zinc-500 font-medium"
              >
                {showCatEditor ? 'Fermer' : 'Gérer'}
              </button>
            </div>
          </div>
          {showCatEditor && (
            <Card className="mb-5">
              {sortedCats.map((c, i) => (
                <div
                  key={c.id}
                  onClick={() => setEditCat(c)}
                  className={`flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer ${i < sortedCats.length - 1 ? 'border-b border-zinc-800/60' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                    <div className="text-[14px] font-medium text-white">{c.name}</div>
                  </div>
                  <Edit3 className="w-4 h-4 text-zinc-500" />
                </div>
              ))}
              <button
                onClick={() => setEditCat({ id: 'new', name: '', color: '#5E5CE6', order: sortedCats.length + 1 })}
                className="w-full p-4 flex items-center justify-center gap-2 border-t border-zinc-800/60 text-emerald-400 text-[14px] font-medium active:bg-[#252527]"
              >
                <Plus className="w-4 h-4" /> Nouvelle catégorie
              </button>
            </Card>
          )}
        </div>
      </div>

      <VarExpenseEditor
        expense={addOpen ? { id: 'new' } : editExpense}
        state={state}
        setState={setState}
        onClose={() => { setAddOpen(false); setEditExpense(null); }}
        defaultYear={year}
        defaultMonth={month}
      />
      <VarCategoryEditor
        category={editCat}
        state={state}
        setState={setState}
        onClose={() => setEditCat(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Control. — feature premium de projection de dépenses futures
// ---------------------------------------------------------------------------
//
// Un Control. est une projection : nom + date/heure + liste d'items (catégorie +
// montant). Tant qu'il n'est pas validé, il n'impacte PAS les vraies dépenses ni
// les statistiques. À la validation, ses items sont convertis en varExpenses
// avec la date du Control., ce qui les intègre automatiquement au mois en cours
// et à l'argent réel disponible.
//
// Statuts :
//   - pending    : créé, en attente
//   - validated  : transformé en vraies dépenses
//   - cancelled  : annulé sans création de dépense
// ---------------------------------------------------------------------------

const computeControlImpact = (state, control) => {
  // Total du Control. = somme des items
  const items = control.items || [];
  const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);

  // Argent disponible AVANT ce Control., sur le mois de sa date
  const d = control.date ? new Date(control.date) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const monthData = computeMonth(state, y, m);
  const varMonth = computeVarMonth(state, y, m);
  const benefice = monthData.brut - monthData.ursaff;
  const available = benefice - monthData.chargesPaid - varMonth.total;
  // Les autres Control. de DÉPENSE en attente du même mois sont aussi pris en
  // compte (les Control. revenus ne consomment pas l'argent disponible).
  const otherControlsTotal = (state.controls || [])
    .filter(c => c.id !== control.id && c.status !== 'validated' && c.status !== 'cancelled')
    .filter(c => (c.kind || 'expense') === 'expense')
    .filter(c => {
      const cd = new Date(c.date);
      return cd.getFullYear() === y && cd.getMonth() === m;
    })
    .reduce((s, c) => s + (c.items || []).reduce((ss, it) => ss + Number(it.amount || 0), 0), 0);

  const availableAfterOthers = available - otherControlsTotal;
  const remainingAfter = availableAfterOthers - total;

  return { total, available: availableAfterOthers, remainingAfter };
};

const ControlEditor = ({ control, state, setState, onClose }) => {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (control) {
      if (control.id === 'new') {
        const t = new Date();
        const dateStr = t.toISOString().slice(0, 10);
        setForm({
          id: 'new',
          kind: control.kind || 'expense', // 'expense' | 'income'
          name: '',
          date: dateStr,
          time: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
          note: '',
          items: [],
          status: 'pending',
        });
      } else {
        setForm({ ...control, kind: control.kind || 'expense', items: [...(control.items || [])] });
      }
    }
  }, [control]);

  // Impact en temps réel — calculé même avant que form soit prêt, pour respecter
  // les règles des Hooks (ne JAMAIS conditionner un Hook par un return early).
  const impact = useMemo(() => {
    if (!form) return { total: 0, available: 0, remainingAfter: 0 };
    return computeControlImpact(state, form);
  }, [state, form]);

  if (!control || !form) return null;
  const isNew = control.id === 'new';
  const isIncome = form.kind === 'income';

  const sortedCats = [...(state.varCategories || [])].sort((a, b) => a.order - b.order);
  const activeActivities = state.activities.filter(a => a.active !== false);
  const overBudget = impact.remainingAfter < 0;

  // Item par défaut : différent selon le type
  const buildEmptyItem = (kind) => kind === 'income'
    ? { id: newId(), name: '', amount: '', activityId: activeActivities[0]?.id || '', clientId: '' }
    : { id: newId(), name: '', amount: '', categoryId: sortedCats[0]?.id || '' };

  const addItem = () => {
    setForm({ ...form, items: [...form.items, buildEmptyItem(form.kind)] });
  };
  const updateItem = (id, patch) => {
    setForm({ ...form, items: form.items.map(it => it.id === id ? { ...it, ...patch } : it) });
  };
  const removeItem = (id) => {
    setForm({ ...form, items: form.items.filter(it => it.id !== id) });
  };

  // Quand on bascule entre dépense et revenu, on remet les items à zéro
  // car la structure de l'item change (categoryId vs activityId/clientId).
  const switchKind = (kind) => {
    if (kind === form.kind) return;
    setForm({ ...form, kind, items: [] });
  };

  const save = () => {
    if (!form.name.trim()) return;
    const cleanItems = form.items
      .map(it => ({ ...it, amount: parseFloat(String(it.amount).replace(',', '.')) || 0 }))
      .filter(it => it.amount > 0);
    const payload = { ...form, items: cleanItems, id: isNew ? newId() : form.id };
    setState(s => ({
      ...s,
      controls: isNew
        ? [...(s.controls || []), payload]
        : (s.controls || []).map(c => c.id === payload.id ? payload : c),
    }));
    onClose();
  };

  const remove = () => {
    setState(s => ({ ...s, controls: (s.controls || []).filter(c => c.id !== form.id) }));
    onClose();
  };

  // Palette dynamique selon le type
  const accent = isIncome
    ? { color: '#30D158', bg: 'rgba(48,209,88,0.10)', bg2: 'rgba(48,209,88,0.04)', border: 'rgba(48,209,88,0.20)', soft: 'rgba(48,209,88,0.7)' }
    : { color: '#5E5CE6', bg: 'rgba(94,92,230,0.10)', bg2: 'rgba(94,92,230,0.04)', border: 'rgba(94,92,230,0.20)', soft: 'rgba(94,92,230,0.7)' };

  return (
    <Sheet open={!!control} onClose={onClose} title={isNew ? 'Nouveau Control.' : 'Modifier'}>
      <div className="space-y-4">
        {/* Toggle Dépense / Revenu — visible seulement à la création */}
        {isNew && (
          <div className="grid grid-cols-2 gap-2 p-1 bg-[#1C1C1E] rounded-2xl border border-zinc-800/60">
            <button
              onClick={() => switchKind('expense')}
              className={`py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
                !isIncome ? 'bg-[#2C2C2E] text-white shadow-sm' : 'text-zinc-500'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" /> Dépense
            </button>
            <button
              onClick={() => switchKind('income')}
              className={`py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
                isIncome ? 'bg-[#2C2C2E] text-emerald-400 shadow-sm' : 'text-zinc-500'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" /> Revenu
            </button>
          </div>
        )}

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Nom</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={isIncome ? 'Ex. Mariage 12 juillet' : 'Ex. Soirée cinéma'}
            autoFocus={isNew}
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Heure</label>
            <input
              type="time"
              value={form.time || ''}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
              className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Note (optionnelle)</label>
          <input
            type="text"
            value={form.note || ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Une précision…"
            className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none"
          />
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
              {isIncome ? 'Revenus prévus' : 'Dépenses prévues'}
            </label>
            <button onClick={addItem} className={`flex items-center gap-1 text-[12px] font-medium ${isIncome ? 'text-emerald-400' : 'text-emerald-400'}`}>
              <Plus className="w-3.5 h-3.5" /> Ajouter
            </button>
          </div>
          {form.items.length === 0 ? (
            <button
              onClick={addItem}
              className="w-full p-4 rounded-xl border border-dashed border-zinc-800 text-[13px] text-zinc-500 active:bg-white/5"
            >
              + Ajouter {isIncome ? 'un revenu prévu' : 'une dépense prévue'}
            </button>
          ) : (
            <div className="space-y-2">
              {form.items.map((it) => (
                <div key={it.id} className="bg-[#1C1C1E] border border-zinc-800/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={it.name}
                      onChange={(e) => updateItem(it.id, { name: e.target.value })}
                      placeholder={isIncome ? 'Ex. Prestation DJ' : 'Ex. Cinéma'}
                      className="flex-1 bg-[#2C2C2E] rounded-lg px-3 py-2 text-white text-[13.5px] outline-none"
                    />
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={it.amount}
                        onChange={(e) => updateItem(it.id, { amount: e.target.value })}
                        placeholder="0"
                        className="w-20 bg-[#2C2C2E] rounded-lg px-2 py-2 text-white text-[13.5px] outline-none text-right pr-5"
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 text-[11px]">€</span>
                    </div>
                    <button onClick={() => removeItem(it.id)} className="text-zinc-600 active:text-rose-400 p-1">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Sélecteur de catégorie/activité selon le type */}
                  {isIncome ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {activeActivities.map(a => (
                          <button
                            key={a.id}
                            onClick={() => updateItem(it.id, { activityId: a.id })}
                            className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium flex items-center gap-1 ${
                              it.activityId === a.id ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'
                            }`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.color }} />
                            {a.name}
                          </button>
                        ))}
                      </div>
                      {/* Client (optionnel) */}
                      {(state.clients || []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold px-1">Client</span>
                          <button
                            onClick={() => updateItem(it.id, { clientId: '' })}
                            className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium ${
                              !it.clientId ? 'bg-zinc-700 text-white' : 'bg-[#2C2C2E] text-zinc-500'
                            }`}
                          >
                            Aucun
                          </button>
                          {state.clients.map(c => (
                            <button
                              key={c.id}
                              onClick={() => updateItem(it.id, { clientId: c.id })}
                              className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium ${
                                it.clientId === c.id ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'
                              }`}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {sortedCats.map(c => (
                        <button
                          key={c.id}
                          onClick={() => updateItem(it.id, { categoryId: c.id })}
                          className={`px-2 py-0.5 rounded-full text-[10.5px] font-medium flex items-center gap-1 ${
                            it.categoryId === c.id ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Analyse en temps réel */}
        {impact.total > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{
              background: isIncome
                ? `linear-gradient(135deg, ${accent.bg} 0%, ${accent.bg2} 100%)`
                : (overBudget
                  ? 'linear-gradient(135deg, rgba(255,69,58,0.10) 0%, rgba(255,69,58,0.04) 100%)'
                  : 'linear-gradient(135deg, rgba(48,209,88,0.10) 0%, rgba(48,209,88,0.04) 100%)'),
              border: isIncome
                ? `1px solid ${accent.border}`
                : (overBudget ? '1px solid rgba(255,69,58,0.20)' : '1px solid rgba(48,209,88,0.20)'),
            }}
          >
            {isIncome ? (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: accent.soft }}>
                    Revenus estimés
                  </div>
                  <div className="text-[13px] font-bold text-white">+{fmt(impact.total, { decimals: 2 })} €</div>
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-emerald-300">
                    CA estimé après ce Control. : {fmt((computeMonth(state, new Date(form.date).getFullYear(), new Date(form.date).getMonth()).brut) + impact.total, { decimals: 2 })} €
                  </div>
                  <div className="text-[11px] text-emerald-400/60 mt-0.5">
                    sur {MONTHS_FR[new Date(form.date).getMonth()]} {new Date(form.date).getFullYear()}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wider font-semibold"
                    style={{ color: overBudget ? 'rgba(255,69,58,0.7)' : 'rgba(48,209,88,0.7)' }}>
                    Impact estimé
                  </div>
                  <div className="text-[13px] font-bold text-white">{fmt(impact.total, { decimals: 2 })} €</div>
                </div>
                {overBudget ? (
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[13px] font-semibold text-rose-300">Dépasse votre disponible</div>
                      <div className="text-[11.5px] text-rose-400/70 mt-0.5">
                        de {fmt(Math.abs(impact.remainingAfter), { decimals: 2 })} €
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-[13px] font-semibold text-emerald-300">
                      Après ce Control. : {fmt(impact.remainingAfter, { decimals: 2 })} €
                    </div>
                    <div className="text-[11px] text-emerald-400/60 mt-0.5">restant ce mois-ci</div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button
          onClick={save}
          disabled={!form.name.trim()}
          className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform disabled:opacity-40 disabled:bg-zinc-700 disabled:text-zinc-500"
        >
          {isNew ? `Créer le Control.` : 'Enregistrer'}
        </button>

        {!isNew && (
          <button onClick={remove} className="w-full text-rose-400 text-[14px] font-medium py-2">
            Supprimer ce Control.
          </button>
        )}
      </div>
    </Sheet>
  );
};

// Sheet de validation post-événement
const ControlValidationSheet = ({ control, state, setState, onClose, onEdit }) => {
  if (!control) return null;

  const isIncome = (control.kind || 'expense') === 'income';
  const total = (control.items || []).reduce((s, it) => s + Number(it.amount || 0), 0);

  // Valider :
  //  - kind 'expense' : convertit les items en varExpenses à la date du Control.
  //  - kind 'income'  : convertit les items en transactions (vraies ventes) à la date du Control.
  const validate = () => {
    if (isIncome) {
      const newTransactions = (control.items || [])
        .filter(it => Number(it.amount || 0) > 0 && it.activityId)
        .map(it => ({
          id: newId(),
          amount: Number(it.amount),
          activityId: it.activityId,
          clientId: it.clientId || null,
          description: it.name ? `${control.name} · ${it.name}` : control.name,
          date: control.date,
        }));
      setState(s => ({
        ...s,
        transactions: [...s.transactions, ...newTransactions],
        controls: (s.controls || []).map(c => c.id === control.id ? { ...c, status: 'validated' } : c),
      }));
    } else {
      const newVarExpenses = (control.items || [])
        .filter(it => Number(it.amount || 0) > 0)
        .map(it => ({
          id: newId(),
          amount: Number(it.amount),
          categoryId: it.categoryId,
          description: it.name ? `${control.name} · ${it.name}` : control.name,
          date: control.date,
        }));
      setState(s => ({
        ...s,
        varExpenses: [...(s.varExpenses || []), ...newVarExpenses],
        controls: (s.controls || []).map(c => c.id === control.id ? { ...c, status: 'validated' } : c),
      }));
    }
    onClose();
  };

  const cancel = () => {
    setState(s => ({
      ...s,
      controls: (s.controls || []).map(c => c.id === control.id ? { ...c, status: 'cancelled' } : c),
    }));
    onClose();
  };

  const isValidated = control.status === 'validated';
  const isCancelled = control.status === 'cancelled';

  return (
    <Sheet open={!!control} onClose={onClose} title={control.name || 'Control.'}>
      <div className="space-y-4">
        {/* Header summary */}
        <div className="rounded-2xl p-4" style={{
          background: 'linear-gradient(135deg, #1C1C1E 0%, #252527 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span className="text-[11px] text-zinc-500">
              {new Date(control.date).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
              {control.time ? ` · ${control.time}` : ''}
            </span>
            {isValidated && (
              <span className="ml-auto px-1.5 py-px rounded-md bg-emerald-500/15 text-emerald-400 text-[9px] uppercase tracking-wider font-semibold">Validé</span>
            )}
            {isCancelled && (
              <span className="ml-auto px-1.5 py-px rounded-md bg-zinc-800 text-zinc-500 text-[9px] uppercase tracking-wider font-semibold">Annulé</span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-[32px] font-bold leading-none tracking-tight ${isIncome ? 'text-emerald-300' : 'text-white'}`}>
              {isIncome ? '+' : ''}{fmt(total, { decimals: 2 })}
            </span>
            <span className="text-[16px] text-zinc-500 font-medium">€ {isIncome ? 'attendus' : 'prévus'}</span>
          </div>
          {control.note && (
            <div className="text-[12px] text-zinc-500 mt-2">{control.note}</div>
          )}
        </div>

        {/* Items list */}
        {(control.items || []).length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">
              {isIncome ? 'Revenus prévus' : 'Dépenses prévues'}
            </div>
            <Card>
              {control.items.map((it, i) => {
                // Selon le type, on récupère soit l'activité, soit la catégorie
                const meta = isIncome
                  ? state.activities.find(a => a.id === it.activityId)
                  : (state.varCategories || []).find(c => c.id === it.categoryId);
                const client = isIncome && it.clientId ? (state.clients || []).find(c => c.id === it.clientId) : null;
                return (
                  <div key={it.id} className={`flex items-center justify-between p-3.5 ${i < control.items.length - 1 ? 'border-b border-zinc-800/60' : ''}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      {meta && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />}
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium text-white truncate">{it.name || meta?.name || 'Sans nom'}</div>
                        {meta && (
                          <div className="text-[10.5px] text-zinc-500 mt-0.5 truncate">
                            {meta.name}{client ? ` · ${client.name}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`text-[13.5px] font-semibold flex-shrink-0 ${isIncome ? 'text-emerald-400' : 'text-white'}`}>
                      {isIncome ? '+' : ''}{fmt(it.amount, { decimals: 2 })} €
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        {/* Actions — uniquement si en attente */}
        {!isValidated && !isCancelled && (
          <>
            <div className="text-[13px] text-zinc-400 text-center py-2">
              {isIncome ? 'Confirmer ces revenus reçus ?' : 'Avez-vous respecté ce Control. ?'}
            </div>
            <button
              onClick={validate}
              className="w-full bg-emerald-400 text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" strokeWidth={3} /> Valider — créer {isIncome ? 'les revenus' : 'les dépenses'}
            </button>
            <button
              onClick={() => { onClose(); onEdit && onEdit(control); }}
              className="w-full bg-[#2C2C2E] text-white font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <Edit3 className="w-4 h-4" /> Modifier
            </button>
            <button
              onClick={cancel}
              className="w-full text-rose-400 text-[14px] font-medium py-2"
            >
              Annuler ce Control.
            </button>
          </>
        )}

        {(isValidated || isCancelled) && (
          <button
            onClick={() => {
              setState(s => ({ ...s, controls: (s.controls || []).filter(c => c.id !== control.id) }));
              onClose();
            }}
            className="w-full text-zinc-500 text-[13px] font-medium py-2"
          >
            Supprimer de l'historique
          </button>
        )}
      </div>
    </Sheet>
  );
};

const ControlsPage = ({ state, setState }) => {
  const [editControl, setEditControl] = useState(null);
  const [viewControl, setViewControl] = useState(null);

  const controls = state.controls || [];

  // Groupes : à venir / passés non validés / historique
  const now = new Date();
  const groups = useMemo(() => {
    const upcoming = [];
    const pastPending = [];
    const archive = [];
    controls.forEach(c => {
      const d = new Date(c.date);
      if (c.status === 'validated' || c.status === 'cancelled') {
        archive.push(c);
      } else if (d >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        upcoming.push(c);
      } else {
        pastPending.push(c);
      }
    });
    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
    pastPending.sort((a, b) => new Date(b.date) - new Date(a.date));
    archive.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { upcoming, pastPending, archive };
  }, [controls]);

  const ControlRow = ({ c }) => {
    const total = (c.items || []).reduce((s, it) => s + Number(it.amount || 0), 0);
    const d = new Date(c.date);
    const isIncome = (c.kind || 'expense') === 'income';
    // Couleur d'accent : emerald pour revenus, indigo pour dépenses
    const accentBg = isIncome ? 'bg-emerald-500/15' : 'bg-indigo-500/15';
    const accentText = isIncome ? 'text-emerald-400' : 'text-indigo-400';
    return (
      <button
        onClick={() => setViewControl(c)}
        className="w-full flex items-center justify-between p-4 active:bg-[#252527] text-left"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            c.status === 'validated' ? 'bg-emerald-500/15' :
            c.status === 'cancelled' ? 'bg-zinc-800' :
            accentBg
          }`}>
            {c.status === 'validated' ? <Check className="w-4 h-4 text-emerald-400" strokeWidth={3} /> :
             c.status === 'cancelled' ? <X className="w-4 h-4 text-zinc-500" /> :
             (isIncome ? <TrendingUp className={`w-4 h-4 ${accentText}`} /> : <Target className={`w-4 h-4 ${accentText}`} />)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="text-[14px] font-semibold text-white truncate">{c.name || 'Sans nom'}</div>
              {isIncome && c.status !== 'validated' && c.status !== 'cancelled' && (
                <span className="px-1.5 py-px rounded-md bg-emerald-500/15 text-emerald-400 text-[9px] uppercase tracking-wider font-semibold flex-shrink-0">Revenu</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              {d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
              {c.time ? ` · ${c.time}` : ''}
              {(c.items || []).length > 0 && ` · ${c.items.length} item${c.items.length > 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-[14px] font-bold ${
            c.status === 'cancelled' ? 'text-zinc-500 line-through' :
            isIncome ? 'text-emerald-400' : 'text-white'
          }`}>
            {isIncome ? '+' : ''}{fmt(total, { decimals: 0 })} €
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="pb-32">
      <TopBar subtitle="Projections" title="Control." />

      <div className="px-5">
        <button
          onClick={() => setEditControl({ id: 'new' })}
          className="w-full mb-5 bg-white text-black font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" /> Créer un Control.
        </button>

        {controls.length === 0 && (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
              <Target className="w-6 h-6 text-indigo-400" />
            </div>
            <div className="text-[15px] font-semibold text-white mb-1.5">Anticipe tes flux financiers</div>
            <div className="text-[12.5px] text-zinc-500 leading-relaxed px-4">
              Crée un Control. pour prévoir une dépense ou un revenu à venir.<br />
              Visualise leur impact avant qu'ils arrivent.
            </div>
          </div>
        )}

        {groups.upcoming.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">
              À venir <span className="text-zinc-600">· {groups.upcoming.length}</span>
            </div>
            <Card>
              {groups.upcoming.map((c, i) => (
                <div key={c.id} className={i < groups.upcoming.length - 1 ? 'border-b border-zinc-800/60' : ''}>
                  <ControlRow c={c} />
                </div>
              ))}
            </Card>
          </div>
        )}

        {groups.pastPending.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-orange-400/80 mb-2 px-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> À valider <span className="text-zinc-600 normal-case">· passés</span>
            </div>
            <Card>
              {groups.pastPending.map((c, i) => (
                <div key={c.id} className={i < groups.pastPending.length - 1 ? 'border-b border-zinc-800/60' : ''}>
                  <ControlRow c={c} />
                </div>
              ))}
            </Card>
          </div>
        )}

        {groups.archive.length > 0 && (
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">
              Historique
            </div>
            <Card>
              {groups.archive.slice(0, 20).map((c, i) => (
                <div key={c.id} className={i < Math.min(groups.archive.length, 20) - 1 ? 'border-b border-zinc-800/60' : ''}>
                  <ControlRow c={c} />
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>

      <ControlEditor control={editControl} state={state} setState={setState} onClose={() => setEditControl(null)} />
      <ControlValidationSheet
        control={viewControl}
        state={state}
        setState={setState}
        onClose={() => setViewControl(null)}
        onEdit={(c) => setEditControl(c)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Export — fonctionnalité d'export CSV des données financières
// ---------------------------------------------------------------------------

const downloadFile = (filename, content, type = 'text/csv;charset=utf-8;') => {
  const blob = new Blob(['\uFEFF' + content], { type }); // BOM UTF-8 pour Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
};

const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};
const toCSV = (rows) => rows.map(r => r.map(csvEscape).join(';')).join('\n');

// ── PDF mensuel premium (clair, sans dépendance, via window.print) ──────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const generateMonthlyPDF = (state, year, month) => {
  const eur = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const pct = (n, t) => t > 0 ? `${(n / t * 100).toFixed(1).replace('.', ',')} %` : '—';
  const d = computeMonth(state, year, month);
  const v = computeVarMonth(state, year, month);
  const ursaffActive = state.settings.ursaffEnabled !== false;
  const benefice = d.brut - d.ursaff;
  const dispo = benefice - d.chargesPaid - v.total;

  const actMap = {}; state.activities.forEach(a => { actMap[a.id] = a; });
  const cliMap = {}; (state.clients || []).forEach(c => { cliMap[c.id] = c; });
  const catMap = {}; (state.varCategories || []).forEach(c => { catMap[c.id] = c; });

  // Répartitions du mois
  const txs = state.transactions.filter(t => { const x = new Date(t.date); return x.getFullYear() === year && x.getMonth() === month; });
  const byAct = {}, byCli = {};
  txs.forEach(t => {
    byAct[t.activityId] = (byAct[t.activityId] || 0) + Number(t.amount || 0);
    if (t.clientId) byCli[t.clientId] = (byCli[t.clientId] || 0) + Number(t.amount || 0);
  });
  const actRows = Object.entries(byAct).sort((a, b) => b[1] - a[1])
    .map(([id, tot]) => `<tr><td><span class="dot" style="background:${actMap[id]?.color || '#999'}"></span>${esc(actMap[id]?.name || 'Inconnu')}</td><td class="r">${eur(tot)}</td><td class="r muted">${pct(tot, d.brut)}</td></tr>`).join('');
  const cliRows = Object.entries(byCli).sort((a, b) => b[1] - a[1])
    .map(([id, tot]) => `<tr><td>${esc(cliMap[id]?.name || 'Inconnu')}</td><td class="r">${eur(tot)}</td><td class="r muted">${pct(tot, d.brut)}</td></tr>`).join('');
  const catRows = Object.entries(v.byCategory).sort((a, b) => b[1] - a[1])
    .map(([id, tot]) => `<tr><td><span class="dot" style="background:${catMap[id]?.color || '#999'}"></span>${esc(catMap[id]?.name || 'Autre')}</td><td class="r">${eur(tot)}</td><td class="r muted">${pct(tot, v.total)}</td></tr>`).join('');

  const userName = state.profile?.displayName || state.profile?.username || '';
  const genDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const summaryCards = [
    { label: "Chiffre d'affaires", value: eur(d.brut), accent: '#0A0A0A' },
    ...(ursaffActive ? [{ label: 'URSSAF à reverser', value: eur(d.ursaff), accent: '#C2410C' }] : []),
    { label: 'Charges fixes', value: eur(d.charges), accent: '#0A0A0A' },
    { label: 'Dépenses variables', value: eur(v.total), accent: '#0A0A0A' },
    { label: 'Bénéfice net', value: eur(benefice), accent: '#047857' },
  ].map(c => `<div class="card"><div class="card-l">${c.label}</div><div class="card-v" style="color:${c.accent}">${c.value}</div></div>`).join('');

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Control. — ${esc(MONTHS_FR[month])} ${year}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",system-ui,sans-serif;color:#0A0A0A;background:#fff;padding:48px 44px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0A0A0A;padding-bottom:18px;margin-bottom:28px}
.brand{font-size:26px;font-weight:800;letter-spacing:-1px}
.brand span{color:#999}
.period{font-size:13px;color:#666;text-align:right;line-height:1.5}
.period b{display:block;font-size:18px;color:#0A0A0A;font-weight:700;letter-spacing:-.3px}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:30px}
.card{border:1px solid #E5E5E5;border-radius:12px;padding:14px 16px}
.card-l{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#888;font-weight:600;margin-bottom:5px}
.card-v{font-size:20px;font-weight:700;letter-spacing:-.4px}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#888;font-weight:700;margin:26px 0 10px}
table{width:100%;border-collapse:collapse}
td{padding:9px 4px;font-size:13px;border-bottom:1px solid #F0F0F0}
td.r{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
td.muted{color:#999;font-weight:500;width:64px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle}
.empty{font-size:12px;color:#aaa;padding:10px 4px}
.foot{margin-top:40px;padding-top:16px;border-top:1px solid #E5E5E5;font-size:10.5px;color:#999;line-height:1.6}
@media print{body{padding:24px}@page{margin:14mm}}
</style></head><body>
<div class="head">
  <div class="brand">Control<span>.</span></div>
  <div class="period"><b>${esc(MONTHS_FR[month])} ${year}</b>${userName ? esc(userName) : 'Rapport mensuel'}</div>
</div>
<div class="cards">${summaryCards}</div>
${actRows ? `<h2>Revenus par activité</h2><table>${actRows}</table>` : ''}
${cliRows ? `<h2>Revenus par client</h2><table>${cliRows}</table>` : ''}
${catRows ? `<h2>Dépenses par catégorie</h2><table>${catRows}</table>` : '<h2>Dépenses par catégorie</h2><div class="empty">Aucune dépense ce mois-ci.</div>'}
<div class="foot">
  Document généré le ${genDate} via Control.${userName ? ` pour ${esc(userName)}` : ''}.<br>
  Control. est un outil de suivi personnel à titre indicatif. Ce document ne constitue ni un document comptable officiel ni un conseil fiscal. Les montants reflètent uniquement les données saisies par l'utilisateur.
</div>
</body></html>`;

  // Impression via iframe caché — évite le blocage des pop-ups (Safari/iOS)
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();

  const cleanup = () => { setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 1000); };
  iframe.contentWindow.onafterprint = cleanup;
  setTimeout(() => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); }
    catch { cleanup(); return; }
  }, 450);
  return true;
};

const ExportSheet = ({ open, onClose, state }) => {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [pdfMonth, setPdfMonth] = useState(now.getMonth());
  const [msg, setMsg] = useState(null);

  const activityMap = useMemo(() => {
    const m = {};
    state.activities.forEach(a => { m[a.id] = a; });
    return m;
  }, [state.activities]);
  const clientMap = useMemo(() => {
    const m = {};
    (state.clients || []).forEach(c => { m[c.id] = c; });
    return m;
  }, [state.clients]);
  const varCatMap = useMemo(() => {
    const m = {};
    (state.varCategories || []).forEach(c => { m[c.id] = c; });
    return m;
  }, [state.varCategories]);
  const catMap = useMemo(() => {
    const m = {};
    state.categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [state.categories]);

  const exportRevenues = () => {
    const rows = [['Date', 'Activité', 'Client', 'Montant (€)', 'Description', 'Soumis URSSAF']];
    state.transactions
      .filter(t => new Date(t.date).getFullYear() === year)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach(t => {
        const a = activityMap[t.activityId];
        const c = t.clientId ? clientMap[t.clientId] : null;
        rows.push([
          t.date,
          a?.name || '',
          c?.name || '',
          Number(t.amount || 0).toFixed(2).replace('.', ','),
          t.description || '',
          a?.taxable ? 'Oui' : 'Non',
        ]);
      });
    downloadFile(`control-revenus-${year}.csv`, toCSV(rows));
    setMsg({ type: 'ok', text: `Revenus ${year} exportés.` });
    setTimeout(() => setMsg(null), 2500);
  };

  const exportExpenses = () => {
    const rows = [['Date', 'Catégorie', 'Description', 'Montant (€)']];
    (state.varExpenses || [])
      .filter(e => new Date(e.date).getFullYear() === year)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach(e => {
        const c = varCatMap[e.categoryId];
        rows.push([
          e.date,
          c?.name || 'Autre',
          e.description || '',
          Number(e.amount || 0).toFixed(2).replace('.', ','),
        ]);
      });
    downloadFile(`control-depenses-${year}.csv`, toCSV(rows));
    setMsg({ type: 'ok', text: `Dépenses ${year} exportées.` });
    setTimeout(() => setMsg(null), 2500);
  };

  const exportMonthly = () => {
    const ursaffActive = state.settings.ursaffEnabled !== false;
    const rows = [[
      'Mois', 'Chiffre d\'affaires', 'CA URSSAF', 'Hors URSSAF',
      ...(ursaffActive ? ['URSSAF dû'] : []),
      'Charges fixes', 'Charges payées', 'Dépenses variables', 'Bénéfice', 'Argent disponible',
    ]];
    for (let m = 0; m < 12; m++) {
      const d = computeMonth(state, year, m);
      const v = computeVarMonth(state, year, m);
      const benefice = d.brut - d.ursaff;
      const dispo = benefice - d.chargesPaid - v.total;
      const fmt2 = (n) => Number(n).toFixed(2).replace('.', ',');
      rows.push([
        MONTHS_FR[m],
        fmt2(d.brut),
        fmt2(d.brutTaxable),
        fmt2(d.brutNonTaxable),
        ...(ursaffActive ? [fmt2(d.ursaff)] : []),
        fmt2(d.charges),
        fmt2(d.chargesPaid),
        fmt2(v.total),
        fmt2(benefice),
        fmt2(dispo),
      ]);
    }
    downloadFile(`control-bilan-mensuel-${year}.csv`, toCSV(rows));
    setMsg({ type: 'ok', text: `Bilan ${year} exporté.` });
    setTimeout(() => setMsg(null), 2500);
  };

  const exportStats = () => {
    const ursaffActive = state.settings.ursaffEnabled !== false;
    // Synthèse globale + répartitions
    const rows = [];
    let totalBrut = 0, totalUrsaff = 0, totalCharges = 0, totalVar = 0;
    for (let m = 0; m < 12; m++) {
      const d = computeMonth(state, year, m);
      const v = computeVarMonth(state, year, m);
      totalBrut += d.brut; totalUrsaff += d.ursaff; totalCharges += d.charges; totalVar += v.total;
    }
    rows.push(['Bilan annuel', year]);
    rows.push([]);
    rows.push(['Indicateur', 'Valeur (€)']);
    rows.push(['Chiffre d\'affaires', totalBrut.toFixed(2).replace('.', ',')]);
    if (ursaffActive) rows.push(['URSSAF dû', totalUrsaff.toFixed(2).replace('.', ',')]);
    rows.push(['Charges fixes (total)', totalCharges.toFixed(2).replace('.', ',')]);
    rows.push(['Dépenses variables', totalVar.toFixed(2).replace('.', ',')]);
    rows.push(['Bénéfice net', (totalBrut - totalUrsaff - totalCharges - totalVar).toFixed(2).replace('.', ',')]);
    rows.push([]);
    rows.push(['Par activité', '', '']);
    rows.push(['Activité', 'CA (€)', '% du CA total']);
    const byActivity = {};
    state.transactions.forEach(t => {
      if (new Date(t.date).getFullYear() === year) {
        byActivity[t.activityId] = (byActivity[t.activityId] || 0) + Number(t.amount || 0);
      }
    });
    Object.entries(byActivity).sort((a, b) => b[1] - a[1]).forEach(([aid, total]) => {
      const a = activityMap[aid];
      const pct = totalBrut > 0 ? (total / totalBrut * 100) : 0;
      rows.push([a?.name || 'Inconnu', total.toFixed(2).replace('.', ','), pct.toFixed(1).replace('.', ',') + '%']);
    });
    rows.push([]);
    rows.push(['Par client', '', '']);
    rows.push(['Client', 'CA (€)', '% du CA total']);
    const byClient = {};
    state.transactions.forEach(t => {
      if (new Date(t.date).getFullYear() === year && t.clientId) {
        byClient[t.clientId] = (byClient[t.clientId] || 0) + Number(t.amount || 0);
      }
    });
    Object.entries(byClient).sort((a, b) => b[1] - a[1]).forEach(([cid, total]) => {
      const c = clientMap[cid];
      const pct = totalBrut > 0 ? (total / totalBrut * 100) : 0;
      rows.push([c?.name || 'Inconnu', total.toFixed(2).replace('.', ','), pct.toFixed(1).replace('.', ',') + '%']);
    });
    downloadFile(`control-statistiques-${year}.csv`, toCSV(rows));
    setMsg({ type: 'ok', text: `Statistiques ${year} exportées.` });
    setTimeout(() => setMsg(null), 2500);
  };

  const exportAll = () => {
    exportRevenues();
    setTimeout(() => exportExpenses(), 250);
    setTimeout(() => exportMonthly(), 500);
    setTimeout(() => exportStats(), 750);
  };

  const exportPDF = () => {
    generateMonthlyPDF(state, year, pdfMonth);
    setMsg({ type: 'ok', text: `Rapport ${MONTHS_FR[pdfMonth]} ${year} prêt.` });
    setTimeout(() => setMsg(null), 3500);
  };

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear()]);
    state.transactions.forEach(t => set.add(new Date(t.date).getFullYear()));
    (state.varExpenses || []).forEach(e => set.add(new Date(e.date).getFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [state.transactions, state.varExpenses]);

  return (
    <Sheet open={open} onClose={onClose} title="Exporter mes données">
      <div className="space-y-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Année</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {years.map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors ${year === y ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* ── RAPPORT PDF MENSUEL ──────────────────────────────────────── */}
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, #1C1C1E 0%, #252527 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-2xl bg-white/10 flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-white">Rapport mensuel PDF</div>
              <div className="text-[11px] text-zinc-500">Document clair, prêt à imprimer ou partager</div>
            </div>
          </div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Mois</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5 mb-3">
            {MONTHS_SHORT.map((m, i) => (
              <button
                key={i}
                onClick={() => setPdfMonth(i)}
                className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition-colors ${pdfMonth === i ? 'bg-white text-black' : 'bg-[#2C2C2E] text-zinc-400'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={exportPDF}
            className="w-full bg-white text-black font-semibold py-3 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Générer le PDF · {MONTHS_FR[pdfMonth]} {year}
          </button>
        </div>

        <div className="text-[11px] text-zinc-500 leading-relaxed px-1">
          Ou exporte en CSV (Excel, Numbers, Google Sheets).
        </div>

        <div className="space-y-2">
          <button onClick={exportRevenues} className="w-full flex items-center justify-between p-4 bg-[#1C1C1E] border border-zinc-800/60 rounded-2xl active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-left">
                <div className="text-[14px] font-semibold text-white">Revenus</div>
                <div className="text-[11px] text-zinc-500">Toutes les ventes de {year}</div>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500" />
          </button>

          <button onClick={exportExpenses} className="w-full flex items-center justify-between p-4 bg-[#1C1C1E] border border-zinc-800/60 rounded-2xl active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-left">
                <div className="text-[14px] font-semibold text-white">Dépenses</div>
                <div className="text-[11px] text-zinc-500">Toutes les dépenses variables de {year}</div>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500" />
          </button>

          <button onClick={exportMonthly} className="w-full flex items-center justify-between p-4 bg-[#1C1C1E] border border-zinc-800/60 rounded-2xl active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-left">
                <div className="text-[14px] font-semibold text-white">Bilan mensuel</div>
                <div className="text-[11px] text-zinc-500">12 mois · CA, charges, bénéfices</div>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500" />
          </button>

          <button onClick={exportStats} className="w-full flex items-center justify-between p-4 bg-[#1C1C1E] border border-zinc-800/60 rounded-2xl active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/15 flex items-center justify-center">
                <Target className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="text-left">
                <div className="text-[14px] font-semibold text-white">Statistiques</div>
                <div className="text-[11px] text-zinc-500">Synthèse + répartitions par activité et client</div>
              </div>
            </div>
            <Download className="w-4 h-4 text-zinc-500" />
          </button>
        </div>

        <button
          onClick={exportAll}
          className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" /> Tout exporter
        </button>

        {msg && (
          <div className={`px-4 py-3 rounded-xl text-[13px] font-medium ${msg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
            {msg.text}
          </div>
        )}
      </div>
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Profile page
// ---------------------------------------------------------------------------

const ProfilePage = ({ user, state, setState, onSignOut, onExport }) => {
  const [editField, setEditField] = useState(null); // 'username'|'email'|'password'
  const [fieldValue, setFieldValue] = useState('');
  const [fieldValue2, setFieldValue2] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);       // 'cgu' | 'privacy' | null
  const [deleteSheet, setDeleteSheet] = useState(false); // confirmation suppression compte
  const [deleting, setDeleting] = useState(false);

  const firstName = user?.user_metadata?.first_name || '';
  const username = user?.user_metadata?.username || '';
  const email = user?.email || '';
  const initial = (firstName || email || '?')[0].toUpperCase();
  const avatar = state.profile?.avatar || null;
  const fileInputRef = useRef(null);
  const [avatarMsg, setAvatarMsg] = useState(null);

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset pour permettre re-sélection du même fichier
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setAvatarMsg({ type: 'err', text: 'Image trop lourde (max 5 Mo).' }); return; }
    try {
      const dataUrl = await readAvatarFile(file);
      setState(s => ({ ...s, profile: { ...(s.profile || {}), avatar: dataUrl } }));
      setAvatarMsg({ type: 'ok', text: 'Photo mise à jour.' });
      setTimeout(() => setAvatarMsg(null), 2000);
    } catch (err) {
      setAvatarMsg({ type: 'err', text: err.message || 'Erreur lors du chargement.' });
    }
  };

  const removeAvatar = () => {
    setState(s => ({ ...s, profile: { ...(s.profile || {}), avatar: null } }));
    setAvatarMsg({ type: 'ok', text: 'Photo retirée.' });
    setTimeout(() => setAvatarMsg(null), 2000);
  };

  // Suppression définitive du compte (droit à l'effacement RGPD) :
  // 1) efface les données distantes, 2) nettoie le local, 3) déconnecte.
  const handleDeleteAccount = async () => {
    setDeleting(true);
    const res = await deleteAccountData();
    setDeleting(false);
    if (!res.success) {
      setMsg({ type: 'err', text: res.error || 'Suppression impossible. Réessaie.' });
      return;
    }
    try { localStorage.clear(); } catch {}
    setDeleteSheet(false);
    onSignOut && onSignOut();
  };

  const openEdit = (field) => {
    setEditField(field);
    setFieldValue(field === 'email' ? email : field === 'username' ? username : '');
    setFieldValue2('');
    setMsg(null);
  };

  const saveField = async () => {
    setLoading(true);
    setMsg(null);
    try {
      if (editField === 'username') {
        const { error } = await supabase.auth.updateUser({ data: { username: fieldValue.trim() } });
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Pseudo mis à jour.' });
      } else if (editField === 'email') {
        const { error } = await supabase.auth.updateUser({ email: fieldValue.trim() });
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Email mis à jour. Vérifie ta boîte mail.' });
      } else if (editField === 'password') {
        if (fieldValue !== fieldValue2) { setMsg({ type: 'err', text: 'Les mots de passe ne correspondent pas.' }); setLoading(false); return; }
        if (fieldValue.length < 6) { setMsg({ type: 'err', text: 'Minimum 6 caractères.' }); setLoading(false); return; }
        const { error } = await supabase.auth.updateUser({ password: fieldValue });
        if (error) throw error;
        setMsg({ type: 'ok', text: 'Mot de passe mis à jour.' });
      }
      setEditField(null);
    } catch (e) {
      setMsg({ type: 'err', text: e.message || 'Erreur.' });
    }
    setLoading(false);
  };

  if (showSettings) {
    return <SettingsPage state={state} setState={setState} user={user} onSignOut={onSignOut} onBack={() => setShowSettings(false)} />;
  }

  return (
    <div className="pb-32">
      <TopBar subtitle="Mon espace" title="Profil" />

      <div className="px-5">
        {/* Avatar */}
        <div className="flex flex-col items-center py-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            style={{ display: 'none' }}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            className="relative active:scale-[0.97] transition-transform cursor-pointer"
            style={{
              width: 112,
              height: 112,
              borderRadius: '50%',
              padding: 3,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 100%)',
              marginBottom: 18,
              boxShadow: '0 16px 40px -10px rgba(0,0,0,0.7)',
            }}
          >
            <div style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              overflow: 'hidden',
              background: avatar ? 'transparent' : 'linear-gradient(135deg, #2a2a2c 0%, #18181a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}>
              {avatar
                ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ color: '#fff', fontSize: 44, fontWeight: 600, letterSpacing: '-1px' }}>{initial}</span>
              }
              {/* Badge appareil photo */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'linear-gradient(180deg, #FAFAFA 0%, #C7C7CC 100%)',
                border: '3px solid #000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}>
                <Camera className="w-3.5 h-3.5 text-black" strokeWidth={2.4} />
              </div>
            </div>
          </div>
          <div className="text-[20px] font-bold text-white" style={{ letterSpacing: '-0.4px' }}>{firstName || 'Mon compte'}</div>
          {username && <div className="text-[14px] text-zinc-500 mt-1">@{username}</div>}
          <div className="text-[13px] text-zinc-600 mt-0.5">{email}</div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 rounded-full text-[12.5px] font-semibold text-black active:scale-[0.97] transition-transform"
              style={{ background: 'linear-gradient(180deg, #FAFAFA 0%, #C7C7CC 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)' }}
            >
              {avatar ? 'Changer la photo' : 'Ajouter une photo'}
            </button>
            {avatar && (
              <button
                onClick={removeAvatar}
                className="px-4 py-2 rounded-full text-[12.5px] font-semibold text-white bg-white/5 border border-white/10 active:scale-[0.97] transition-transform"
              >
                Retirer
              </button>
            )}
          </div>
          {avatarMsg && (
            <div className={`mt-3 px-3 py-1.5 rounded-full text-[12px] font-medium ${avatarMsg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {avatarMsg.text}
            </div>
          )}
        </div>

        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-[13px] font-medium ${msg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
            {msg.text}
          </div>
        )}

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Informations</div>
        <Card className="mb-5">
          <button onClick={() => openEdit('username')} className="w-full flex items-center justify-between p-4 border-b border-zinc-800/60 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-zinc-500" />
              <div className="text-left">
                <div className="text-[11px] text-zinc-600 uppercase tracking-wider">Pseudo</div>
                <div className="text-[14px] font-medium text-white mt-0.5">{username || '—'}</div>
              </div>
            </div>
            <Edit3 className="w-4 h-4 text-zinc-600" />
          </button>
          <button onClick={() => openEdit('email')} className="w-full flex items-center justify-between p-4 border-b border-zinc-800/60 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-zinc-500" />
              <div className="text-left">
                <div className="text-[11px] text-zinc-600 uppercase tracking-wider">Email</div>
                <div className="text-[14px] font-medium text-white mt-0.5">{email}</div>
              </div>
            </div>
            <Edit3 className="w-4 h-4 text-zinc-600" />
          </button>
          <button onClick={() => openEdit('password')} className="w-full flex items-center justify-between p-4 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <Lock className="w-4 h-4 text-zinc-500" />
              <div className="text-left">
                <div className="text-[11px] text-zinc-600 uppercase tracking-wider">Mot de passe</div>
                <div className="text-[14px] font-medium text-zinc-400 mt-0.5">••••••••</div>
              </div>
            </div>
            <Edit3 className="w-4 h-4 text-zinc-600" />
          </button>
        </Card>

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Application</div>
        <Card className="mb-5">
          <button onClick={() => setShowSettings(true)} className="w-full flex items-center justify-between p-4 border-b border-zinc-800/60 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <Sliders className="w-4 h-4 text-zinc-500" />
              <span className="text-[14px] font-medium text-white">Réglages</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>
          <button onClick={onSignOut} className="w-full flex items-center justify-between p-4 active:bg-[#252527]">
            <span className="text-[14px] font-medium text-rose-400">Se déconnecter</span>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>
        </Card>

        {/* ── Légal & confidentialité ──────────────────────────────────── */}
        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Légal & confidentialité</div>
        <Card className="mb-5">
          <button onClick={() => setLegalDoc('cgu')} className="w-full flex items-center justify-between p-4 border-b border-zinc-800/60 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <ScrollText className="w-4 h-4 text-zinc-500" />
              <span className="text-[14px] font-medium text-white">Conditions d'utilisation</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>
          <button onClick={() => setLegalDoc('privacy')} className="w-full flex items-center justify-between p-4 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-zinc-500" />
              <span className="text-[14px] font-medium text-white">Politique de confidentialité</span>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>
        </Card>

        {/* ── Suppression du compte ────────────────────────────────────── */}
        <Card className="mb-5">
          <button onClick={() => setDeleteSheet(true)} className="w-full flex items-center justify-between p-4 active:bg-[#252527]">
            <div className="flex items-center gap-3">
              <Trash2 className="w-4 h-4 text-rose-400" />
              <div className="text-left">
                <div className="text-[14px] font-medium text-rose-400">Supprimer mon compte</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">Efface définitivement toutes mes données</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </button>
        </Card>

        {msg && (
          <div className={`mb-4 px-4 py-3 rounded-xl text-[13px] font-medium ${msg.type === 'err' ? 'bg-rose-500/15 text-rose-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Modale légale */}
      <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />

      {/* Sheet de confirmation suppression compte */}
      <Sheet open={deleteSheet} onClose={() => setDeleteSheet(false)} title="Supprimer mon compte">
        <div className="space-y-4">
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.18)' }}>
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-[14px] font-semibold text-rose-300">Action irréversible</div>
                <div className="text-[12.5px] text-rose-400/70 mt-1 leading-relaxed">
                  Toutes tes données (revenus, charges, dépenses, clients, Control.) seront définitivement supprimées. Cette action ne peut pas être annulée.
                </div>
              </div>
            </div>
          </div>

          <div className="text-[12.5px] text-zinc-500 leading-relaxed px-1">
            Pense à exporter tes données avant si tu veux en garder une copie. Tu peux le faire depuis Réglages → Exporter mes données.
          </div>

          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            className="w-full bg-rose-500 text-white font-semibold py-3.5 rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {deleting ? 'Suppression…' : 'Supprimer définitivement'}
          </button>
          <button onClick={() => setDeleteSheet(false)} className="w-full text-zinc-400 text-[14px] font-medium py-2">
            Annuler
          </button>
        </div>
      </Sheet>

      {/* Edit sheet */}
      <Sheet
        open={!!editField}
        onClose={() => setEditField(null)}
        title={editField === 'username' ? 'Modifier le pseudo' : editField === 'email' ? 'Modifier l\'email' : 'Modifier le mot de passe'}
      >
        <div className="space-y-4">
          {editField === 'password' ? (
            <>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Nouveau mot de passe</label>
                <input type="password" value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                  className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none" />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Confirmer</label>
                <input type="password" value={fieldValue2} onChange={e => setFieldValue2(e.target.value)}
                  className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none" />
              </div>
            </>
          ) : (
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                {editField === 'username' ? 'Pseudo' : 'Email'}
              </label>
              <input autoFocus type={editField === 'email' ? 'email' : 'text'} value={fieldValue}
                onChange={e => setFieldValue(e.target.value)}
                className="w-full mt-1.5 bg-[#2C2C2E] rounded-xl px-4 py-3 text-white text-[15px] outline-none" />
            </div>
          )}
          {msg && <div className={`px-4 py-3 rounded-xl text-[13px] ${msg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>{msg.text}</div>}
          <button onClick={saveField} disabled={loading}
            className="w-full bg-white text-black font-semibold py-3.5 rounded-xl active:scale-[0.98] disabled:opacity-50">
            {loading ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </Sheet>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

const useAuthSession = () => {
  const [user, setUser] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleAuth = async (mode, { email, password, firstName, username }) => {
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { success: false, error: translateAuthError(error.message) };
      return { success: true };
    } else {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { first_name: firstName, username } }
      });
      if (error) return { success: false, error: translateAuthError(error.message) };
      return { success: true, needsConfirm: true };
    }
  };

  const signOut = () => supabase.auth.signOut();

  return { user, handleAuth, signOut };
};

const translateAuthError = (msg) => {
  if (msg.includes('Invalid login')) return 'Email ou mot de passe incorrect.';
  if (msg.includes('already registered')) return 'Cet email est déjà utilisé.';
  if (msg.includes('Password should')) return 'Mot de passe : 6 caractères minimum.';
  if (msg.includes('email')) return 'Adresse email invalide.';
  return msg;
};

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const DesktopSidebar = ({ tab, setTab, user, openAddTx, openAddVar }) => {
  const items = [
    { id: 'dashboard', label: 'Accueil',   icon: Home },
    { id: 'revenue',   label: 'Revenus',   icon: Wallet },
    { id: 'expenses',  label: 'Charges',   icon: Receipt },
    { id: 'varexp',    label: 'Dépenses',  icon: ShoppingBag },
    { id: 'controls',  label: 'Control.',  icon: Target },
    { id: 'year',      label: 'Année',     icon: BarChart3 },
  ];
  const name = user?.user_metadata?.username || user?.user_metadata?.first_name || 'Mon compte';

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-[260px] lg:flex-shrink-0 lg:h-screen border-r border-white/[0.06] px-4 py-6"
      style={{ background: 'rgba(10,10,12,0.6)', backdropFilter: 'blur(20px)' }}>
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-3 mb-8">
        <img src="/apple-touch-icon.png" alt="Control." className="w-9 h-9 rounded-xl" />
        <span className="text-[19px] font-bold tracking-tight text-white">Control<span className="text-zinc-600">.</span></span>
      </div>

      {/* Action rapide */}
      <button onClick={openAddTx}
        className="flex items-center justify-center gap-2 w-full py-2.5 mb-1.5 bg-white text-black rounded-xl text-[13.5px] font-semibold active:scale-[0.98] hover:bg-zinc-100 transition-all">
        <Plus className="w-4 h-4" /> Ajouter une vente
      </button>
      <button onClick={openAddVar}
        className="flex items-center justify-center gap-2 w-full py-2.5 mb-6 bg-[#1C1C1E] border border-white/[0.06] text-white rounded-xl text-[13.5px] font-semibold active:scale-[0.98] hover:bg-[#252527] transition-all">
        <ShoppingBag className="w-3.5 h-3.5 text-rose-400" /> Ajouter une dépense
      </button>

      {/* Nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {items.map(it => {
          const Icon = it.icon;
          const active = tab === it.id;
          return (
            <button key={it.id} onClick={() => setTab(it.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
                active ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]'}`}>
              <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2.5 : 2} />
              {it.label}
            </button>
          );
        })}
      </nav>

      {/* Profil */}
      <button onClick={() => setTab('profile')}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all ${
          tab === 'profile' ? 'bg-white/[0.08] text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]'}`}>
        <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-zinc-400" />
        </div>
        <span className="truncate">{name}</span>
      </button>
    </aside>
  );
};

const TabBar = ({ tab, setTab }) => {
  const tabs = [
    { id: 'dashboard',  label: 'Accueil',   icon: Home },
    { id: 'revenue',    label: 'Revenus',   icon: Wallet },
    { id: 'expenses',   label: 'Charges',   icon: Receipt },
    { id: 'varexp',     label: 'Dépenses',  icon: ShoppingBag },
    { id: 'controls',   label: 'Control.',  icon: Target },
    { id: 'year',       label: 'Année',     icon: BarChart3 },
    { id: 'profile',    label: 'Profil',    icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-5 pt-3" style={{ pointerEvents: 'none' }}>
      <div
        className="backdrop-blur-2xl rounded-full px-1.5 py-2 flex items-center gap-0.5"
        style={{
          pointerEvents: 'auto',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          backdropFilter: 'blur(24px) saturate(180%)',
          background: 'rgba(18,18,20,0.78)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 48px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-center transition-all duration-200 ${active ? 'px-3 py-2.5 rounded-full' : 'p-2'}`}
              style={active ? {
                background: 'linear-gradient(180deg, #FAFAFA 0%, #C7C7CC 100%)',
                boxShadow: '0 2px 12px -2px rgba(255,255,255,0.2), inset 0 1px 0 rgba(255,255,255,0.6)',
              } : {}}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-black' : 'text-zinc-500'}`} strokeWidth={active ? 2.5 : 2} />
              {active && <span className="text-black text-[12px] font-semibold ml-1.5" style={{ letterSpacing: '-0.1px' }}>{t.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

// Disclaimer affiché une seule fois, au premier lancement après inscription.
// Clarifie que Control. est un outil de suivi indicatif et que l'utilisateur
// configure et reste responsable de son taux URSSAF. Conforme à notre position :
// pas de conseil fiscal, simple miroir des données saisies.
const OnboardingDisclaimer = ({ onAccept, onOpenLegal }) => {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif',
    }}>
      <div className="anim-1" style={{ width: '100%', maxWidth: 420 }}>
        <div className="flex flex-col items-center text-center mb-6">
          <div style={{
            width: 64, height: 64, borderRadius: 20,
            background: 'rgba(48,209,88,0.12)', border: '1px solid rgba(48,209,88,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18,
          }}>
            <Shield className="w-7 h-7 text-emerald-400" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', margin: '0 0 8px' }}>
            Bienvenue sur Control.
          </h2>
          <p style={{ fontSize: 14.5, color: '#8E8E93', lineHeight: 1.55, margin: 0, maxWidth: 340 }}>
            Quelques précisions avant de commencer.
          </p>
        </div>

        <div className="space-y-3 mb-6">
          {[
            { icon: <FileText className="w-4 h-4 text-emerald-400" />, title: 'Un outil de suivi personnel', text: "Control. affiche uniquement les données que tu saisis. Ce n'est pas un logiciel comptable officiel ni un conseil fiscal." },
            { icon: <Sliders className="w-4 h-4 text-emerald-400" />, title: 'Ton taux URSSAF, ta configuration', text: "Tu définis toi-même ton taux de cotisation. L'estimation URSSAF est indicative et dépend de ce que tu renseignes." },
            { icon: <Lock className="w-4 h-4 text-emerald-400" />, title: 'Tes données t\'appartiennent', text: 'Elles sont stockées de façon sécurisée, jamais revendues, et tu peux les exporter ou tout supprimer à tout moment.' },
          ].map((it, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, padding: 14,
              background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 16,
            }}>
              <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, background: 'rgba(48,209,88,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {it.icon}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', letterSpacing: '-0.2px' }}>{it.title}</div>
                <div style={{ fontSize: 12.5, color: '#8E8E93', lineHeight: 1.5, marginTop: 2 }}>{it.text}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onAccept}
          className="w-full active:scale-[0.98] transition-transform"
          style={{
            padding: 16, borderRadius: 14,
            background: 'linear-gradient(180deg, #FAFAFA 0%, #C7C7CC 100%)',
            border: 'none', fontSize: 16, fontWeight: 600, color: '#000',
            letterSpacing: '-0.2px', cursor: 'pointer',
            boxShadow: '0 4px 20px -4px rgba(255,255,255,0.15), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          J'ai compris, commencer
        </button>
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button onClick={() => onOpenLegal('privacy')} style={{ fontSize: 12.5, color: '#6E6E73', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Politique de confidentialité
          </button>
          <span style={{ color: '#3A3A3C', margin: '0 8px' }}>·</span>
          <button onClick={() => onOpenLegal('cgu')} style={{ fontSize: 12.5, color: '#6E6E73', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Conditions d'utilisation
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const { user, handleAuth, signOut } = useAuthSession();
  const [state, setState, synced] = useAppState(user);
  const [tab, setTab] = useState('dashboard');
  const [year, setYearState] = useState(TODAY_YEAR);
  const [month, setMonthState] = useState(TODAY_MONTH);
  const [addOpen, setAddOpen] = useState(false);
  const [addVarOpen, setAddVarOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [onboardingLegal, setOnboardingLegal] = useState(null); // legal modal over onboarding
  const prevUserRef = useRef(null);

  const setMonth = (y, m) => { setYearState(y); setMonthState(m); };

  // Marque l'onboarding comme vu (persisté dans settings → synchronisé Supabase).
  const acceptOnboarding = () => {
    setState(s => ({ ...s, settings: { ...s.settings, onboardingDone: true } }));
  };

  // Synchronise le flag global de décimales avec le setting utilisateur.
  // Ce flag est lu par fmt() pour décider de l'affichage avec/sans décimales,
  // ce qui propage instantanément le changement à tous les écrans.
  useEffect(() => {
    setShowDecimalsFlag(state.settings?.showDecimals !== false);
  }, [state.settings?.showDecimals]);

  // Force le retour au dashboard à chaque connexion / inscription réussie
  useEffect(() => {
    const prev = prevUserRef.current;
    if (!prev && user) setTab('dashboard');
    prevUserRef.current = user ?? null;
  }, [user]);

  // Splash screen : affiché à l'ouverture, indépendamment de l'auth
  if (!splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  // Loading screen
  if (user === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, border: '2px solid rgba(255,255,255,0.08)', borderTopColor: 'rgba(255,255,255,0.9)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
      </div>
    );
  }

  // Auth screen
  if (!user) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  // Onboarding : affiché une fois après inscription, une fois l'état distant
  // chargé (synced) pour éviter tout flash chez un utilisateur de retour.
  if (synced && user && !state.settings?.onboardingDone) {
    return (
      <div className="min-h-screen bg-black text-white antialiased" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif' }}>
        <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } } .anim-1 { animation: fadeUp 0.5s cubic-bezier(.22,1,.36,1) both; }`}</style>
        <OnboardingDisclaimer onAccept={acceptOnboarding} onOpenLegal={(d) => setOnboardingLegal(d)} />
        <LegalModal doc={onboardingLegal} onClose={() => setOnboardingLegal(null)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white antialiased" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif' }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .anim-1 { animation: fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-2 { animation: fadeUp 0.4s 0.06s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-3 { animation: fadeUp 0.4s 0.12s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-4 { animation: fadeUp 0.4s 0.18s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-5 { animation: fadeUp 0.4s 0.24s cubic-bezier(0.22,1,0.36,1) both; }
        .anim-6 { animation: fadeUp 0.4s 0.30s cubic-bezier(0.22,1,0.36,1) both; }
        * { -webkit-tap-highlight-color: transparent; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); opacity: 0.5; }
        ::-webkit-scrollbar { display: none; }
        @media (min-width: 1024px) {
          .dk-ambient {
            background:
              radial-gradient(60vw 60vh at 18% 0%, rgba(48,209,88,0.06), transparent 60%),
              radial-gradient(50vw 50vh at 100% 100%, rgba(94,92,230,0.07), transparent 55%),
              #000;
          }
          .dk-content::-webkit-scrollbar { display: none; }
        }
      `}</style>

      {/* ── DESKTOP SHELL (lg+) : sidebar + contenu centré ; mobile inchangé ── */}
      <div className="lg:flex lg:h-screen lg:overflow-hidden dk-ambient">

        {/* Sidebar desktop */}
        <DesktopSidebar tab={tab} setTab={setTab} user={user} openAddTx={() => setAddOpen(true)} openAddVar={() => setAddVarOpen(true)} />

        {/* Zone contenu */}
        <div className="lg:flex-1 lg:h-screen lg:overflow-y-auto dk-content">
          <div className="max-w-md mx-auto min-h-screen lg:max-w-[760px] lg:min-h-0 lg:py-10 lg:px-6">
            <div className="pt-2 lg:pt-0">
              {tab === 'dashboard' && <Dashboard state={state} setState={setState} year={year} month={month} setMonth={setMonth} openAddTx={() => setAddOpen(true)} openAddVar={() => setAddVarOpen(true)} setTab={setTab} user={user} />}
              {tab === 'revenue'   && <RevenuePage state={state} setState={setState} year={year} month={month} setMonth={setMonth} openAddTx={() => setAddOpen(true)} />}
              {tab === 'expenses'  && <ExpensesPage state={state} setState={setState} year={year} month={month} setMonth={setMonth} />}
              {tab === 'varexp'    && <VarExpensesPage state={state} setState={setState} year={year} month={month} setMonth={setMonth} />}
              {tab === 'controls'  && <ControlsPage state={state} setState={setState} />}
              {tab === 'year'      && <YearPage state={state} year={year} setMonth={setMonth} setTab={setTab} />}
              {tab === 'profile'   && <ProfilePage user={user} state={state} setState={setState} onSignOut={signOut} onExport={() => setExportOpen(true)} />}
              {tab === 'settings'  && <SettingsPage state={state} setState={setState} user={user} onSignOut={signOut} onExport={() => setExportOpen(true)} />}
            </div>
          </div>
        </div>
      </div>

      {/* TabBar mobile uniquement */}
      <div className="lg:hidden">
        <TabBar tab={tab} setTab={setTab} />
      </div>

      <AddTransactionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        state={state}
        setState={setState}
        defaultYear={year}
        defaultMonth={month}
      />
      <VarExpenseEditor
        expense={addVarOpen ? { id: 'new' } : null}
        state={state}
        setState={setState}
        onClose={() => setAddVarOpen(false)}
        defaultYear={year}
        defaultMonth={month}
      />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} state={state} />
    </div>
  );
}
