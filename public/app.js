const socket = io();

let selectedLocationId = null;
let selectedAwardId = null;
let selectedVotingId = null;
let selectedMarker = null;
let map = null;
let mapMarkers = [];
let appData = {
  basic: { title: '手機地圖投票系統', importantInfo: '歡迎參與投票活動！' },
  currentEvent: null,
  activeVotingEvent: null,
  openVotingEvents: [],
  locations: {},
  voteStats: {},
  voteStatsByVoting: {}
};

const userNameInput = document.getElementById('userName');
const gameIdInput = document.getElementById('gameId');
const originCountySelect = document.getElementById('originCounty');
const originDistrictSelect = document.getElementById('originDistrict');
const voteBtn = document.getElementById('voteBtn');
const optionsList = document.getElementById('optionsList');
const rewardOptionsList = document.getElementById('rewardOptionsList');
const selectedLocationLabel = document.getElementById('selectedLocationLabel');
const selectedAwardLabel = document.getElementById('selectedAwardLabel');
const eventTitleEl = document.getElementById('eventTitle');
const eventMetaEl = document.getElementById('eventMeta');
const currentVotingInfoEl = document.getElementById('currentVotingInfo');
const votingEventTabsEl = document.getElementById('votingEventTabs');
const liveResultsContentEl = document.getElementById('liveResultsContent');
const appTitleEl = document.getElementById('appTitle');
const appDescriptionEl = document.getElementById('appDescription');
const awardFeedbackInput = document.getElementById('awardFeedback');

