const path = require('path');
const ENV_PATH = path.join(__dirname, '.env');
const ENV_LOCAL_PATH = path.join(__dirname, '.env.local');
require('dotenv').config({ path: ENV_PATH });
require('dotenv').config({ path: ENV_LOCAL_PATH, override: true });
const express = require('express');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/** 移除 BOM／頭尾空白，避免 .env 貼上後金鑰讀不到。不含金鑰內容。 */
function trimEnv(value) {
  if (value == null) return '';
  let s = String(value).replace(/^\ufeff/, '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function sanitizeBasicText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>"'`;\\]/g, '')
    .trim()
    .slice(0, maxLen);
}

function normalizeUserOrigin(countyValue, districtValue, locationValue) {
  const city = sanitizeBasicText(countyValue, 20);
  const location = sanitizeBasicText(districtValue, 30);
  const fallbackLocation = sanitizeBasicText(locationValue, 80);
  if (!city) return { city: '', location: '', userLocation: '' };
  if (city === '國外') return { city: '國外', location: '', userLocation: '國外' };
  const finalLocation = location || sanitizeBasicText(fallbackLocation.replace(city, ''), 30);
  return {
    city,
    location: finalLocation,
    userLocation: finalLocation ? `${city}${finalLocation}` : city
  };
}

// Supabase 連線設定（後台 Node 建議使用 service_role，否則在 Supabase 開啟 RLS 時寫入會失敗）
const supabaseUrl = trimEnv(process.env.SUPABASE_URL);
const supabaseServiceRoleKey = trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnonKey = trimEnv(process.env.SUPABASE_ANON_KEY);
const supabaseKey = supabaseServiceRoleKey || supabaseAnonKey;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 缺少 Supabase 環境變數，請檢查 .env 檔案（需 SUPABASE_URL 及 SUPABASE_ANON_KEY 或 SUPABASE_SERVICE_ROLE_KEY）');
  process.exit(1);
}

console.info('[env]', ENV_PATH, fs.existsSync(ENV_PATH) ? '（檔案存在，已載入）' : '（檔案不存在）');
console.info('[env.local]', ENV_LOCAL_PATH, fs.existsSync(ENV_LOCAL_PATH) ? '（存在，並覆寫同名變數）' : '（無檔）');

if (!supabaseServiceRoleKey) {
  console.warn('⚠️ 未設定 SUPABASE_SERVICE_ROLE_KEY：資料表若啟用 RLS，匿名金鑰的寫入可能被擋（例如投票插入 voting_info）。請於 Supabase 專案 Settings → API 複製 service_role 並寫入上述 .env 路徑（僅放伺服器，勿提交或用於前端）。');
  console.warn('   或在不使用 service_role 的前提下，於 Supabase SQL Editor 執行 scripts/disable-rls-for-server.sql（內為 ALTER TABLE … DISABLE ROW LEVEL SECURITY）。詳見該檔案開頭說明。');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/** 設為 `1` 時，vote-error Socket 會帶 details（僅開發／除錯用，勿在公開環境常開）。 */
const showVoteErrorDetails = process.env.SHOW_VOTE_ERROR_DETAILS === '1';

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice('Bearer '.length).trim();
}

async function authenticateAdmin(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: '缺少登入憑證，請重新登入。' });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user?.id) {
      return res.status(401).json({ success: false, message: '登入憑證無效或已過期。' });
    }

    const userId = authData.user.id;
    const { data: roleRow, error: roleError } = await supabase
      .from('user_roles')
      .select('role_id')
      .eq('user_id', userId)
      .eq('role_id', 'admin')
      .limit(1)
      .maybeSingle();

    if (roleError) {
      console.error('❌ 驗證 admin 角色失敗:', roleError);
      return res.status(500).json({ success: false, message: '權限驗證失敗。' });
    }
    if (!roleRow) {
      return res.status(403).json({ success: false, message: '您沒有後台操作權限。' });
    }

    req.adminUser = authData.user;
    return next();
  } catch (error) {
    console.error('❌ 驗證 admin 身分失敗:', error);
    return res.status(500).json({ success: false, message: '權限驗證失敗。' });
  }
}

// 全域資料快取
let appData = {
  basic: {
    title: '',
    importantInfo: '',
    info: ''
  },
  currentEvent: null,
  activeVotingEvent: null,
  openVotingEvents: [],
  locations: {},
  voteStats: {},
  events: [],
  awardConditions: [],
  locationTypes: [],
  meetups: []
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 資料庫初始化函數
async function initializeDatabase() {
  try {
    console.log('🔄 初始化資料庫連線...');

    // 載入基礎資料（優先 active=true；若欄位不存在則回退）
    let basicDataArray = null;
    let basicError = null;

    const activeBasicResult = await supabase
      .from('basic_data')
      .select('*')
      .eq('active', true)
      .limit(1);

    if (activeBasicResult.error) {
      const fallbackBasicResult = await supabase
        .from('basic_data')
        .select('*')
        .limit(1);
      basicDataArray = fallbackBasicResult.data;
      basicError = fallbackBasicResult.error;
    } else {
      basicDataArray = activeBasicResult.data;
      basicError = null;
    }

    if (basicError) {
      console.error('❌ 載入基礎資料失敗:', basicError);
      // 使用預設值
      appData.basic = { title: '', importantInfo: '', info: '' };
    } else if (basicDataArray && basicDataArray.length > 0) {
      const basicData = basicDataArray[0];
      const infoValue = basicData.info || basicData.important_info || '';
      appData.basic = {
        title: basicData.title_name || '',
        importantInfo: infoValue,
        info: infoValue
      };
      console.log('✅ 基礎資料載入完成');
    } else {
      console.warn('⚠️ 基礎資料表為空，使用預設值');
      appData.basic = { title: '', importantInfo: '', info: '' };
    }

    // 載入活動資料
    const { data: eventsData, error: eventsError } = await supabase
      .from('event_main')
      .select('*')
      .order('event_date', { ascending: false });

    if (eventsError) {
      console.error('❌ 載入活動資料失敗:', eventsError);
    } else {
      appData.events = eventsData;
      console.log('✅ 活動資料載入完成，總共', eventsData.length, '個活動');
    }

    // 載入 voting_event 資料
    const { data: votingEventsData, error: votingEventsError } = await supabase
      .from('voting_event')
      .select('*');

    if (votingEventsError) {
      console.error('❌ 載入 voting_event 資料失敗:', votingEventsError);
      appData.votingEvents = [];
    } else {
      appData.votingEvents = votingEventsData || [];
      enrichVotingEvents();
      console.log('✅ voting_event 資料載入完成，總共', appData.votingEvents.length, '筆');
    }

    // 將 voting_event 資料合併到 event_main
    const votingEventById = (appData.votingEvents || []).reduce((acc, item) => {
      acc[item.event_id] = item;
      return acc;
    }, {});

    appData.events = appData.events.map((event) => {
      const votingEvent = votingEventById[event.event_id];
      return {
        ...event,
        voting_id: votingEvent?.voting_id || null,
        voting_active: votingEvent?.active ?? false,
        selected_locations: [
          votingEvent?.voting_loc_1 || '',
          votingEvent?.voting_loc_2 || '',
          votingEvent?.voting_loc_3 || ''
        ],
        selected_awards: [
          votingEvent?.voting_condition_1 || '',
          votingEvent?.voting_condition_2 || '',
          votingEvent?.voting_condition_3 || ''
        ]
      };
    });

    // 載入地點資料
    const { data: locationsData, error: locationsError } = await supabase
      .from('location_main')
      .select('*');

    if (locationsError) {
      console.error('❌ 載入地點資料失敗:', locationsError);
    } else {
      appData.locations = {};
      locationsData.forEach(location => {
        appData.locations[location.location_id] = {
          id: location.location_id,
          name: location.location_name,
          type: location.location_type,
          lat: parseFloat(location.longitude), // longitude 欄位實際上是緯度
          lng: parseFloat(location.latitude)  // latitude 欄位實際上是經度
        };
      });
      console.log('✅ 地點資料載入完成');
    }

    // 載入獎勵條件
    const { data: awardConditionsData, error: awardConditionsError } = await supabase
      .from('award_condition')
      .select('*');

    if (awardConditionsError) {
      console.error('❌ 載入獎勵條件失敗:', awardConditionsError);
    } else {
      appData.awardConditions = awardConditionsData;
      console.log('✅ 獎勵條件載入完成');
    }

    // 載入地點類型設定
    const { data: locationTypesData, error: locationTypesError } = await supabase
      .from('main_setting')
      .select('setting_value, setting_type')
      .in('setting_type', ['location_type', 'loction_type']);

    if (locationTypesError) {
      console.error('❌ 載入地點類型設定失敗:', locationTypesError);
      appData.locationTypes = [];
    } else {
      appData.locationTypes = (locationTypesData || [])
        .map((item) => item.setting_value)
        .filter((value) => value && value.trim().length > 0);
      console.log('✅ 地點類型載入完成');
    }

    // 依 voting_event(active、未過期) 決定目前活動並載入統計
    console.log('🔄 載入進行中之投票上下文…');
    await pickCurrentVotingContext();

    // 載入見面會資料
    const { data: meetupsData, error: meetupsError } = await supabase
      .from('meetup_event')
      .select('*');

    if (meetupsError) {
      console.error('❌ 載入見面會資料失敗:', meetupsError);
    } else {
      appData.meetups = meetupsData;
      console.log('✅ 見面會資料載入完成');
    }

  } catch (error) {
    console.error('❌ 資料庫初始化失敗:', error);
  }
}

function buildVotingEventView(votingEvent) {
  const eventMainRow = (appData.events || []).find((e) => e.event_id === votingEvent.event_id);
  const dueRaw = votingEvent.voting_due || votingEvent.voting_due_time;
  const locationIds = [votingEvent.voting_loc_1, votingEvent.voting_loc_2, votingEvent.voting_loc_3].filter(Boolean);
  const awardIds = [votingEvent.voting_condition_1, votingEvent.voting_condition_2, votingEvent.voting_condition_3].filter(Boolean);

  return {
    voting_id: votingEvent.voting_id,
    event_id: votingEvent.event_id,
    event_name: eventMainRow?.event_name || votingEvent.event_name || votingEvent.event_id,
    event_date: eventMainRow?.event_date || votingEvent.event_date || null,
    event_time: eventMainRow?.event_time || votingEvent.event_time || '',
    voting_due: dueRaw,
    locations: locationIds.map((locationId, index) => {
      const location = appData.locations[locationId] || {};
      return {
        id: locationId,
        name: location.name || `未知地點 (${locationId})`,
        type: location.type || null,
        lat: location.lat || null,
        lng: location.lng || null,
        order: index + 1
      };
    }),
    awards: awardIds.map((awardId, index) => {
      const awardItem = appData.awardConditions.find((item) => item.condition_id === awardId);
      return {
        id: awardId,
        description: awardItem?.condition_desc || `獎勵條件 (${awardId})`,
        order: index + 1
      };
    })
  };
}

// 載入投票活動設定
async function loadActiveVotingEvent(eventId) {
  if (!eventId) {
    console.warn('⚠️ 未提供 eventId，無法載入投票活動設定');
    appData.activeVotingEvent = null;
    return;
  }

  try {
    const { data: votingEventData, error } = await supabase
      .from('voting_event')
      .select('*')
      .eq('event_id', eventId)
      .eq('active', true)
      .limit(1);

    if (error) {
      console.error('❌ 查詢 voting_event 失敗:', error);
      appData.activeVotingEvent = null;
      return;
    }

    if (!votingEventData || votingEventData.length === 0) {
      console.warn('⚠️ 在 voting_event 表中找不到 event_id =', eventId, '的記錄');
      appData.activeVotingEvent = null;
      return;
    }

    appData.activeVotingEvent = buildVotingEventView(votingEventData[0]);
    console.log('✅ 投票活動設定載入完成:', appData.activeVotingEvent.voting_id);
  } catch (error) {
    console.error('❌ 載入投票活動設定失敗:', error);
    appData.activeVotingEvent = null;
  }
}


// 載入投票統計
function enrichVotingEvents() {
  const eventById = (appData.events || []).reduce((acc, event) => {
    acc[event.event_id] = event;
    return acc;
  }, {});

  appData.votingEvents = (appData.votingEvents || []).map((voteEvent) => {
    const event = eventById[voteEvent.event_id] || {};
    return {
      ...voteEvent,
      event_name: event.event_name || voteEvent.event_id,
      event_type: event.event_type || voteEvent.event_type || '',
      event_date: event.event_date || voteEvent.event_date || '',
      event_time: event.event_time || voteEvent.event_time || '',
      voting_due: voteEvent.voting_due || voteEvent.voting_due_time || '', // 處理 voting_due 或 voting_due_time
      voting_active: voteEvent.active ?? false,
      selected_locations: [
        voteEvent.voting_loc_1 || '',
        voteEvent.voting_loc_2 || '',
        voteEvent.voting_loc_3 || ''
      ],
      selected_awards: [
        voteEvent.voting_condition_1 || '',
        voteEvent.voting_condition_2 || '',
        voteEvent.voting_condition_3 || ''
      ]
    };
  });
}

async function fetchVoteStats(eventId, votingId = null) {
  const voteStats = {};
  let query = supabase
    .from('voting_info')
    .select('voting_location, voting_award')
    .eq('event_id', eventId);

  if (votingId != null && votingId !== '') {
    query = query.eq('voting_id', votingId);
  }

  const { data: votingData, error } = await query;
  if (error) {
    throw error;
  }

  (votingData || []).forEach((vote) => {
    if (!voteStats[vote.voting_location]) {
      voteStats[vote.voting_location] = { count: 0, awards: {} };
    }
    voteStats[vote.voting_location].count++;
    if (vote.voting_award) {
      voteStats[vote.voting_location].awards[vote.voting_award] =
        (voteStats[vote.voting_location].awards[vote.voting_award] || 0) + 1;
    }
  });
  return voteStats;
}

async function loadVoteStats(eventId, votingId = null) {
  try {
    appData.voteStats = await fetchVoteStats(eventId, votingId);
    console.log('✅ 投票統計載入完成');
  } catch (error) {
    console.error('❌ 載入投票統計失敗:', error);
    appData.voteStats = {};
  }
}

function getVotingDeadline(ve) {
  if (!ve) return null;
  return ve.voting_due || ve.voting_due_time || null;
}

function isVotingEventOpen(ve, now) {
  if (ve == null) return false;
  const activeOk = ve.active === true || ve.active === 'true' || ve.active === 1;
  if (!activeOk) return false;
  const due = getVotingDeadline(ve);
  if (!due) return false;
  const t = new Date(due);
  if (Number.isNaN(t.getTime())) return false;
  return t > now;
}

async function refreshOpenVotingEvents(limit = 3) {
  const now = new Date();
  const candidates = (appData.votingEvents || []).filter((ve) => isVotingEventOpen(ve, now));
  candidates.sort((a, b) => {
    const ta = new Date(getVotingDeadline(a)).getTime();
    const tb = new Date(getVotingDeadline(b)).getTime();
    return ta - tb;
  });

  const top = candidates.slice(0, limit);
  const mapped = await Promise.all(top.map(async (item) => {
    const view = buildVotingEventView(item);
    let stats = {};
    try {
      stats = await fetchVoteStats(view.event_id, view.voting_id);
    } catch (error) {
      console.error('⚠️ 載入 openVotingEvents 統計失敗:', error);
    }
    return { ...view, voteStats: stats };
  }));
  appData.openVotingEvents = mapped;
}

/** 優先：voting_event.active 且截止（voting_due / voting_due_time）未到；否則沿用 event_main 邏輯。 */
async function pickCurrentVotingContext() {
  await refreshOpenVotingEvents(3);
  const now = new Date();

  if (appData.openVotingEvents.length > 0) {
    const chosen = appData.openVotingEvents[0];
    const due = chosen.voting_due;
    const evMain = (appData.events || []).find((e) => e.event_id === chosen.event_id);
    appData.currentEvent = evMain || {
      event_id: chosen.event_id,
      event_name: chosen.event_name || chosen.event_id,
      event_date: chosen.event_date || null,
      event_time: chosen.event_time || '',
      voting_due: due
    };
    appData.activeVotingEvent = { ...chosen };
    appData.voteStats = { ...(chosen.voteStats || {}) };
    console.log('✅ 目前投票：voting_id', chosen.voting_id, 'event_id', chosen.event_id, '截止', due);
    return;
  }

  const activeEvent = (appData.events || []).find(
    (event) => event.voting_due && new Date(event.voting_due) > now
  );

  if (activeEvent) {
    appData.currentEvent = activeEvent;
    console.log('⚠️ 無符合的進行中 voting_event，改以 event_main 截止日選活動:', activeEvent.event_id);
    await loadVoteStats(activeEvent.event_id, activeEvent.voting_id || null);
    await loadActiveVotingEvent(activeEvent.event_id);
    return;
  }

  if (appData.events && appData.events.length > 0) {
    const sortedEvents = [...appData.events].sort((a, b) => {
      const ta = new Date(a.voting_due || 0).getTime();
      const tb = new Date(b.voting_due || 0).getTime();
      return Math.abs(ta - now.getTime()) - Math.abs(tb - now.getTime());
    });
    appData.currentEvent = sortedEvents[0];
    console.log('⚠️ 無進行中票選，使用最近活動:', sortedEvents[0].event_id);
    await loadVoteStats(sortedEvents[0].event_id, sortedEvents[0].voting_id || null);
    await loadActiveVotingEvent(sortedEvents[0].event_id);
    return;
  }

  appData.currentEvent = null;
  appData.activeVotingEvent = null;
  appData.openVotingEvents = [];
  appData.voteStats = {};
  console.warn('⚠️ 沒有任何活動資料');
}

async function getNextSerialNo(eventId) {
  if (!eventId) {
    return 1;
  }

  try {
    const { data, error } = await supabase
      .from('voting_info')
      .select('serial_no')
      .eq('event_id', eventId)
      .order('serial_no', { ascending: false })
      .limit(1);

    if (error) {
      console.error('❌ 讀取 serial_no 失敗:', error);
      return 1;
    }

    if (!data || data.length === 0 || data[0].serial_no == null) {
      return 1;
    }

    const lastSerial = parseInt(data[0].serial_no, 10);
    return Number.isNaN(lastSerial) ? 1 : lastSerial + 1;
  } catch (error) {
    console.error('❌ 取得下一個 serial_no 失敗:', error);
    return 1;
  }
}

async function upsertUserInfo(userName, userGameId, city, location) {
  if (!userName || !userGameId || !city) return;
  try {
    const { data: existing, error: existingError } = await supabase
      .from('user_info')
      .select('user_name, user_game_id, city, location')
      .eq('user_name', userName)
      .eq('user_game_id', userGameId)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('⚠️ 查詢 user_info 失敗（不影響投票）:', existingError);
      return;
    }

    if (existing) {
      const citySame = (existing.city || '') === city;
      const locationSame = (existing.location || '') === location;
      if (citySame && locationSame) {
        return;
      }

      const { error: updateError } = await supabase
        .from('user_info')
        .update({ city, location })
        .eq('user_name', userName)
        .eq('user_game_id', userGameId);

      if (updateError) {
        console.error('⚠️ 更新 user_info 城市/行政區失敗（不影響投票）:', updateError);
      }
      return;
    }

    const { error: insertError } = await supabase
      .from('user_info')
      .insert({
        user_name: userName,
        user_game_id: userGameId,
        city,
        location
      });

    if (insertError) {
      console.error('⚠️ 新增 user_info 失敗（不影響投票）:', insertError);
    }
  } catch (error) {
    console.error('⚠️ user_info 更新例外（不影響投票）:', error);
  }
}

async function getNextAwardFeedbackId() {
  try {
    const { data, error } = await supabase
      .from('award_feedback')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return 1;
    }

    const lastRaw = String(data[0].id ?? '').trim();
    const lastNumber = parseInt(lastRaw.replace(/\D+/g, ''), 10);
    return Number.isNaN(lastNumber) ? 1 : lastNumber + 1;
  } catch (error) {
    console.error('⚠️ 取得 award_feedback id 失敗（不影響投票）:', error);
    return 1;
  }
}

async function addAwardFeedbackToDB(userName, userGameId, feedbackAward, city, location) {
  const safeFeedback = sanitizeBasicText(feedbackAward, 50);
  if (!safeFeedback) return;

  try {
    const nextId = await getNextAwardFeedbackId();
    const nowIso = new Date().toISOString();
    const payload = {
      id: nextId,
      user_name: userName,
      user_id: userGameId,
      feedback_award: safeFeedback,
      date: nowIso,
      status: 'normal',
      city,
      location
    };

    const { error } = await supabase
      .from('award_feedback')
      .insert(payload);

    if (!error) return;

    // 相容舊欄位命名，避免既有資料庫結構造成投票流程中斷
    const legacyPayload = {
      feedback_id: String(nextId),
      feedback_user: userName,
      feedback_award: safeFeedback,
      feedback_date: nowIso.slice(0, 10),
      feedback_status: 'normal'
    };
    const { error: legacyError } = await supabase
      .from('award_feedback')
      .insert(legacyPayload);

    if (legacyError) {
      console.error('⚠️ 新增 award_feedback 失敗（不影響投票）:', legacyError);
    }
  } catch (error) {
    console.error('⚠️ 新增 award_feedback 例外（不影響投票）:', error);
  }
}

async function addVoteToDB(eventId, userName, locationId, awardId = null, userGameId = '', userCity = '', userDistrict = '', votingIdOverride = null, feedbackAward = '') {
  try {
    const votingId = votingIdOverride || appData.activeVotingEvent?.voting_id || null;
    const votingDateTime = new Date().toISOString();
    const nextSerialNo = await getNextSerialNo(eventId);

    let insertError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const serialNo = nextSerialNo + attempt;
      const { error } = await supabase
        .from('voting_info')
        .insert({
          event_id: eventId,
          voting_id: votingId,
          serial_no: serialNo,
          user_name: userName,
          voting_location: locationId,
          voting_award: awardId,
          voting_datetime: votingDateTime
        });
      if (!error) {
        insertError = null;
        break;
      }
      insertError = error;
      const duplicatedSerial = error.code === '23505'
        && String(error.message || '').includes('voting_info')
        && String(error.details || '').includes('serial_no');
      if (!duplicatedSerial) {
        break;
      }
    }

    if (insertError) {
      console.error('❌ 新增投票失敗:', insertError);
      return {
        ok: false,
        dbCode: insertError.code ?? null,
        dbMessage: insertError.message != null ? String(insertError.message) : null,
        dbHint: insertError.hint != null ? String(insertError.hint) : null
      };
    }

    // 重新載入投票統計（同一 voting_id 才不會混到舊场次）
    await loadVoteStats(eventId, votingId);
    await refreshOpenVotingEvents(3);
    await upsertUserInfo(userName, userGameId, userCity, userDistrict);
    await addAwardFeedbackToDB(userName, userGameId, feedbackAward, userCity, userDistrict);
    return { ok: true };
  } catch (error) {
    console.error('❌ 投票資料庫錯誤:', error);
    const msg = error && error.message ? String(error.message) : String(error);
    return { ok: false, dbCode: 'exception', dbMessage: msg };
  }
}

// 更新地點到資料庫
async function updateLocationInDB(locationId, name, type, lat, lng) {
  try {
    const { error } = await supabase
      .from('location_main')
      .upsert({
        location_id: locationId,
        location_name: name,
        location_type: type,
        latitude: lng,  // 經度
        longitude: lat  // 緯度
    });

    if (error) {
      console.error('❌ 更新地點資料失敗:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('❌ 地點資料庫更新錯誤:', error);
    return false;
  }
}

// 更新活動到資料庫
async function updateEventInDB(eventId, name, type, date, time, votingDue) {
  try {
    const { error } = await supabase
      .from('event_main')
      .upsert({
        event_id: eventId,
        event_name: name,
        event_type: type,
        event_date: date,
        event_time: time,
        voting_due: votingDue
      });

    if (error) {
      console.error('❌ 更新活動資料失敗:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('❌ 活動資料庫更新錯誤:', error);
    return false;
  }
}

// 產生下一個 voting_id
async function generateVotingId() {
  try {
    const { data, error } = await supabase
      .from('voting_event')
      .select('voting_id')
      .order('voting_id', { ascending: false })
      .limit(1);

    if (error) {
      console.error('❌ 讀取 voting_id 失敗:', error);
      return 'voting_001';
    }

    if (!data || data.length === 0) {
      return 'voting_001';
    }

    const lastId = data[0].voting_id || 'voting_000';
    const suffix = parseInt(lastId.slice(7), 10) || 0;
    return `voting_${String(suffix + 1).padStart(3, '0')}`;
  } catch (error) {
    console.error('❌ 產生 voting_id 失敗:', error);
    return 'voting_001';
  }
}

// 新增或更新 voting_event
async function upsertVotingEvent(eventId, votingDue, selectedLocations, selectedAwards) {
  if (!Array.isArray(selectedLocations) || selectedLocations.length !== 3 || !Array.isArray(selectedAwards) || selectedAwards.length !== 3) {
    console.error('❌ selectedLocations 或 selectedAwards 格式錯誤');
    return false;
  }

  try {
    const { data: existing, error: existingError } = await supabase
      .from('voting_event')
      .select('voting_id')
      .eq('event_id', eventId)
      .limit(1);

    if (existingError) {
      console.error('❌ 查詢 voting_event 失敗:', existingError);
      return false;
    }

    const votingId = existing && existing.length > 0
      ? existing[0].voting_id
      : await generateVotingId();

    const { error } = await supabase
      .from('voting_event')
      .upsert({
        voting_id: votingId,
        event_id: eventId,
        voting_loc_1: selectedLocations[0],
        voting_loc_2: selectedLocations[1],
        voting_loc_3: selectedLocations[2],
        voting_condition_1: selectedAwards[0],
        voting_condition_2: selectedAwards[1],
        voting_condition_3: selectedAwards[2],
        voting_due: votingDue,
        active: true
      }, { onConflict: 'voting_id' });

    if (error) {
      console.error('❌ 新增或更新 voting_event 失敗:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ voting_event 資料庫錯誤:', error);
    return false;
  }
}

app.get('/api/auth-config', (req, res) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      success: false,
      message: '缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，無法初始化登入。'
    });
  }
  return res.json({
    success: true,
    supabaseUrl,
    supabaseAnonKey
  });
});

app.get('/api/admin/me', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.adminUser.id,
      email: req.adminUser.email || ''
    }
  });
});

async function ensureAppDataLoaded() {
  if (Object.keys(appData.locations).length === 0 || appData.awardConditions.length === 0 || appData.events.length === 0) {
    await initializeDatabase();
  }
}

async function loadVoteRecords(limit = 300) {
  const { data: votingRows, error: votingError } = await supabase
    .from('voting_info')
    .select('*')
    .order('voting_datetime', { ascending: false })
    .limit(limit);

  if (votingError) {
    console.error('❌ 載入投票紀錄失敗:', votingError);
    return [];
  }

  const { data: usersRows, error: usersError } = await supabase
    .from('user_info')
    .select('user_name, user_game_id, city, location');

  if (usersError) {
    console.error('❌ 載入 user_info 失敗:', usersError);
  }

  const userByName = (usersRows || []).reduce((acc, row) => {
    acc[row.user_name] = row;
    return acc;
  }, {});

  const locationById = appData.locations || {};
  const awardById = (appData.awardConditions || []).reduce((acc, item) => {
    acc[item.condition_id] = item.condition_desc;
    return acc;
  }, {});
  const eventById = (appData.events || []).reduce((acc, item) => {
    acc[item.event_id] = item.event_name;
    return acc;
  }, {});

  return (votingRows || []).map((row) => {
    const user = userByName[row.user_name] || {};
    const userLocation = user.city
      ? `${user.city}${user.location || ''}`
      : '';
    return {
      serialNo: row.serial_no,
      eventId: row.event_id || '',
      eventName: eventById[row.event_id] || row.event_id || '',
      votingId: row.voting_id || '',
      userName: row.user_name || '',
      userGameId: user.user_game_id || '',
      userCity: user.city || '',
      userDistrict: user.location || '',
      userLocation,
      votingLocationId: row.voting_location || '',
      votingLocationName: locationById[row.voting_location]?.name || row.voting_location || '',
      votingAwardId: row.voting_award || '',
      votingAwardDesc: awardById[row.voting_award] || row.voting_award || '',
      votingDatetime: row.voting_datetime || row.voting_date || ''
    };
  });
}

// 取得應用程式資料 API
app.get('/api/app-data', async (req, res) => {
  await ensureAppDataLoaded();
  res.json({
    basic: appData.basic,
    currentEvent: appData.currentEvent,
    activeVotingEvent: appData.activeVotingEvent,
    openVotingEvents: appData.openVotingEvents,
    locations: appData.locations,
    voteStats: appData.voteStats,
    events: appData.events,
    awardConditions: appData.awardConditions,
    locationTypes: appData.locationTypes
  });
});

// 取得獎勵條件 API
app.get('/api/award-conditions', async (req, res) => {
  await ensureAppDataLoaded();
  res.json(appData.awardConditions);
});

// 取得地點資料 API
app.get('/api/locations', async (req, res) => {
  await ensureAppDataLoaded();
  res.json(appData.locations);
});

// 取得投票統計 API
app.get('/api/vote-stats', (req, res) => {
  res.json(appData.voteStats);
});

// 取得活動列表 API
app.get('/api/events', (req, res) => {
  res.json(appData.events);
});

// 取得 voting_event 列表 API
app.get('/api/voting-events', authenticateAdmin, async (req, res) => {
  await ensureAppDataLoaded();
  res.json(appData.votingEvents || []);
});

app.get('/api/vote-records', authenticateAdmin, async (req, res) => {
  await ensureAppDataLoaded();
  const rows = await loadVoteRecords(500);
  res.json(rows);
});

// 更新地點 API
app.post('/api/locations/:locationId', authenticateAdmin, async (req, res) => {
  const { locationId } = req.params;
  const { name, type, lat, lng } = req.body;

  const success = await updateLocationInDB(locationId, name, type, lat, lng);
  if (success) {
    // 重新載入地點資料
    const { data: locationsData } = await supabase
      .from('location_main')
      .select('*');

    if (locationsData) {
      appData.locations = {};
      locationsData.forEach(location => {
        appData.locations[location.location_id] = {
          id: location.location_id,
          name: location.location_name,
          type: location.location_type,
          lat: parseFloat(location.longitude), // longitude 欄位實際上是緯度
          lng: parseFloat(location.latitude)  // latitude 欄位實際上是經度
        };
      });
    }

    io.emit('locations-update', appData.locations);
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false });
  }
});

// 更新活動 API
app.post('/api/events/:eventId', authenticateAdmin, async (req, res) => {
  const { eventId } = req.params;
  const { name, type, date, time, votingDue, selectedLocations, selectedAwards } = req.body;

  console.log('Event save request:', { eventId, name, type, date, time, votingDue, selectedLocations, selectedAwards });

  const eventSaved = await updateEventInDB(eventId, name, type, date, time, votingDue);
  if (!eventSaved) {
    console.error('Event update failed');
    return res.status(500).json({ success: false, message: '無法儲存活動資料' });
  }

  let votingEventSaved = true;
  if (selectedLocations && selectedAwards) {
    votingEventSaved = await upsertVotingEvent(eventId, votingDue, selectedLocations, selectedAwards);
  }

  if (!votingEventSaved) {
    console.error('Voting event upsert failed');
    return res.status(500).json({ success: false, message: '無法儲存投票活動設定' });
  }

  // 重新載入活動資料
  const { data: eventsData, error: eventsError } = await supabase
    .from('event_main')
    .select('*')
    .order('event_date', { ascending: false });

  if (eventsError) {
    console.error('Reload events error:', eventsError);
  }

  if (eventsData) {
    appData.events = eventsData;

    const votingEventsResult = await supabase
      .from('voting_event')
      .select('*');

    if (votingEventsResult.data) {
      appData.votingEvents = votingEventsResult.data;
      enrichVotingEvents();
      const votingEventById = appData.votingEvents.reduce((acc, item) => {
        acc[item.event_id] = item;
        return acc;
      }, {});
      appData.events = appData.events.map((event) => {
        const votingEvent = votingEventById[event.event_id];
        return {
          ...event,
          voting_id: votingEvent?.voting_id || null,
          voting_active: votingEvent?.active ?? false,
          selected_locations: [
            votingEvent?.voting_loc_1 || '',
            votingEvent?.voting_loc_2 || '',
            votingEvent?.voting_loc_3 || ''
          ],
          selected_awards: [
            votingEvent?.voting_condition_1 || '',
            votingEvent?.voting_condition_2 || '',
            votingEvent?.voting_condition_3 || ''
          ]
        };
      });
    }

    await pickCurrentVotingContext();
  }

  io.emit('event-update', appData.currentEvent);
  io.emit('app-data-update', {
    basic: appData.basic,
    currentEvent: appData.currentEvent,
    activeVotingEvent: appData.activeVotingEvent,
    openVotingEvents: appData.openVotingEvents,
    locations: appData.locations,
    voteStats: appData.voteStats
  });
  io.emit('vote-stats-update', {
    eventId: appData.activeVotingEvent?.event_id || null,
    votingId: appData.activeVotingEvent?.voting_id || null,
    stats: appData.voteStats
  });
  res.json({ success: true });
});

// 停用 voting_event (軟刪除)
app.post('/api/voting-event/:eventId/deactivate', authenticateAdmin, async (req, res) => {
  const { eventId } = req.params;

  try {
    const { error } = await supabase
      .from('voting_event')
      .update({ active: false })
      .eq('event_id', eventId);

    if (error) {
      console.error('❌ 停用 voting_event 失敗:', error);
      return res.status(500).json({ success: false, message: '無法停用 voting_event' });
    }

    // 重新載入 voting_event 與相關資料
    const { data: votingEventsData, error: votingEventsError } = await supabase
      .from('voting_event')
      .select('*');

    if (votingEventsError) {
      console.error('❌ 重新載入 voting_event 失敗:', votingEventsError);
    } else {
      appData.votingEvents = votingEventsData || [];
      enrichVotingEvents();
      // 重新合併到 events
      const votingEventById = (appData.votingEvents || []).reduce((acc, item) => {
        acc[item.event_id] = item;
        return acc;
      }, {});
      appData.events = appData.events.map((event) => {
        const votingEvent = votingEventById[event.event_id];
        return {
          ...event,
          voting_id: votingEvent?.voting_id || null,
          voting_active: votingEvent?.active ?? false,
          selected_locations: [
            votingEvent?.voting_loc_1 || '',
            votingEvent?.voting_loc_2 || '',
            votingEvent?.voting_loc_3 || ''
          ],
          selected_awards: [
            votingEvent?.voting_condition_1 || '',
            votingEvent?.voting_condition_2 || '',
            votingEvent?.voting_condition_3 || ''
          ]
        };
      });
    }

    await pickCurrentVotingContext();

    io.emit('app-data-update', {
      basic: appData.basic,
      currentEvent: appData.currentEvent,
      activeVotingEvent: appData.activeVotingEvent,
      openVotingEvents: appData.openVotingEvents,
      locations: appData.locations,
      voteStats: appData.voteStats
    });
    io.emit('vote-stats-update', {
      eventId: appData.activeVotingEvent?.event_id || null,
      votingId: appData.activeVotingEvent?.voting_id || null,
      stats: appData.voteStats
    });

    res.json({ success: true });
  } catch (error) {
    console.error('❌ 停用 voting_event 資料庫錯誤:', error);
    res.status(500).json({ success: false, message: '資料庫錯誤' });
  }
});

io.on('connection', (socket) => {
  console.log('🔌 使用者已連線:', socket.id);

  socket.emit('app-data-update', {
    basic: appData.basic,
    currentEvent: appData.currentEvent,
    activeVotingEvent: appData.activeVotingEvent,
    openVotingEvents: appData.openVotingEvents,
    locations: appData.locations,
    voteStats: appData.voteStats
  });

  socket.emit('vote-stats-update', {
    eventId: appData.activeVotingEvent?.event_id || null,
    votingId: appData.activeVotingEvent?.voting_id || null,
    stats: appData.voteStats
  });

  socket.on('cast-vote', async (payload) => {
    const {
      userName,
      userGameId,
      userCounty,
      userDistrict,
      userLocation,
      feedbackAward,
      eventId,
      votingId,
      locationId,
      awardId
    } = payload || {};

    const safeUserName = sanitizeBasicText(userName, 30);
    const safeGameId = sanitizeBasicText(userGameId, 50);
    const safeLocationId = sanitizeBasicText(locationId, 60);
    const safeAwardId = sanitizeBasicText(awardId, 60);
    const safeEventId = sanitizeBasicText(eventId, 80);
    const safeVotingId = sanitizeBasicText(votingId, 80);
    const safeFeedbackAward = sanitizeBasicText(feedbackAward, 50);
    const safeUserOrigin = normalizeUserOrigin(userCounty, userDistrict, userLocation);

    if (!safeUserName || !safeLocationId || !safeAwardId || !safeUserOrigin.city) {
      socket.emit('vote-error', { message: '請輸入完整的投票資訊。' });
      return;
    }
    if (!/^[A-Za-z0-9]{1,50}$/.test(safeGameId)) {
      socket.emit('vote-error', { message: '遊戲ID格式錯誤，只能輸入英數字，最多50字。' });
      return;
    }

    if (!appData.currentEvent || !appData.currentEvent.event_id) {
      socket.emit('vote-error', { message: '目前沒有有效投票活動。' });
      return;
    }

    const targetVotingEvent = (appData.openVotingEvents || []).find((item) => (
      item.event_id === safeEventId && item.voting_id === safeVotingId
    )) || appData.activeVotingEvent;

    if (!targetVotingEvent || !targetVotingEvent.event_id || !targetVotingEvent.voting_id) {
      socket.emit('vote-error', { message: '請先選擇有效的投票活動。' });
      return;
    }

    const voteResult = await addVoteToDB(
      targetVotingEvent.event_id,
      safeUserName,
      safeLocationId,
      safeAwardId,
      safeGameId,
      safeUserOrigin.city,
      safeUserOrigin.location,
      targetVotingEvent.voting_id,
      safeFeedbackAward
    );

    if (voteResult.ok) {
      socket.emit('vote-success', { message: '投票成功！謝謝您的參與。' });
      const latestStats = (appData.openVotingEvents || []).find((item) => (
        item.event_id === targetVotingEvent.event_id && item.voting_id === targetVotingEvent.voting_id
      ))?.voteStats || appData.voteStats;
      io.emit('vote-stats-update', {
        eventId: targetVotingEvent.event_id,
        votingId: targetVotingEvent.voting_id,
        stats: latestStats
      });
      io.emit('app-data-update', {
        basic: appData.basic,
        currentEvent: appData.currentEvent,
        activeVotingEvent: appData.activeVotingEvent,
        openVotingEvents: appData.openVotingEvents,
        locations: appData.locations,
        voteStats: appData.voteStats
      });
    } else {
      const payload = { message: '投票失敗，請稍後再試。' };
      if (showVoteErrorDetails && (voteResult.dbCode || voteResult.dbMessage)) {
        payload.details = voteResult.dbCode
          ? `[${voteResult.dbCode}] ${voteResult.dbMessage || ''}`.trim()
          : voteResult.dbMessage || '';
        if (voteResult.dbHint) payload.hint = voteResult.dbHint;
      }
      socket.emit('vote-error', payload);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ 使用者已斷線:', socket.id);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Realtime voting server running on http://localhost:${port}`);
  initializeDatabase();
});
