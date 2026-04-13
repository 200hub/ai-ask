-- Supabase 便签云同步 — 数据库初始化脚本
-- 在 Supabase Dashboard > SQL Editor 中运行

-- 1. 创建 desktop_notes 表
create table if not exists public.desktop_notes (
  id          text        not null,
  user_id     uuid        not null default auth.uid(),
  title       text        not null default '',
  content     text        not null default '',
  color       text        not null default 'sunny',
  bounds      jsonb       default '{"x":100,"y":100,"width":320,"height":280}'::jsonb,
  created_at  bigint      not null,
  updated_at  bigint      not null,
  deleted_at  bigint,
  primary key (user_id, id)
);

-- 2. 启用 Row Level Security
alter table public.desktop_notes enable row level security;

-- 3. RLS 策略：用户只能操作自己的数据
create policy "Users can select own notes"
  on public.desktop_notes for select
  using (auth.uid() = user_id);

create policy "Users can insert own notes"
  on public.desktop_notes for insert
  with check (auth.uid() = user_id);

create policy "Users can update own notes"
  on public.desktop_notes for update
  using (auth.uid() = user_id);

create policy "Users can delete own notes"
  on public.desktop_notes for delete
  using (auth.uid() = user_id);

-- 4. 索引（加速按用户查询和按更新时间排序）
create index if not exists idx_desktop_notes_user_updated
  on public.desktop_notes (user_id, updated_at desc);

-- 5. 启用 Realtime（用于多设备实时同步）
alter publication supabase_realtime add table public.desktop_notes;
