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
