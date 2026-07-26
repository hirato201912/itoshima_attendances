# 糸島学習塾 勤怠管理アプリ - 進捗メモ

## プロジェクト概要
糸島学習塾の講師がスマホから勤怠を登録・送信するWebアプリ。タイムカードの代替。

- **URL（開発）**：`npm run dev` → http://localhost:3000
- **Supabase プロジェクト**：yes-instructor-survey と同じ（ouoawypwkfcdhxqyixue）
- **メインカラー**：#FF7F00（オレンジ）
- **キャラクター**：クマ先生（orange_left.jpg / orange_right.jpg）

---

## 技術スタック
- Next.js 16.2.3（App Router, TypeScript）
- Tailwind CSS v4
- Supabase（DB）

---

## Supabase テーブル構成（現在）

### itoshima_teachers（講師テーブル）
| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | 主キー |
| name | text | 講師名 |
| password | text | 簡易パスワード |
| code | integer | 講師ID（ログイン用数字） |
| created_at | timestamp | |

### itoshima_attendances（勤怠テーブル）
| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | 主キー |
| teacher_id | uuid | itoshima_teachers への外部キー |
| date | date | 勤務日 |
| periods | integer | コマ数（個別:0〜5、集団:スロット数） |
| start_time | time / null | 集団授業は自動セット、個別はnull |
| end_time | time / null | 同上 |
| lesson_type | text | '個別指導' or '集団授業' |
| extra_minutes | integer | 追加業務時間（分）、default 0 |
| notes | text / null | 集団授業は選択スロット文字列（例: "①③"） |
| created_at | timestamp | |

**重要**: RLSは無効。start_time / end_time は nullable に変更済み。

---

## 準備時間の自動付与（授業前後の準備）

授業前後の準備として、**個別指導が1コマ以上あった日**に **1日10分** を自動で付与する。

| 項目 | 内容 |
|---|---|
| 付与条件 | その日に `lesson_type='個別指導'` かつ `periods >= 1` のレコードがある |
| 付与量 | 1日あたり10分（`PREP_MINUTES_PER_DAY`）。同じ日に個別＋集団があっても付与は1回だけ |
| 付与されない | 集団授業のみの日／個別0コマの日（追加業務時間だけの日も対象外） |
| 保存場所 | **DBに保存しない**。`src/types/index.ts` の `prepMinutesForDay()` / `prepMinutesTotal()` で勤怠レコードから毎回計算する |

**DBに保存しない理由**
- 過去の勤怠記録にも遡って自動的に反映される（マイグレーション不要）
- 管理画面でコマ数を修正すると自動で計算し直される（付与済みの値が残って二重計上されない）
- 講師が自分で入力する `extra_minutes`（追加業務時間）と混ざらず、内訳を常に分けて表示できる

**分単位を変えたい場合** は `src/types/index.ts` の `PREP_MINUTES_PER_DAY` を変更するだけでよい（表示・集計・CSVすべてに反映される）。

**表示箇所**
- `/attendance`：個別指導の入力欄に注記、確認画面と送信済み画面に「準備時間 10分（自動付与）」
- `/history`：月間まとめに「追加業務・準備時間」（合計と内訳）、日別カードに「準備時間 10分（自動付与）」
- `/admin` 勤怠管理タブ：講師一覧・講師ヘッダー・記録テーブルの「準備時間」列・日別ビューの「準備時間」列、および「業務時間 合計（追加業務＋準備時間）」

---

## 画面構成

### 1. ログイン画面（`/`）
- 講師ID（数字）＋パスワードで認証
- セッションは localStorage に保存（`juku_teacher` キー）
- ログイン済みなら `/attendance` にリダイレクト
- クマ先生をPC版は左右、スマホ版はカード上部に表示

### 2. 勤怠入力画面（`/attendance`）
- **個別指導**と**集団授業**を同時に入力可能（どちらか一方でも両方でもOK）
- 個別指導：0〜5コマをボタン選択
- 集団授業：以下の5スロットをタップで複数選択
  - ① 17:05〜17:50
  - ② 18:10〜18:55
  - ③ 19:05〜19:50
  - ④ 19:55〜20:40
  - ⑤ 20:45〜21:30
- 追加業務時間：自由入力（分）、任意
- 「入力内容を確認する」→ 確認画面 → 「この内容で送信する」の2ステップ
- 両方入力した場合：DBに2レコード作成（個別1件＋集団1件）
- extra_minutes は個別指導レコードに付与（個別がない場合は集団に付与）

### 3. 勤怠履歴画面（`/history`）
- 月選択フィルター
- 月間合計コマ数・追加業務時間を表示
- 各レコードを日付降順でリスト表示

---

## ファイル構成（主要）
```
src/
  app/
    layout.tsx       # タイトル・favicon・manifest設定
    globals.css      # Tailwind v4、ダークモード削除
    page.tsx         # ログイン画面
    attendance/
      page.tsx       # 勤怠入力画面（確認ステップあり）
    history/
      page.tsx       # 勤怠履歴画面
  lib/
    supabase.ts      # Supabaseクライアント
  types/
    index.ts         # 型定義・GROUP_SLOTS定数
public/
  orange_left.jpg    # クマ先生（左向き・指示棒）
  orange_right.jpg   # クマ先生（右向き・チョーク）→ faviconにも使用
  manifest.json      # PWA設定（ホーム画面追加対応）
  fyi 2026-04-12 122426.png  # 給与明細画面のスクリーンショット（参考）
supabase-setup.sql   # テーブル作成SQL（参考用）
```

---

## 認証方式
- Supabase Auth は**使わない**
- `itoshima_teachers.code`（整数）＋ `password` でログイン
- セッションは `localStorage` の `juku_teacher`（`{id, name}`）で管理

---

## 次にやること（TODO）

### 最優先
- [ ] 管理者向け月次サマリー画面の作成
  - 講師ごとに「個別コマ数・集団コマ数・追加業務時間・勤務日数」を一覧表示
  - 給与明細入力画面（fyi画像参照）に転記するための情報をそのまま出す

### 給与明細との対応（fyi画像より）
| 給与明細の欄 | アプリのデータ | 集計方法 |
|---|---|---|
| 時給①コマ数（個別） | lesson_type='個別指導' の periods | 月SUM |
| 時給②コマ数（集団） | lesson_type='集団授業' の periods | 月SUM |
| 時給③時間（追加業務） | extra_minutes ＋ 準備時間 | 月SUM → 時間換算（管理画面の「業務時間 合計」がこの値） |
| 勤務日数 | date カラム | 月内の重複なし日付数 |

### その他
- [ ] ログイン画面のカードが中央揃えになっているか確認
- [ ] スマホでの表示・操作感の確認
- [ ] 講師IDと実際の講師名の紐付け（code列に番号割り当て）

---

## デザイン方針
- スマホファースト
- メインカラー：#FF7F00
- ボタン選択系のアクティブ状態：`backgroundColor: '#FF7F00', color: white`
- 非アクティブ：白背景・グレー枠
- 集団授業の選択済み状態：`backgroundColor: '#FFF0E0', borderColor: '#FF7F00'`
- フォームカード：`bg-white rounded-2xl shadow-sm`
- ヘッダー（ナビ）：sticky、オレンジ背景、白文字
