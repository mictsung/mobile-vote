-- =====================================================
-- 投票系統初始化資料 SQL 腳本
-- 建立日期: 2026-04-29
-- 功能: 初始化 basic_data, event_main, location_main 表格資料
-- =====================================================

-- =====================================================
-- 清空現有資料（可選，如果想重新開始）
-- =====================================================
-- 取消下面三行的註釋以清空資料
-- DELETE FROM basic_data;
-- DELETE FROM event_main;
-- DELETE FROM location_main;

-- =====================================================
-- 1. 基礎資料表 (basic_data)
-- =====================================================
-- 清空現有記錄
TRUNCATE TABLE basic_data;

-- 插入基礎資料
INSERT INTO basic_data (title_name, important_info) 
VALUES 
  ('手機地圖投票系統', '歡迎參與投票活動！');

-- =====================================================
-- 2. 活動主檔 (event_main)
-- =====================================================
-- 清空現有記錄
TRUNCATE TABLE event_main;

-- 插入活動資料
INSERT INTO event_main (event_id, event_name, event_type, event_date, event_time, voting_due) 
VALUES 
  ('event_001', 'GO FEST 2026 - Day 1', 'festival', '2026-07-11', '09:00:00', '2026-07-10 23:59:59+08'),
  ('event_002', 'GO FEST 2026 - Day 2', 'festival', '2026-07-12', '09:00:00', '2026-07-11 23:59:59+08'),
  ('event_003', '寶可夢見面會 - 台北', 'meetup', '2026-08-15', '14:00:00', '2026-08-14 23:59:59+08'),
  ('event_004', '寶可夢見面會 - 台中', 'meetup', '2026-08-22', '14:00:00', '2026-08-21 23:59:59+08'),
  ('event_005', '寶可夢見面會 - 高雄', 'meetup', '2026-08-29', '14:00:00', '2026-08-28 23:59:59+08');

-- =====================================================
-- 3. 地點主檔 (location_main)
-- =====================================================
-- 清空現有記錄
TRUNCATE TABLE location_main;

-- 插入地點資訊
INSERT INTO location_main (location_id, location_name, location_type, longitude, latitude) 
VALUES
  -- GO FEST 主要地點
  ('loc_001', '台北信義區 - 台北101', 'venue', 121.5645, 25.0330),
  ('loc_002', '台中中山公園', 'park', 120.6500, 24.1351),
  ('loc_003', '高雄夢時代', 'venue', 120.3011, 22.5950),
  
  -- 備選地點
  ('loc_004', '台北大安森林公園', 'park', 121.5330, 25.0267),
  ('loc_005', '台中勤美誠品', 'venue', 120.6458, 24.1511),
  ('loc_006', '台北華山 1914 文創園區', 'venue', 121.5300, 25.0330),
  ('loc_007', '新竹鬼怪村', 'park', 120.8100, 24.8000),
  ('loc_008', '宜蘭羅東夜市', 'venue', 121.7700, 24.6800);

-- =====================================================
-- 驗證資料（執行完上述插入後執行這些查詢）
-- =====================================================

-- 查看基礎資料
-- SELECT * FROM basic_data;

-- 查看活動資料（按日期排序）
-- SELECT event_id, event_name, event_type, event_date, event_time, voting_due 
-- FROM event_main 
-- ORDER BY event_date;

-- 查看地點資料（按名稱排序）
-- SELECT location_id, location_name, location_type, latitude, longitude 
-- FROM location_main 
-- ORDER BY location_name;

-- 統計各表資料數
-- SELECT 'basic_data' as table_name, COUNT(*) as row_count FROM basic_data
-- UNION ALL
-- SELECT 'event_main', COUNT(*) FROM event_main
-- UNION ALL
-- SELECT 'location_main', COUNT(*) FROM location_main;
