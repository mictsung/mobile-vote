-- =============================================================================
-- 在 Supabase：SQL Editor → New query → 貼上後執行（僅限你信任的環境）。
-- 
-- 症狀：Node 後端只用 SUPABASE_ANON_KEY 時，投票或後台更新出現：
--       code 42501 / "violates row-level security policy"
-- 
-- 解法二選一（擇一即可）：
--   A) 在 .env 設定 SUPABASE_SERVICE_ROLE_KEY（僅伺服器，勿外流）
--   B) 執行此腳本，對下列表停用 RLS，讓 anon 金鑰可讀寫
-- =============================================================================

ALTER TABLE basic_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_main DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_main DISABLE ROW LEVEL SECURITY;
ALTER TABLE voting_info DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_info DISABLE ROW LEVEL SECURITY;
ALTER TABLE award_condition DISABLE ROW LEVEL SECURITY;
ALTER TABLE award_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_event DISABLE ROW LEVEL SECURITY;
ALTER TABLE voting_event DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'main_setting'
  ) THEN
    EXECUTE 'ALTER TABLE public.main_setting DISABLE ROW LEVEL SECURITY';
  END IF;
END $$;