const TAIWAN_ORIGIN_OPTIONS = {
  台北市: ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區'],
  新北市: ['萬里區', '金山區', '板橋區', '汐止區', '深坑區', '石碇區', '瑞芳區', '平溪區', '雙溪區', '貢寮區', '新店區', '坪林區', '烏來區', '永和區', '中和區', '土城區', '三峽區', '樹林區', '鶯歌區', '三重區', '新莊區', '泰山區', '林口區', '蘆洲區', '五股區', '八里區', '淡水區', '三芝區', '石門區'],
  桃園市: ['中壢區', '平鎮區', '龍潭區', '楊梅區', '新屋區', '觀音區', '桃園區', '龜山區', '八德區', '大溪區', '復興區', '大園區', '蘆竹區'],
  台中市: ['中區', '東區', '南區', '西區', '北區', '北屯區', '西屯區', '南屯區', '太平區', '大里區', '霧峰區', '烏日區', '豐原區', '后里區', '石岡區', '東勢區', '和平區', '新社區', '潭子區', '大雅區', '神岡區', '大肚區', '沙鹿區', '龍井區', '梧棲區', '清水區', '大甲區', '外埔區', '大安區'],
  台南市: ['中西區', '東區', '南區', '北區', '安平區', '安南區', '永康區', '歸仁區', '新化區', '左鎮區', '玉井區', '楠西區', '南化區', '仁德區', '關廟區', '龍崎區', '官田區', '麻豆區', '佳里區', '西港區', '七股區', '將軍區', '學甲區', '北門區', '新營區', '後壁區', '白河區', '東山區', '六甲區', '下營區', '柳營區', '鹽水區', '善化區', '大內區', '山上區', '新市區', '安定區'],
  高雄市: ['新興區', '前金區', '苓雅區', '鹽埕區', '鼓山區', '旗津區', '前鎮區', '三民區', '楠梓區', '小港區', '左營區', '仁武區', '大社區', '東沙群島', '南沙群島', '岡山區', '路竹區', '阿蓮區', '田寮區', '燕巢區', '橋頭區', '梓官區', '彌陀區', '永安區', '湖內區', '鳳山區', '大寮區', '林園區', '鳥松區', '大樹區', '旗山區', '美濃區', '六龜區', '內門區', '杉林區', '甲仙區', '桃源區', '那瑪夏區', '茂林區', '茄萣區'],
  基隆市: ['仁愛區', '信義區', '中正區', '中山區', '安樂區', '暖暖區', '七堵區'],
  新竹市: ['東區', '北區', '香山區'],
  嘉義市: ['東區', '西區'],
  新竹縣: ['竹北市', '湖口鄉', '新豐鄉', '新埔鎮', '關西鎮', '芎林鄉', '寶山鄉', '竹東鎮', '五峰鄉', '橫山鄉', '尖石鄉', '北埔鄉', '峨眉鄉'],
  苗栗縣: ['竹南鎮', '頭份市', '三灣鄉', '南庄鄉', '獅潭鄉', '後龍鎮', '通霄鎮', '苑裡鎮', '苗栗市', '造橋鄉', '頭屋鄉', '公館鄉', '大湖鄉', '泰安鄉', '銅鑼鄉', '三義鄉', '西湖鄉', '卓蘭鎮'],
  彰化縣: ['彰化市', '芬園鄉', '花壇鄉', '秀水鄉', '鹿港鎮', '福興鄉', '線西鄉', '和美鎮', '伸港鄉', '員林市', '社頭鄉', '永靖鄉', '埔心鄉', '溪湖鎮', '大村鄉', '埔鹽鄉', '田中鎮', '北斗鎮', '田尾鄉', '埤頭鄉', '溪州鄉', '竹塘鄉', '二林鎮', '大城鄉', '芳苑鄉', '二水鄉'],
  南投縣: ['南投市', '中寮鄉', '草屯鎮', '國姓鄉', '埔里鎮', '仁愛鄉', '名間鄉', '集集鎮', '水里鄉', '魚池鄉', '信義鄉', '竹山鎮', '鹿谷鄉'],
  雲林縣: ['斗南鎮', '大埤鄉', '虎尾鎮', '土庫鎮', '褒忠鄉', '東勢鄉', '台西鄉', '崙背鄉', '麥寮鄉', '斗六市', '林內鄉', '古坑鄉', '莿桐鄉', '西螺鎮', '二崙鄉', '北港鎮', '水林鄉', '口湖鄉', '四湖鄉', '元長鄉'],
  嘉義縣: ['番路鄉', '梅山鄉', '竹崎鄉', '阿里山鄉', '中埔鄉', '大埔鄉', '水上鄉', '鹿草鄉', '太保市', '朴子市', '東石鄉', '六腳鄉', '新港鄉', '民雄鄉', '大林鎮', '溪口鄉', '義竹鄉', '布袋鎮'],
  屏東縣: ['屏東市', '三地門鄉', '霧台鄉', '瑪家鄉', '九如鄉', '里港鄉', '高樹鄉', '鹽埔鄉', '長治鄉', '麟洛鄉', '竹田鄉', '內埔鄉', '萬丹鄉', '潮州鎮', '泰武鄉', '來義鄉', '萬巒鄉', '崁頂鄉', '新埤鄉', '南州鄉', '林邊鄉', '東港鎮', '琉球鄉', '佳冬鄉', '新園鄉', '枋寮鄉', '枋山鄉', '春日鄉', '獅子鄉', '車城鄉', '牡丹鄉', '恆春鎮', '滿州鄉'],
  宜蘭縣: ['宜蘭市', '頭城鎮', '礁溪鄉', '壯圍鄉', '員山鄉', '羅東鎮', '三星鄉', '大同鄉', '五結鄉', '冬山鄉', '蘇澳鎮', '南澳鄉', '釣魚台列嶼'],
  花蓮縣: ['花蓮市', '新城鄉', '秀林鄉', '吉安鄉', '壽豐鄉', '鳳林鎮', '光復鄉', '豐濱鄉', '瑞穗鄉', '萬榮鄉', '玉里鎮', '卓溪鄉', '富里鄉'],
  台東縣: ['台東市', '綠島鄉', '蘭嶼鄉', '延平鄉', '卑南鄉', '鹿野鄉', '關山鎮', '海端鄉', '池上鄉', '東河鄉', '成功鎮', '長濱鄉', '太麻里鄉', '金峰鄉', '大武鄉', '達仁鄉'],
  澎湖縣: ['馬公市', '西嶼鄉', '望安鄉', '七美鄉', '白沙鄉', '湖西鄉'],
  金門縣: ['金沙鎮', '金湖鎮', '金寧鄉', '金城鎮', '烈嶼鄉', '烏坵鄉'],
  連江縣: ['南竿鄉', '北竿鄉', '莒光鄉', '東引鄉'],
  國外: []
};

function sanitizeBasicText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>"'`;\\]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isValidUserName(value) {
  const cleaned = sanitizeBasicText(value, 30);
  return cleaned.length > 0 && cleaned.length <= 30;
}

