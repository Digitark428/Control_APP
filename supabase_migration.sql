-- ============================================================
-- Migration finapp — à exécuter dans Supabase > SQL Editor
-- ============================================================

-- 1. Crée la table app_state
create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2. Active Row Level Security
alter table public.app_state enable row level security;

-- 3. Policies — chaque utilisateur ne voit et ne modifie QUE ses propres données
create policy "Users can read own state"
  on public.app_state for select
  using (auth.uid() = user_id);

create policy "Users can insert own state"
  on public.app_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update own state"
  on public.app_state for update
  using (auth.uid() = user_id);

create policy "Users can delete own state"
  on public.app_state for delete
  using (auth.uid() = user_id);

-- 4. Index sur updated_at
create index if not exists app_state_updated_at_idx on public.app_state (updated_at);

-- ============================================================
-- Dans Supabase > Authentication > URL Configuration :
-- Site URL        = https://ton-app.vercel.app
-- Redirect URLs   = https://ton-app.vercel.app/**
-- ============================================================
