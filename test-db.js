const path = require('path');
const ENV_PATH = path.join(__dirname, '.env');
const ENV_LOCAL_PATH = path.join(__dirname, '.env.local');
require('dotenv').config({ path: ENV_PATH });
require('dotenv').config({ path: ENV_LOCAL_PATH, override: true });

const { createClient } = require('@supabase/supabase-js');

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

const supabaseUrl = trimEnv(process.env.SUPABASE_URL);
const anonKey = trimEnv(process.env.SUPABASE_ANON_KEY);
const serviceKey = trimEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const keyForProbe = serviceKey || anonKey;

console.log('🔍 Supabase 診斷（與 server.js 相同 .env / .env.local 路徑）');
console.log('   .env 存在:', require('fs').existsSync(ENV_PATH), ENV_PATH);
console.log('   .env.local 存在:', require('fs').existsSync(ENV_LOCAL_PATH), ENV_LOCAL_PATH);
console.log('   URL 已設定:', !!supabaseUrl);
console.log('   anon key 長度:', anonKey ? anonKey.length : 0);
console.log('   service_role 已設定:', !!serviceKey, serviceKey ? `（長度 ${serviceKey.length}）` : '');

if (!supabaseUrl || !keyForProbe) {
  console.error('❌ 需要 SUPABASE_URL 以及 SUPABASE_ANON_KEY 或 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabaseAnon = anonKey ? createClient(supabaseUrl, anonKey) : null;
const supabaseService = serviceKey ? createClient(supabaseUrl, serviceKey) : null;

async function probeInserts(label, client) {
  const { data: row, error: pickErr } = await client
    .from('event_main')
    .select('event_id')
    .limit(1)
    .maybeSingle();

  if (pickErr) {
    console.log(`\n⚠️ [${label}] 無法讀取 event_main（略過寫入探測）:`, pickErr.message);
    return;
  }

  const eventId = row && row.event_id ? row.event_id : 'probe_event';
  const stamp = Date.now();
  const payload = {
    event_id: eventId,
    voting_id: null,
    serial_no: stamp,
    user_name: '__rls_probe__',
    voting_location: '__probe_loc__',
    voting_award: '__probe_aw__',
    voting_datetime: new Date().toISOString()
  };

  const { error: insErr } = await client.from('voting_info').insert(payload);
  if (insErr) {
    console.log(`\n❌ [${label}] voting_info 寫入失敗:`, insErr.code, insErr.message);
    if (insErr.code === '42501') {
      console.log(
        `   → 這是 RLS：請在 .env 設定 SUPABASE_SERVICE_ROLE_KEY，或在 Supabase 執行 scripts/disable-rls-for-server.sql`
      );
    }
    return;
  }

  console.log(`\n✅ [${label}] voting_info 測試寫入成功（serial_no=${stamp}），正在刪除探測列…`);
  const { error: delErr } = await client
    .from('voting_info')
    .delete()
    .eq('user_name', '__rls_probe__')
    .eq('serial_no', stamp);
  if (delErr) {
    console.log('⚠️ 探測列刪除失敗（可手動刪 user_name=__rls_probe__）:', delErr.message);
  }
}

/** 與 server.js 投票相同：帶非 null 的 voting_id（RLS 若有條件經常會在這一步才擋） */
async function probeServerShapedVote(label, client) {
  const { data: ve, error: veErr } = await client
    .from('voting_event')
    .select('event_id, voting_id')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (veErr || !ve || !ve.voting_id) {
    console.log(
      `\n⚠️ [${label}] 找不到 active 的 voting_event，略過「正式投票形狀」探測`,
      veErr ? veErr.message : ''
    );
    return;
  }

  const eventId = ve.event_id;
  const votingId = ve.voting_id;
  const stamp = Date.now();
  const payload = {
    event_id: eventId,
    voting_id: votingId,
    serial_no: stamp,
    user_name: '__rls_probe_vote__',
    voting_location: '__probe_loc__',
    voting_award: '__probe_aw__',
    voting_datetime: new Date().toISOString()
  };

  console.log(
    `\n📌 [${label}] 正式投票形狀 probe（含 voting_id=${JSON.stringify(votingId)}）…`
  );

  const { error: insErr } = await client.from('voting_info').insert(payload);
  if (insErr) {
    console.log(`❌ [${label}] 失敗:`, insErr.code, insErr.message);
    if (insErr.code === '42501') {
      console.log(
        '   → 與「voting_id=null 可寫入」對照，多半是 RLS WITH CHECK 對「有 voting_id」的列較嚴。'
      );
      console.log(
        '   → 解法：在 Supabase 放寬 voting_info 的 INSERT policy，或使用 SUPABASE_SERVICE_ROLE_KEY。'
      );
      console.log('   → 或執行 scripts/disable-rls-for-server.sql');
    }
    return;
  }

  console.log(`✅ [${label}] 正式形狀寫入成功 serial_no=${stamp}，刪除中…`);
  const { error: delErr } = await client
    .from('voting_info')
    .delete()
    .eq('user_name', '__rls_probe_vote__')
    .eq('serial_no', stamp);
  if (delErr) {
    console.log('⚠️ 探測列刪除失敗:', delErr.message);
  }
}

async function probeMaxSerialSelect(label, client) {
  const { data: ve } = await client
    .from('voting_event')
    .select('voting_id')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  const votingId = ve && ve.voting_id ? ve.voting_id : null;
  if (!votingId) {
    console.log(`\n⚠️ [${label}] 略過 serial_no 讀取探測（無 voting_event）`);
    return;
  }
  console.log(
    `\n🔎 [${label}] voting_info SELECT（等同 getNextSerialNo，voting_id=${JSON.stringify(
      votingId
    )}）`
  );
  const { error: selErr, data } = await client
    .from('voting_info')
    .select('serial_no')
    .eq('voting_id', votingId)
    .order('serial_no', { ascending: false })
    .limit(1);
  if (selErr) {
    console.log(`❌ SELECT 失敗:`, selErr.code, selErr.message);
    if (selErr.code === '42501') {
      console.log(
        '   → 匿名無法「讀取」既有票（與可否 INSERT 無關，但請確認 policy 包含 SELECT）；'
      );
    }
    return;
  }
  console.log(
    `✅ SELECT OK（列數=${data ? data.length : 0}, 示例 serial_no=${
      data && data[0] ? data[0].serial_no : '—'
    }）`
  );
}

async function main() {
  try {
    console.log('\n📊 basic_data 讀取 (anon)…');
    if (supabaseAnon) {
      const { error } = await supabaseAnon.from('basic_data').select('*').limit(1);
      console.log(error ? `❌ ${error.code} ${error.message}` : '✅ OK');
    } else {
      console.log('（略過：無 anon key）');
    }

    console.log('\n── voting_info 寫入探測（會短暫插入再刪除）──');

    if (supabaseAnon) {
      await probeMaxSerialSelect('ANON_KEY', supabaseAnon);
      await probeInserts('ANON_KEY', supabaseAnon);
      await probeServerShapedVote('ANON_KEY', supabaseAnon);
    }

    if (supabaseService) {
      await probeInserts('SERVICE_ROLE_KEY', supabaseService);
      await probeServerShapedVote('SERVICE_ROLE_KEY', supabaseService);
    } else if (supabaseAnon) {
      console.log('\nℹ️ 未設定 SERVICE_ROLE_KEY（若 ANON 正式形狀失敗，請於 .env 加入 service_role）。');
    }
  } catch (e) {
    console.error('❌ 診斷例外:', e);
    process.exit(1);
  }
}

main();
