## Supabase Setup

1. Copy `.env.example` to `.env` and fill in your project values.
2. In Supabase SQL Editor, run:

```sql
create table if not exists public.deck_layout (
  axis text not null check (axis in ('row', 'column')),
  position integer not null check (position >= 0),
  deck_name text not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (axis, position)
);

create unique index if not exists deck_layout_axis_name_unique
on public.deck_layout(axis, deck_name);

create table if not exists public.matchup_cells (
  row_deck text not null,
  column_deck text not null,
  score integer not null default 0,
  games integer not null default 0 check (games >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (row_deck, column_deck)
);

alter table public.deck_layout enable row level security;
alter table public.matchup_cells enable row level security;

drop policy if exists "deck_layout_select" on public.deck_layout;
drop policy if exists "deck_layout_insert" on public.deck_layout;
drop policy if exists "deck_layout_update" on public.deck_layout;
drop policy if exists "deck_layout_delete" on public.deck_layout;

drop policy if exists "matchup_cells_select" on public.matchup_cells;
drop policy if exists "matchup_cells_insert" on public.matchup_cells;
drop policy if exists "matchup_cells_update" on public.matchup_cells;
drop policy if exists "matchup_cells_delete" on public.matchup_cells;

create policy "deck_layout_select"
on public.deck_layout
for select
using (auth.role() = 'authenticated');

create policy "deck_layout_insert"
on public.deck_layout
for insert
with check (auth.role() = 'authenticated');

create policy "deck_layout_update"
on public.deck_layout
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "deck_layout_delete"
on public.deck_layout
for delete
using (auth.role() = 'authenticated');

create policy "matchup_cells_select"
on public.matchup_cells
for select
using (auth.role() = 'authenticated');

create policy "matchup_cells_insert"
on public.matchup_cells
for insert
with check (auth.role() = 'authenticated');

create policy "matchup_cells_update"
on public.matchup_cells
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "matchup_cells_delete"
on public.matchup_cells
for delete
using (auth.role() = 'authenticated');
```

3. Optional migration from old `app_state` JSON format:

```sql
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'app_state'
  ) then
    insert into public.deck_layout (axis, position, deck_name)
    select 'row', ((r.ord - 1)::int), r.deck_name
    from public.app_state s,
         jsonb_array_elements_text(s.payload -> 'rowDecks') with ordinality as r(deck_name, ord)
    where s.id = 1
    on conflict (axis, position) do update set deck_name = excluded.deck_name;

    insert into public.deck_layout (axis, position, deck_name)
    select 'column', ((c.ord - 1)::int), c.deck_name
    from public.app_state s,
         jsonb_array_elements_text(s.payload -> 'columnDecks') with ordinality as c(deck_name, ord)
    where s.id = 1
    on conflict (axis, position) do update set deck_name = excluded.deck_name;

    with src as (
      select payload
      from public.app_state
      where id = 1
    ),
    rows as (
      select ((ord - 1)::int) as idx, deck_name
      from src, jsonb_array_elements_text(payload -> 'rowDecks') with ordinality as t(deck_name, ord)
    ),
    cols as (
      select ((ord - 1)::int) as idx, deck_name
      from src, jsonb_array_elements_text(payload -> 'columnDecks') with ordinality as t(deck_name, ord)
    )
    insert into public.matchup_cells (row_deck, column_deck, score, games)
    select
      r.deck_name,
      c.deck_name,
      coalesce((src.payload -> 'matrix' -> r.idx -> c.idx ->> 'score')::int, 0),
      coalesce((src.payload -> 'matrix' -> r.idx -> c.idx ->> 'games')::int, 0)
    from src
    cross join rows r
    cross join cols c
    on conflict (row_deck, column_deck)
    do update set
      score = excluded.score,
      games = excluded.games;
  end if;
end $$;
```

4. Create exactly two users in Supabase Auth:
- Authentication -> Users -> Add user.
- Use email/password accounts for the two allowed users.

5. Disable self-signups:
- Authentication -> Providers -> Email
- Turn off sign-up for email/password.

6. In `.env`, set `VITE_ALLOWED_EMAILS` to exactly those two emails.

7. Run:

```bash
npm install
npm run dev
```