function isValidGameId(value) {
  const cleaned = sanitizeBasicText(value, 50);
  return /^[A-Za-z0-9]{1,50}$/.test(cleaned);
}

function isValidOrigin() {
  const county = originCountySelect?.value || '';
  const district = originDistrictSelect?.value || '';
  if (!county) return false;
  if (county === '國外') return true;
  return district.length > 0;
}

function getUserOriginPayload() {
  const county = originCountySelect?.value || '';
  const district = county === '國外' ? '' : (originDistrictSelect?.value || '');
  const userLocation = county === '國外' ? '國外' : `${county}${district}`;
  return { userCounty: county, userDistrict: district, userLocation };
}

function renderDistrictOptions(county) {
  if (!originDistrictSelect) return;
  const districts = TAIWAN_ORIGIN_OPTIONS[county] || [];
  if (county === '國外') {
    originDistrictSelect.innerHTML = '<option value="">免填</option>';
    originDistrictSelect.disabled = true;
    return;
  }

  originDistrictSelect.disabled = false;
  originDistrictSelect.innerHTML = districts
    .map((name) => `<option value="${name}">${name}</option>`)
    .join('');
}

// 更新投票按鈕狀態
function updateVoteState() {
  voteBtn.disabled = !selectedLocationId
    || !selectedAwardId
    || !isValidUserName(userNameInput.value)
    || !isValidGameId(gameIdInput?.value || '')
    || !isValidOrigin();
}

function getDueTime(item) {
  const t = new Date(item?.voting_due || 0).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function sortOpenVotingEvents(events) {
  return [...(events || [])].sort((a, b) => getDueTime(a) - getDueTime(b));
}

function getSelectedVotingEvent() {
  const openEvents = appData.openVotingEvents || [];
  if (openEvents.length > 0) {
    const matched = openEvents.find((item) => item.voting_id === selectedVotingId);
    return matched || openEvents[0];
  }
  return appData.activeVotingEvent || null;
}

function getSelectedVoteStats() {
  const currentVotingEvent = getSelectedVotingEvent();
  if (!currentVotingEvent) return appData.voteStats || {};
  return appData.voteStatsByVoting[currentVotingEvent.voting_id]
    || currentVotingEvent.voteStats
    || appData.voteStats
    || {};
}

function renderVotingEventTabs() {
  if (!votingEventTabsEl) return;
  const openEvents = sortOpenVotingEvents(appData.openVotingEvents || []);
  if (openEvents.length === 0) {
    votingEventTabsEl.innerHTML = '';
    return;
  }

  if (!selectedVotingId || !openEvents.some((item) => item.voting_id === selectedVotingId)) {
    selectedVotingId = openEvents[0].voting_id;
  }

  votingEventTabsEl.innerHTML = openEvents.map((item) => {
    const activeClass = item.voting_id === selectedVotingId ? 'active' : '';
    const dueText = item.voting_due ? new Date(item.voting_due).toLocaleString('zh-TW') : '未設定';
    return `
      <button type="button" class="voting-event-tab ${activeClass}" data-voting-id="${item.voting_id}">
        <strong>${item.event_name || item.event_id}</strong>
        <span>截止：${dueText}</span>
      </button>
    `;
  }).join('');

  document.querySelectorAll('.voting-event-tab').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      selectedVotingId = e.currentTarget.dataset.votingId;
      selectedLocationId = null;
      selectedAwardId = null;
      selectedLocationLabel.textContent = '請先選擇一個投票項目';
      if (selectedAwardLabel) {
        selectedAwardLabel.textContent = '請先選擇一個獎勵條件';
      }
      renderVotingEventTabs();
      renderLiveResults();
      renderActiveVotingInfo();
      renderOptions();
      renderRewardOptions();
      updateMapMarkers();
      updateVoteState();
    });
  });
}

function getVisibleLocations() {
  const currentVotingEvent = getSelectedVotingEvent();
  if (currentVotingEvent && Array.isArray(currentVotingEvent.locations) && currentVotingEvent.locations.length > 0) {
    return currentVotingEvent.locations;
  }
  return Object.values(appData.locations);
}

