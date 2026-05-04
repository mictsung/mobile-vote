-- =============================================================================
-- basic_data migration
-- 目標：
-- 1) 新增 active 欄位（BOOLEAN）
-- 2) 同時間僅允許 1 筆 active = true
-- 3) 與 server.js「優先抓 active=true」邏輯對齊
--
-- 使用方式：
-- - Supabase SQL Editor 貼上整段執行
-- =============================================================================

BEGIN;

-- 1) 補 active 欄位
ALTER TABLE public.basic_data
  ADD COLUMN IF NOT EXISTS active BOOLEAN;

-- 2) 先把 NULL 補成 false，避免後續索引/判斷異常
UPDATE public.basic_data
SET active = false
WHERE active IS NULL;

-- 3) 若目前沒有任何 active=true，則把最新一筆設為 true
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.basic_data WHERE active = true
  ) THEN
    UPDATE public.basic_data
    SET active = true
    WHERE ctid IN (
      SELECT ctid
      FROM public.basic_data
      ORDER BY ctid DESC
      LIMIT 1
    );
  END IF;
END $$;

-- 4) 若有多筆 active=true，保留 1 筆，其餘改為 false
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (ORDER BY ctid DESC) AS rn
  FROM public.basic_data
  WHERE active = true
)
UPDATE public.basic_data b
SET active = false
FROM ranked r
WHERE b.ctid = r.ctid
  AND r.rn > 1;

-- 5) 建立「僅 1 筆 active=true」唯一條件索引
CREATE UNIQUE INDEX IF NOT EXISTS basic_data_single_active_true_uidx
  ON public.basic_data ((active))
  WHERE active = true;

COMMIT;

