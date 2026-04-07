## Supabase Setup

1. Copy `.env.example` to `.env` and fill in your project values.
2. In Supabase SQL Editor, run:

```sql
create table if not exists public.app_state (
  id integer primary key,
  payload jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "app_state_select" on public.app_state;
drop policy if exists "app_state_insert" on public.app_state;
drop policy if exists "app_state_update" on public.app_state;

create policy "app_state_select"
on public.app_state
for select
using (auth.role() = 'authenticated');

create policy "app_state_insert"
on public.app_state
for insert
with check (auth.role() = 'authenticated');

create policy "app_state_update"
on public.app_state
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
```

3. Create exactly two users in Supabase Auth:
- Authentication -> Users -> Add user.
- Use email/password accounts for the two allowed users.

4. Disable self-signups:
- Authentication -> Providers -> Email
- Turn off sign-up for email/password.

5. In `.env`, set `VITE_ALLOWED_EMAILS` to exactly those two emails.

6. Run:

```bash
npm install
npm run dev
```
