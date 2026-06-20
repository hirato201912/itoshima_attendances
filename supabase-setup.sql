-- 糸島学習塾 勤怠管理アプリ セットアップSQL
-- Supabaseのダッシュボード > SQL Editor で実行してください

-- 1. itoshima_teachers（講師テーブル）
CREATE TABLE IF NOT EXISTS itoshima_teachers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  password text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- 2. itoshima_attendances（勤怠テーブル）
CREATE TABLE IF NOT EXISTS itoshima_attendances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES itoshima_teachers(id) ON DELETE CASCADE,
  date date NOT NULL,
  periods integer NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  lesson_type text NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

-- RLS（Row Level Security）を無効化（簡易認証のため）
ALTER TABLE itoshima_teachers DISABLE ROW LEVEL SECURITY;
ALTER TABLE itoshima_attendances DISABLE ROW LEVEL SECURITY;

-- サンプル講師データ（実際の講師名とパスワードに変更してください）
INSERT INTO itoshima_teachers (name, password) VALUES
  ('山田太郎', 'yamada123'),
  ('鈴木花子', 'suzuki456'),
  ('田中一郎', 'tanaka789')
ON CONFLICT DO NOTHING;

-- 3. juku_summer_availability（夏期講習シフト希望＋確定）
-- レコードがあれば「出られる」希望。is_confirmed=true は管理者が「依頼確定」した状態
CREATE TABLE IF NOT EXISTS juku_summer_availability (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id uuid NOT NULL REFERENCES itoshima_teachers(id) ON DELETE CASCADE,
  date date NOT NULL,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 5),
  is_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (teacher_id, date, slot)
);

ALTER TABLE juku_summer_availability DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_juku_summer_availability_date ON juku_summer_availability(date);
CREATE INDEX IF NOT EXISTS idx_juku_summer_availability_teacher ON juku_summer_availability(teacher_id);
CREATE INDEX IF NOT EXISTS idx_juku_summer_availability_confirmed
  ON juku_summer_availability (is_confirmed)
  WHERE is_confirmed = true;

-- 4. juku_summer_apply（保護者からの夏期講習 申込本体）
-- 保護者が /summer/apply から1回送信するごとに1レコード
CREATE TABLE IF NOT EXISTS juku_summer_apply (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  student_name text NOT NULL,
  grade text,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

-- 5. juku_summer_apply_slots（申込に紐づく希望コマ）
CREATE TABLE IF NOT EXISTS juku_summer_apply_slots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  apply_id uuid NOT NULL REFERENCES juku_summer_apply(id) ON DELETE CASCADE,
  date date NOT NULL,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 5),
  UNIQUE (apply_id, date, slot)
);

ALTER TABLE juku_summer_apply DISABLE ROW LEVEL SECURITY;
ALTER TABLE juku_summer_apply_slots DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_juku_summer_apply_created ON juku_summer_apply(created_at);
CREATE INDEX IF NOT EXISTS idx_juku_summer_apply_slots_apply ON juku_summer_apply_slots(apply_id);
CREATE INDEX IF NOT EXISTS idx_juku_summer_apply_slots_date ON juku_summer_apply_slots(date);