function renderLiveResults() {
  if (!liveResultsContentEl) return;
  const currentVotingEvent = getSelectedVotingEvent();
  const currentStats = getSelectedVoteStats();

  if (!currentVotingEvent) {
    liveResultsContentEl.innerHTML =
      '<p class="live-results-empty">目前沒有開放中且未到截止時間的投票，尚無即時結果。</p>';
    return;
  }

  const dueRaw = currentVotingEvent.voting_due;
  const dueText = dueRaw ? new Date(dueRaw).toLocaleString('zh-TW') : '尚未設定';
  const eventTitle = currentVotingEvent.event_name || currentVotingEvent.event_id || '投票活動';

  const locations = currentVotingEvent.locations || [];
  const awards = currentVotingEvent.awards || [];
  const statsEntries = Object.entries(currentStats || {});
  const locationRows = locations.map((loc) => ({
    id: String(loc.id),
    name: loc.name,
    count: currentStats[loc.id]?.count || 0
  }));

  const awardCountById = {};
  statsEntries.forEach(([, stat]) => {
    const awardMap = stat?.awards || {};
    Object.entries(awardMap).forEach(([awardId, count]) => {
      awardCountById[awardId] = (awardCountById[awardId] || 0) + (count || 0);
    });
  });

  const piePalette = ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];
  const buildPieSection = (rows, emptyText) => {
    const total = rows.reduce((sum, r) => sum + (r.count || 0), 0);
    if (rows.length === 0) {
      return `<p class="live-results-empty">${emptyText}</p>`;
    }

    const segments = [];
    let cursor = 0;
    rows.forEach((row, idx) => {
      const value = row.count || 0;
      const pct = total > 0 ? (value / total) * 100 : 0;
      const end = cursor + pct;
      const color = piePalette[idx % piePalette.length];
      segments.push(`${color} ${cursor}% ${end}%`);
      cursor = end;
    });

    const pieStyle = total > 0
      ? `background: conic-gradient(${segments.join(',')});`
      : 'background: #e2e8f0;';

    const legendHtml = rows.map((row, idx) => {
      const value = row.count || 0;
      const pct = total > 0 ? Math.round((value / total) * 100) : 0;
      const color = piePalette[idx % piePalette.length];
      return `
        <div class="live-pie-legend-row">
          <span class="live-pie-dot" style="background:${color}"></span>
          <span class="live-pie-name">${row.name}</span>
          <span class="live-pie-value">${value} 票 (${pct}%)</span>
        </div>`;
    }).join('');

    return `
      <div class="live-pie-layout">
        <div class="live-pie-chart-wrap">
          <div class="live-pie-chart" style="${pieStyle}"></div>
          <div class="live-pie-center">${total} 票</div>
        </div>
        <div class="live-pie-legend">${legendHtml}</div>
      </div>`;
  };

  const awardRows = awards.map((aw) => ({
    name: aw.description,
    count: awardCountById[aw.id] || 0
  }));

  liveResultsContentEl.innerHTML = `
    <p class="live-results-meta"><strong>${eventTitle}</strong></p>
    <p class="live-results-due">投票截止：${dueText}</p>
    <h3 class="live-results-subtitle">投票地點票數</h3>
    <div class="live-results-grid">${buildPieSection(locationRows, '目前沒有可投票地點。')}</div>
    <h3 class="live-results-subtitle">可領取獎勵條件票數</h3>
    <div class="live-results-grid">${buildPieSection(awardRows, '目前沒有可領取獎勵條件。')}</div>
  `;
}

function renderActiveVotingInfo() {
  if (!currentVotingInfoEl) return;
  const currentVotingEvent = getSelectedVotingEvent();

  if (!currentVotingEvent) {
    currentVotingInfoEl.innerHTML = '<p>目前尚無開放投票活動，請稍後回來查看。</p>';
    return;
  }

  const votingDueText = currentVotingEvent.voting_due
    ? new Date(currentVotingEvent.voting_due).toLocaleString('zh-TW')
    : '尚未設定';

  currentVotingInfoEl.innerHTML = `
    <h3>本次投票活動</h3>
    <p><strong>投票截止：</strong>${votingDueText}</p>
    <p>可投票項目與可領取獎勵條件請參考上方「即時投票結果」。</p>
  `;
}

