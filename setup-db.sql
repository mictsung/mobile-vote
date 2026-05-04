-- =====================================================
-- 停用 Row Level Security (RLS) 政策
-- 讓 anon key 可以讀寫資料
-- =====================================================

-- 停用所有表的 RLS
ALTER TABLE basic_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_main DISABLE ROW LEVEL SECURITY;
ALTER TABLE location_main DISABLE ROW LEVEL SECURITY;
ALTER TABLE voting_info DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_info DISABLE ROW LEVEL SECURITY;
ALTER TABLE award_condition DISABLE ROW LEVEL SECURITY;
ALTER TABLE award_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE meetup_event DISABLE ROW LEVEL SECURITY;
ALTER TABLE voting_event DISABLE ROW LEVEL SECURITY;
-- 若專案中尚無此表請略過
ALTER TABLE main_setting DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 插入測試資料
-- =====================================================

-- 清空並插入基礎資料
TRUNCATE TABLE basic_data;
INSERT INTO basic_data (title_name, important_info)
VALUES ('手機地圖投票系統', '歡迎參與投票活動！');

-- 清空並插入活動資料
TRUNCATE TABLE event_main;
INSERT INTO event_main (event_id, event_name, event_type, event_date, event_time, voting_due)
VALUES
  ('event_001', 'GO FEST 2026 - Day 1', 'festival', '2026-07-11', '09:00:00', '2026-07-10T23:59:59+08:00'),
  ('event_002', 'GO FEST 2026 - Day 2', 'festival', '2026-07-12', '09:00:00', '2026-07-11T23:59:59+08:00');

-- 清空並插入地點資料
TRUNCATE TABLE location_main;
INSERT INTO location_main (location_id, location_name, location_type, longitude, latitude)
VALUES
  ('loc_001', '台北信義區 - 台北101', 'venue', 121.5645, 25.0330),
  ('loc_002', '台中中山公園', 'park', 120.6500, 24.1351),
  ('loc_003', '高雄夢時代', 'venue', 120.3011, 22.5950);

-- =====================================================
-- 驗證資料
-- =====================================================

-- 查看所有資料
SELECT 'basic_data' as table_name, COUNT(*) as count FROM basic_data
UNION ALL
SELECT 'event_main', COUNT(*) FROM event_main
UNION ALL
SELECT 'location_main', COUNT(*) FROM location_main;