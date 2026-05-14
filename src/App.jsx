import React, { useState, useEffect, useMemo, useRef } from 'react';
import { loadState, saveState } from './lib/db';
import { supabase } from './lib/supabase';
import AuthScreen from './components/AuthScreen';
import { Plus, ChevronLeft, ChevronRight, X, Trash2, Wallet, Edit3, Check, Home, BarChart3, Receipt, Sliders, AlertCircle, Power, Bell, Clock, FileText, EyeOff, ShoppingBag, User, TrendingUp, Users, Camera, Lock, Mail } from 'lucide-react';

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

const fmt = (n, opts = {}) => {
  const { decimals } = opts;
  const v = Number(n) || 0;
  const d = decimals !== undefined ? decimals : (Math.abs(v) >= 1000 ? 0 : 2);
  return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
};

const fmtCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + 'k';
  return Math.round(v).toString();
};

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
  settings: {
    ursaffRate: 0,
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
    settings: {
      ursaffRate: legacy.settings?.ursaffRate ?? 0,
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
        setState(remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
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

  return [state, setState];
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
  const ursaff = brutTaxable * state.settings.ursaffRate;

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
    ursaffDue: brutTaxable * state.settings.ursaffRate,
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
    style={style}
    className={`rounded-2xl bg-[#1C1C1E] ${onClick ? 'active:bg-[#252527] active:scale-[0.98] cursor-pointer transition-all' : ''} ${className}`}
  >
    {children}
  </div>
);

const TopBar = ({ title, subtitle, right }) => (
  <div className="flex items-end justify-between px-5 pt-3 pb-4">
    <div>
      {subtitle && <div className="text-xs text-zinc-500 font-medium tracking-wide uppercase mb-1">{subtitle}</div>}
      <h1 className="text-[28px] font-bold text-white leading-tight tracking-tight">{title}</h1>
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
    <div className="flex items-center gap-1 bg-[#1C1C1E] rounded-full px-1 py-1">
      <button onClick={() => go(-1)} className="w-8 h-8 flex items-center justify-center rounded-full active:bg-[#2C2C2E]">
        <ChevronLeft className="w-4 h-4 text-zinc-400" />
      </button>
      <div className="px-2 text-sm font-semibold text-white min-w-[80px] text-center">
        {MONTHS_SHORT[month]} {String(year).slice(2)}
        {isCurrent && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 align-middle" />}
      </div>
      <button onClick={() => go(1)} className="w-8 h-8 flex items-center justify-center rounded-full active:bg-[#2C2C2E]">
        <ChevronRight className="w-4 h-4 text-zinc-400" />
      </button>
    </div>
  );
};

const Sheet = ({ open, onClose, children, title }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" style={{ WebkitBackdropFilter: 'blur(4px)' }} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-[#1C1C1E] rounded-t-3xl pb-8 max-h-[90vh] overflow-y-auto"
        style={{ animation: 'slideUp 0.25s cubic-bezier(0.32, 0.72, 0, 1)' }}
      >
        <div className="sticky top-0 bg-[#1C1C1E] pt-3 pb-2 px-5 rounded-t-3xl z-10">
          <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-[#2C2C2E] active:bg-[#3A3A3C]">
              <X className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        </div>
        <div className="px-5 pt-3">{children}</div>
      </div>
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
// Dashboard
// ---------------------------------------------------------------------------

const Dashboard = ({ state, year, month, setMonth, openAddTx, openAddVar, setTab, user }) => {
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
      arr.push({ month: m, year: y, net: d.net });
    }
    return arr;
  }, [state, year, month]);

  const maxAbsNet = Math.max(1, ...last6.map(d => Math.abs(d.net)));

  const benefice = data.brut - data.ursaff;
  const argentVrai = benefice - data.chargesPaid - varData.total;
  const chargesUnpaid = data.charges - data.chargesPaid;
  const chargesPaidCount = data.dueExpenses.filter(e => e.paid).length;
  const userFirstName = user?.user_metadata?.first_name || user?.user_metadata?.username || 'toi';

  return (
    <div className="pb-32">

      {/* ── WELCOME HEADER ───────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-2 flex items-center justify-between anim-1">
        <div>
          <div className="text-[13px] text-zinc-500 font-medium">{MONTHS_FR[month]} {year}</div>
          <h1 className="text-[26px] font-bold text-white leading-tight tracking-tight mt-0.5">
            Bonjour {userFirstName} 👋
          </h1>
          <div className="text-[13px] text-zinc-500 mt-0.5">Prêt à contrôler tes finances</div>
        </div>
        <div className="flex items-center gap-2">
          <MonthSwitcher year={year} month={month} onChange={(y, m) => setMonth(y, m)} />
          <button
            onClick={() => setTab('profile')}
            className="w-10 h-10 rounded-full bg-[#1C1C1E] border border-zinc-800/60 flex items-center justify-center active:bg-[#2C2C2E]"
          >
            <span className="text-white text-[15px] font-bold">
              {(user?.user_metadata?.first_name || user?.email || '?')[0].toUpperCase()}
            </span>
          </button>
        </div>
      </div>

      {/* ── QUICK ACTIONS ────────────────────────────────────────────────── */}
      <div className="px-5 mb-4 anim-1">
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
              const d = data.byActivity[a.id] || { total: 0 };
              if (d.total === 0) return null;
              return (
                <div key={a.id} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-[11px] text-zinc-400">{a.name}</span>
                  <span className="text-[11px] font-semibold text-zinc-300">{fmt(d.total, { decimals: 0 })} €</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── BLOC 2 : Bénéfice après URSSAF ──────────────────────────────── */}
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

      {/* ── ARGENT RÉELLEMENT DISPONIBLE (neutre) ────────────────────────── */}
      <div className="px-5 mt-2 anim-4">
        <div
          className="rounded-3xl p-6 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #1C1C1E 0%, #252527 100%)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-zinc-500 mb-1">
            Argent réellement disponible
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-[52px] font-bold tracking-tight leading-none ${argentVrai >= 0 ? 'text-white' : 'text-rose-400'}`}>
              {argentVrai >= 0 ? '+' : ''}{fmt(argentVrai, { decimals: 0 })}
            </span>
            <span className="text-2xl font-medium text-zinc-500">€</span>
          </div>
          <div className="text-[12px] mt-1.5 text-zinc-600">
            bénéfice − charges payées − dépenses
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-zinc-800/80 flex items-center justify-center">
                  <Receipt className="w-3.5 h-3.5 text-zinc-400" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-zinc-200">Charges fixes</div>
                  <div className="text-[10px] text-zinc-600">{chargesPaidCount}/{data.dueExpenses.length} payées</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[14px] font-bold text-zinc-400">−{fmt(data.chargesPaid, { decimals: 0 })} €</div>
                {chargesUnpaid > 0 && <div className="text-[10px] text-zinc-600">{fmt(chargesUnpaid, { decimals: 0 })} € restant</div>}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-zinc-800/80 flex items-center justify-center">
                  <ShoppingBag className="w-3.5 h-3.5 text-zinc-400" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-zinc-200">Dépenses</div>
                  <div className="text-[10px] text-zinc-600">{varData.items.length} opération{varData.items.length !== 1 ? 's' : ''}</div>
                </div>
              </div>
              <div className="text-[14px] font-bold text-zinc-400">−{fmt(varData.total, { decimals: 0 })} €</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── DÉCLARATION URSSAF ───────────────────────────────────────────── */}
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

      {/* ── ACTIVITÉS ────────────────────────────────────────────────────── */}
      <div className="px-5 mt-6 anim-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white tracking-tight">Mes activités</h3>
          <button onClick={openAddTx} className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-400 active:opacity-60 bg-emerald-400/10 px-3 py-1.5 rounded-full">
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>

        <div className="space-y-2">
          {activeActivities.map(a => {
            const d = data.byActivity[a.id] || { total: 0, count: 0 };
            const pct = data.brut > 0 ? Math.min(100, (d.total / data.brut) * 100) : 0;
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                    <div>
                      <div className="text-[14px] font-semibold text-white leading-tight">{a.name}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {d.count} {d.count > 1 ? 'ventes' : 'vente'}
                        {!a.taxable && <span className="ml-1.5 px-1.5 py-px rounded-md bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider">non URSSAF</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-[16px] font-bold text-white">{fmt(d.total, { decimals: 0 })} €</div>
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
      </div>

      {/* ── 6 DERNIERS MOIS ──────────────────────────────────────────────── */}
      <div className="px-5 mt-6 anim-6">
        <h3 className="text-sm font-semibold text-white mb-3 tracking-tight">6 derniers mois</h3>
        <Card className="p-5">
          <div className="flex items-end justify-between gap-1.5 h-32">
            {last6.map((d, i) => {
              const h = (Math.abs(d.net) / maxAbsNet) * 100;
              const isCurrent = d.year === year && d.month === month;
              const positive = d.net >= 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end gap-2">
                  <div className="w-full flex flex-col items-center justify-end" style={{ height: '100%' }}>
                    <div
                      className={`w-full rounded-lg transition-all duration-700 ${isCurrent
                        ? (positive ? 'bg-emerald-400' : 'bg-rose-400')
                        : (positive ? 'bg-emerald-400/25' : 'bg-rose-400/25')}`}
                      style={{ height: `${Math.max(4, h)}%`, minHeight: '4px' }}
                    />
                  </div>
                  <div className={`text-[10px] font-medium ${isCurrent ? 'text-white' : 'text-zinc-600'}`}>
                    {MONTHS_SHORT[d.month]}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Revenue page
// ---------------------------------------------------------------------------

const RevenuePage = ({ state, setState, year, month, setMonth, openAddTx }) => {
  const data = useMemo(() => computeMonth(state, year, month), [state, year, month]);
  const visibleActivities = useMemo(() =>
    [...state.activities].sort((a, b) => a.order - b.order),
    [state.activities]);

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
          return (
            <div key={a.id} className="mb-5">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-[13px] font-semibold text-white uppercase tracking-wider truncate">{a.name}</span>
                  {a.active === false && <EyeOff className="w-3 h-3 text-zinc-600 flex-shrink-0" />}
                  {!a.taxable && <span className="px-1.5 py-px rounded bg-zinc-800 text-zinc-400 text-[9px] uppercase tracking-wider flex-shrink-0">non URSSAF</span>}
                </div>
                <span className="text-[13px] font-bold text-white">{fmt(total, { decimals: 2 })} €</span>
              </div>
              <Card>
                {txs.map((t, i) => (
                  <div key={t.id} className={`flex items-center justify-between p-4 ${i < txs.length - 1 ? 'border-b border-zinc-800/60' : ''}`}>
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="text-[14px] font-medium text-white truncate">{t.description || 'Sans description'}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {new Date(t.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-[14px] font-semibold text-white">{fmt(t.amount, { decimals: 2 })} €</div>
                      <button onClick={() => deleteTx(t.id)} className="text-zinc-600 active:text-rose-400 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </Card>
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
  const yearData = useMemo(() => {
    const arr = [];
    for (let m = 0; m < 12; m++) arr.push({ month: m, ...computeMonth(state, year, m) });
    return arr;
  }, [state, year]);

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

  return (
    <div className="pb-32">
      <TopBar subtitle={year.toString()} title="Année" />

      <div className="px-5">
        <Card className="p-5 mb-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-3">Bilan {year}</div>
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
          <div className="border-t border-zinc-800 mt-4 pt-3 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">Net annuel</div>
            <div className={`text-2xl font-bold ${totals.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totals.net >= 0 ? '+' : ''}{fmt(totals.net, { decimals: 0 })} €
            </div>
          </div>
        </Card>

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

        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Détail mensuel</div>
        <Card>
          {yearData.map((d, i) => (
            <div
              key={i}
              onClick={() => { setMonth(year, d.month); setTab('dashboard'); }}
              className={`flex items-center justify-between p-4 active:bg-[#252527] cursor-pointer ${i < 11 ? 'border-b border-zinc-800/60' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-10 rounded-full ${d.net > 0 ? 'bg-emerald-400' : d.net < 0 ? 'bg-rose-400/40' : 'bg-zinc-700'}`} />
                <div>
                  <div className="text-[14px] font-semibold text-white">{MONTHS_FR[d.month]}</div>
                  <div className="text-[11px] text-zinc-500">
                    {fmt(d.brut, { decimals: 0 })} € brut · {fmt(d.charges, { decimals: 0 })} € charges
                  </div>
                </div>
              </div>
              <div className={`text-[14px] font-bold ${d.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {d.net >= 0 ? '+' : ''}{fmt(d.net, { decimals: 0 })} €
              </div>
            </div>
          ))}
        </Card>

        {/* ── PAR ACTIVITÉ ── */}
        {state.activities.length > 0 && (() => {
          const byActivity = {};
          state.activities.forEach(a => { byActivity[a.id] = 0; });
          state.transactions.forEach(t => {
            const d = new Date(t.date);
            if (d.getFullYear() === year) byActivity[t.activityId] = (byActivity[t.activityId] || 0) + Number(t.amount || 0);
          });
          const sorted = [...state.activities].sort((a, b) => (byActivity[b.id] || 0) - (byActivity[a.id] || 0));
          return (
            <div className="mt-6">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Par activité</div>
              <Card>
                {sorted.map((a, i) => {
                  const total = byActivity[a.id] || 0;
                  const pct = totals.brut > 0 ? (total / totals.brut) * 100 : 0;
                  return (
                    <div key={a.id} className={`p-4 ${i < sorted.length - 1 ? 'border-b border-zinc-800/60' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: a.color }} />
                          <div className="text-[14px] font-medium text-white">{a.name}</div>
                        </div>
                        <div className="text-[14px] font-bold text-white">{fmt(total, { decimals: 0 })} €</div>
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
                  return (
                    <div key={cid} className={`p-4 ${i < sorted.length - 1 ? 'border-b border-zinc-800/60' : ''}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center">
                            <User className="w-3.5 h-3.5 text-zinc-400" />
                          </div>
                          <div className="text-[14px] font-medium text-white">{client?.name || 'Client inconnu'}</div>
                        </div>
                        <div className="text-[14px] font-bold text-white">{fmt(total, { decimals: 0 })} €</div>
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

const SettingsPage = ({ state, setState, user, onSignOut, onBack }) => {
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
        <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-2 px-1">Cotisations</div>
        <Card className="mb-5">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800/60">
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
                onBlur={saveUrsaff}
                className="bg-transparent text-white text-[14px] font-semibold w-12 text-right outline-none"
              />
              <span className="text-zinc-400 text-[14px]">%</span>
            </div>
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
              setState(s => ({ ...s, transactions: [], varExpenses: [], paidExpenses: {}, expenseOverrides: {}, notes: {} }));
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
        <Card className="p-5 mb-5">
          <div className="flex items-end justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mb-1">Total du mois</div>
              <div className="text-3xl font-bold text-white">{fmt(data.total, { decimals: 2 })} €</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-zinc-500 mb-1">{data.items.length} dépense{data.items.length !== 1 ? 's' : ''}</div>
              <div className="text-base font-semibold text-zinc-400">{sortedCatIds.length} catégorie{sortedCatIds.length !== 1 ? 's' : ''}</div>
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

        {/* Add button */}
        <button
          onClick={() => setAddOpen(true)}
          className="w-full mb-5 bg-white text-black font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Plus className="w-4 h-4" /> Ajouter une dépense
        </button>

        {/* Expenses by category */}
        {sortedCatIds.map(catId => {
          const cat = catMap[catId];
          const items = byCategory[catId];
          const catTotal = items.reduce((s, e) => s + e.amount, 0);
          return (
            <div key={catId} className="mb-5">
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  {cat && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cat.color }} />}
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">{cat?.name || 'Autre'}</div>
                </div>
                <div className="text-[11px] font-semibold text-zinc-400">{fmt(catTotal, { decimals: 2 })} €</div>
              </div>
              <Card>
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
// Profile page
// ---------------------------------------------------------------------------

const ProfilePage = ({ user, state, setState, onSignOut }) => {
  const [editField, setEditField] = useState(null); // 'username'|'email'|'password'
  const [fieldValue, setFieldValue] = useState('');
  const [fieldValue2, setFieldValue2] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const firstName = user?.user_metadata?.first_name || '';
  const username = user?.user_metadata?.username || '';
  const email = user?.email || '';
  const initial = (firstName || email || '?')[0].toUpperCase();

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
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center mb-4 shadow-xl shadow-emerald-900/30">
            <span className="text-white text-[42px] font-bold">{initial}</span>
          </div>
          <div className="text-[20px] font-bold text-white">{firstName || 'Mon compte'}</div>
          {username && <div className="text-[14px] text-zinc-500 mt-1">@{username}</div>}
          <div className="text-[13px] text-zinc-600 mt-0.5">{email}</div>
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
      </div>

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

const TabBar = ({ tab, setTab }) => {
  const tabs = [
    { id: 'dashboard',  label: 'Accueil',   icon: Home },
    { id: 'revenue',    label: 'Revenus',   icon: Wallet },
    { id: 'expenses',   label: 'Charges',   icon: Receipt },
    { id: 'varexp',     label: 'Dépenses',  icon: ShoppingBag },
    { id: 'year',       label: 'Année',     icon: BarChart3 },
    { id: 'profile',    label: 'Profil',    icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-5 pt-3" style={{ pointerEvents: 'none' }}>
      <div className="bg-[#1C1C1E]/95 backdrop-blur-xl rounded-full px-2 py-2 flex items-center gap-1 shadow-2xl border border-zinc-800/40" style={{ pointerEvents: 'auto', WebkitBackdropFilter: 'blur(20px)' }}>
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-center transition-all duration-200 ${active ? 'px-4 py-2.5 bg-white rounded-full' : 'p-2.5'}`}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-black' : 'text-zinc-500'}`} strokeWidth={active ? 2.5 : 2} />
              {active && <span className="text-black text-[12px] font-semibold ml-1.5 tracking-tight">{t.label}</span>}
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

export default function App() {
  const { user, handleAuth, signOut } = useAuthSession();
  const [state, setState] = useAppState(user);
  const [tab, setTab] = useState('dashboard');
  const [year, setYearState] = useState(TODAY_YEAR);
  const [month, setMonthState] = useState(TODAY_MONTH);
  const [addOpen, setAddOpen] = useState(false);
  const [addVarOpen, setAddVarOpen] = useState(false);

  const setMonth = (y, m) => { setYearState(y); setMonthState(m); };

  // Loading screen
  if (user === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #2C2C2E', borderTopColor: '#30D158', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
      </div>
    );
  }

  // Auth screen
  if (!user) {
    return <AuthScreen onAuth={handleAuth} />;
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
      `}</style>

      <div className="max-w-md mx-auto min-h-screen">
        <div className="pt-2">
          {tab === 'dashboard' && <Dashboard state={state} year={year} month={month} setMonth={setMonth} openAddTx={() => setAddOpen(true)} openAddVar={() => setAddVarOpen(true)} setTab={setTab} user={user} />}
          {tab === 'revenue'   && <RevenuePage state={state} setState={setState} year={year} month={month} setMonth={setMonth} openAddTx={() => setAddOpen(true)} />}
          {tab === 'expenses'  && <ExpensesPage state={state} setState={setState} year={year} month={month} setMonth={setMonth} />}
          {tab === 'varexp'    && <VarExpensesPage state={state} setState={setState} year={year} month={month} setMonth={setMonth} />}
          {tab === 'year'      && <YearPage state={state} year={year} setMonth={setMonth} setTab={setTab} />}
          {tab === 'profile'   && <ProfilePage user={user} state={state} setState={setState} onSignOut={signOut} />}
          {tab === 'settings'  && <SettingsPage state={state} setState={setState} user={user} onSignOut={signOut} />}
        </div>
      </div>

      <TabBar tab={tab} setTab={setTab} />

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
    </div>
  );
}