// 渲染地點選項
function renderOptions() {
  const currentStats = getSelectedVoteStats();
  const locationArray = getVisibleLocations();
  optionsList.innerHTML = locationArray
    .map((location) => {
      const isActive = String(location.id) === String(selectedLocationId) ? 'selected' : '';
      return `
        <button type="button" class="option-item ${isActive}" data-location="${location.id}">
          <div>
            <div class="option-title">${location.name}</div>
          </div>
        </button>
      `;
    })
    .join('');

  // 綁定點擊事件
  document.querySelectorAll('.option-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const locationId = e.currentTarget.dataset.location;
      selectLocation(locationId);
    });
  });
}

function renderRewardOptions() {
  if (!rewardOptionsList) return;
  const currentVotingEvent = getSelectedVotingEvent();

  const awardArray = currentVotingEvent?.awards || [];
  if (awardArray.length === 0) {
    rewardOptionsList.innerHTML = '<p class="option-info">目前無可選獎勵條件。</p>';
    return;
  }

  rewardOptionsList.innerHTML = awardArray
    .map((award) => {
      const isActive = String(award.id) === String(selectedAwardId) ? 'selected' : '';
      return `
        <button type="button" class="option-item reward-option-item ${isActive}" data-award="${award.id}">
          <div>
            <div class="option-title">${award.description}</div>
          </div>
        </button>
      `;
    })
    .join('');

  document.querySelectorAll('.reward-option-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const awardId = e.currentTarget.dataset.award;
      selectAward(awardId);
    });
  });
}

// 選擇地點
function selectLocation(locationId) {
  selectedLocationId = String(locationId);
  const location = appData.locations[selectedLocationId] || appData.activeVotingEvent?.locations?.find((item) => String(item.id) === selectedLocationId);

  // 更新UI
  document.querySelectorAll('.option-item').forEach((btn) => {
    if (btn.dataset.location) {
      btn.classList.toggle('selected', String(btn.dataset.location) === selectedLocationId);
    }
  });

  // 更新地圖
  updateMapSelection(selectedLocationId);

  // 更新選擇標籤
  selectedLocationLabel.textContent = location ? `已選擇: ${location.name}` : '請先選擇一個投票項目';

  updateVoteState();
}

function selectAward(awardId) {
  selectedAwardId = awardId;
  const award = getSelectedVotingEvent()?.awards?.find((item) => String(item.id) === String(awardId));

  document.querySelectorAll('.reward-option-item').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.award === awardId);
  });

  selectedAwardLabel.textContent = award ? `已選擇獎勵條件: ${award.description}` : '請先選擇一個獎勵條件';

  updateVoteState();
}

function createMapMarker(options) {
  if (google.maps.marker && typeof google.maps.marker.AdvancedMarkerElement === 'function') {
    return new google.maps.marker.AdvancedMarkerElement(options);
  }
  return new google.maps.Marker(options);
}

// 生成地點標記的簡短文字
function getLocationLabel(location) {
  // 移除共同前綴 "台中"，只顯示具體地點名稱
  let name = location.name;
  if (name.startsWith('台中')) {
    name = name.substring(2); // 移除 "台中"
  }

  // 如果名稱太長，取前4個字元
  if (name.length > 4) {
    name = name.substring(0, 4);
  }

  return name;
}

// 更新地圖選擇
function updateMapSelection(locationId) {
  console.log('嘗試更新地圖選擇:', locationId);

  const location = appData.locations[locationId] || getSelectedVotingEvent()?.locations?.find((item) => String(item.id) === String(locationId));
  console.log('找到的地點:', location);

  if (!location || !map) {
    console.warn('無法更新地圖，找不到對應地點或地圖尚未初始化:', locationId);
    return;
  }

  const lat = parseFloat(location.lat);
  const lng = parseFloat(location.lng);
  console.log('原始座標:', location.lat, location.lng, '解析後:', lat, lng);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    console.warn('無效座標，無法定位地圖:', location);
    return;
  }

  // 清除之前的選擇
  if (selectedMarker) {
    selectedMarker.setMap(null);
  }

  // 創建新的選擇標記
  selectedMarker = createMapMarker({
    position: { lat, lng },
    map,
    title: location.name,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
        <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <circle cx="20" cy="20" r="18" fill="#4285F4" stroke="white" stroke-width="3"/>
          <text x="20" y="25" text-anchor="middle" fill="white" font-family="Arial" font-size="16" font-weight="bold">✓</text>
        </svg>
      `),
      scaledSize: new google.maps.Size(40, 40),
    },
  });

  // 移動地圖視圖
  map.panTo({ lat, lng });
  map.setZoom(14);
  google.maps.event.trigger(map, 'resize');
  console.log('地圖已更新到:', lat, lng);
}

// 初始化地圖
function initMap() {
  // 使用第一個投票選項作為預設地圖位置
  let defaultLocation = { lat: 25.0330, lng: 121.5654 }; // 台北作為備用預設位置

  const locationArray = getVisibleLocations();
  if (locationArray.length > 0) {
    const firstLocation = locationArray[0];
    const lat = parseFloat(firstLocation.lat);
    const lng = parseFloat(firstLocation.lng);

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      defaultLocation = { lat, lng };
      console.log('地圖預設位置設為第一個投票點:', firstLocation.name, defaultLocation);
    }
  }

  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 12,
    center: defaultLocation,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  // 創建地點標記
  updateMapMarkers();
}

// 更新地圖標記
function updateMapMarkers() {
  if (!map) return;

  // 清除先前的標記
  mapMarkers.forEach((marker) => marker.setMap(null));
  mapMarkers = [];

  const locationArray = getVisibleLocations();
  locationArray.forEach((location) => {
    if (!location.lat || !location.lng) return;

    const lat = parseFloat(location.lat);
    const lng = parseFloat(location.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const marker = createMapMarker({
      position: { lat, lng },
      map,
      title: location.name,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
          <svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
            <circle cx="15" cy="15" r="13" fill="#ffde00" stroke="#111827" stroke-width="2"/>
            <text x="15" y="19" text-anchor="middle" fill="#111827" font-family="Arial" font-size="10" font-weight="bold">${getLocationLabel(location)}</text>
          </svg>
        `),
        scaledSize: new google.maps.Size(30, 30),
      },
    });

    marker.addListener('click', () => {
      selectLocation(location.id);
    });

    mapMarkers.push(marker);
  });
}

// 更新應用程式資料
function updateAppData(newData) {
  appData = { ...appData, ...newData };
  if (Array.isArray(newData.openVotingEvents)) {
    appData.openVotingEvents = sortOpenVotingEvents(newData.openVotingEvents);
    appData.voteStatsByVoting = {};
    appData.openVotingEvents.forEach((item) => {
      appData.voteStatsByVoting[item.voting_id] = item.voteStats || {};
    });
    if (!selectedVotingId && appData.openVotingEvents[0]) {
      selectedVotingId = appData.openVotingEvents[0].voting_id;
    }
  }

  // 主標題與副標題：由 basic_data 讀取
  appTitleEl.textContent = appData.basic?.title || '';
  appDescriptionEl.textContent = appData.basic?.info || appData.basic?.importantInfo || '';

  // 活動資訊（維持在最上方兩行）
  if (appData.currentEvent) {
    eventTitleEl.textContent = appData.currentEvent.event_name || '';
    const eventDate = appData.currentEvent.event_date ? new Date(appData.currentEvent.event_date) : null;
    const dueDate = appData.currentEvent.voting_due ? new Date(appData.currentEvent.voting_due) : null;
    const eventDateText = eventDate && !Number.isNaN(eventDate.getTime())
      ? eventDate.toLocaleDateString('zh-TW')
      : '未設定日期';
    const dueText = dueDate && !Number.isNaN(dueDate.getTime())
      ? dueDate.toLocaleString('zh-TW')
      : '未設定截止時間';
    eventMetaEl.textContent = `${eventDateText} | ${appData.currentEvent.event_time || ''} | 投票截止: ${dueText}`;
  } else {
    eventTitleEl.textContent = '';
    eventMetaEl.textContent = '';
  }

  renderVotingEventTabs();
  renderLiveResults();
  renderActiveVotingInfo();
  renderOptions();
  renderRewardOptions();
  updateMapMarkers();
}

// 投票功能
voteBtn.addEventListener('click', () => {
  const currentVotingEvent = getSelectedVotingEvent();
  const userName = sanitizeBasicText(userNameInput.value, 30);
  const userGameId = sanitizeBasicText(gameIdInput.value, 50);
  const feedbackAward = sanitizeBasicText(awardFeedbackInput?.value || '', 50);
  const { userCounty, userDistrict, userLocation } = getUserOriginPayload();
  const locationId = selectedLocationId;
  const awardId = selectedAwardId;

  if (!currentVotingEvent) {
    alert('目前沒有可投票活動，請稍後再試。');
    return;
  }
  if (!isValidUserName(userName)) {
    alert('名字格式不正確：最多 30 字，請勿輸入特殊符號。');
    return;
  }
  if (!isValidGameId(userGameId)) {
    alert('遊戲ID格式不正確：只能英數字，最多 50 字。');
    return;
  }
  if (!isValidOrigin()) {
    alert('請選擇您的縣市與行政區（選國外則行政區可免填）。');
    return;
  }
  if (!locationId || !awardId) {
    alert('請先選擇投票地點與獎勵條件。');
    return;
  }

  socket.emit('cast-vote', {
    userName,
    userGameId,
    feedbackAward,
    userCounty,
    userDistrict,
    userLocation,
    eventId: currentVotingEvent.event_id,
    votingId: currentVotingEvent.voting_id,
    locationId,
    awardId
  });

  voteBtn.disabled = true;
  voteBtn.textContent = '投票中...';
});

// 用戶名稱輸入監聽
userNameInput.addEventListener('input', updateVoteState);
gameIdInput.addEventListener('input', updateVoteState);
originCountySelect.addEventListener('change', () => {
  renderDistrictOptions(originCountySelect.value);
  if (originCountySelect.value === '台中市') {
    originDistrictSelect.value = '北屯區';
  }
  updateVoteState();
});
originDistrictSelect.addEventListener('change', updateVoteState);

// Socket.IO 事件監聽
socket.on('app-data-update', (data) => {
  console.log('收到應用程式資料更新:', data);
  updateAppData(data);
});

socket.on('vote-stats-update', (payload) => {
  const stats = payload?.stats || payload || {};
  const votingId = payload?.votingId || appData.activeVotingEvent?.voting_id || selectedVotingId;
  console.log('收到投票統計更新:', payload);
  if (votingId) {
    appData.voteStatsByVoting[votingId] = stats;
    if (votingId === selectedVotingId) {
      appData.voteStats = stats;
    }
  } else {
    appData.voteStats = stats;
  }
  renderLiveResults();
  renderOptions(); // 重新渲染以顯示最新票數
});

socket.on('vote-success', (data) => {
  alert(data.message);
  voteBtn.disabled = false;
  voteBtn.textContent = '投票';
  userNameInput.value = ''; // 清空用戶名稱
  if (awardFeedbackInput) {
    awardFeedbackInput.value = '';
  }
  selectedLocationId = null; // 清空選擇
  selectedAwardId = null;
  selectedLocationLabel.textContent = '請先選擇一個投票項目';
  if (selectedAwardLabel) {
    selectedAwardLabel.textContent = '請先選擇一個獎勵條件';
  }
  updateVoteState();
});

socket.on('vote-error', (error) => {
  let text = error.message || '未知錯誤';
  if (error.details) {
    text += `\n詳情：${error.details}`;
  }
  if (error.hint) {
    text += `\n提示：${error.hint}`;
  }
  alert('投票失敗: ' + text);
  voteBtn.disabled = false;
  voteBtn.textContent = '投票';
});

// 頁面載入完成後初始化
async function fetchAppData() {
  try {
    const response = await fetch('/api/app-data');
    if (!response.ok) {
      console.error('載入應用程式資料失敗：', response.statusText);
      return;
    }
    const data = await response.json();
    updateAppData(data);
  } catch (error) {
    console.error('載入應用程式資料失敗：', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (originCountySelect) {
    originCountySelect.innerHTML = Object.keys(TAIWAN_ORIGIN_OPTIONS)
      .map((county) => `<option value="${county}">${county}</option>`)
      .join('');
    originCountySelect.value = '台中市';
    renderDistrictOptions('台中市');
    if (originDistrictSelect) {
      originDistrictSelect.value = '北屯區';
    }
  }
  updateVoteState();
  await fetchAppData();
  initMap();
});

