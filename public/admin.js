let isLoggedIn = false;
const socket = io();
let supabaseClient = null;
let adminSessionToken = '';

let appData = {
  basic: { title: '手機地圖投票系統', importantInfo: '歡迎參與投票活動！' },
  currentEvent: null,
  locations: {},
  voteStats: {},
  events: [],
  votingEvents: [],
  voteRecords: [],
  awardConditions: [],
  locationTypes: []
};

const loginScreen = document.getElementById('loginScreen');
const adminPanel = document.getElementById('adminPanel');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const addEventBtn = document.getElementById('addEventBtn');
const addLocationBtn = document.getElementById('addLocationBtn');
const eventForm = document.getElementById('eventForm');
const eventFormTitle = document.getElementById('eventFormTitle');
const eventEditForm = document.getElementById('eventEditForm');
const cancelEventBtn = document.getElementById('cancelEventBtn');
const locationsList = document.getElementById('locationsList');
const locationForm = document.getElementById('locationForm');
const locationFormTitle = document.getElementById('locationFormTitle');
const locationEditForm = document.getElementById('locationEditForm');
const cancelLocationBtn = document.getElementById('cancelLocationBtn');
const statsContainer = document.getElementById('statsContainer');
const refreshStatsBtn = document.getElementById('refreshStatsBtn');
const refreshRecordsBtn = document.getElementById('refreshRecordsBtn');
const voteRecordsContainer = document.getElementById('voteRecordsContainer');

function showLoginScreen() {
  isLoggedIn = false;
  adminPanel.style.display = 'none';
  loginScreen.style.display = 'block';
}

function showAdminPanel() {
  isLoggedIn = true;
  loginScreen.style.display = 'none';
  adminPanel.style.display = 'block';
}

async function initSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const response = await fetch('/api/auth-config');
  const payload = await response.json();
  if (!response.ok || !payload?.supabaseUrl || !payload?.supabaseAnonKey) {
    throw new Error(payload?.message || '無法讀取登入設定');
  }

  supabaseClient = window.supabase.createClient(payload.supabaseUrl, payload.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  return supabaseClient;
}

async function getAccessToken() {
  const client = await initSupabaseClient();
  const { data } = await client.auth.getSession();
  const token = data?.session?.access_token || '';
  adminSessionToken = token;
  return token;
}

async function authorizedFetch(url, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('尚未登入');
  }
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`
  };
  return fetch(url, { ...options, headers });
}

async function verifyAdminAccess() {
  const response = await authorizedFetch('/api/admin/me');
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || '無後台權限');
  }
  return true;
}

async function signOutAdmin() {
  try {
    if (supabaseClient) {
      await supabaseClient.auth.signOut();
    }
  } catch (error) {
    console.warn('登出時清理 session 失敗:', error);
  }
  adminSessionToken = '';
  showLoginScreen();
  loginForm.reset();
  loginError.textContent = '';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const client = await initSupabaseClient();
    const { error } = await client.auth.signInWithPassword({
      email: username,
      password
    });
    if (error) {
      loginError.textContent = error.message || '登入失敗，請檢查帳號密碼';
      return;
    }

    await verifyAdminAccess();
    showAdminPanel();
    loginError.textContent = '';
    loadAppData();
  } catch (error) {
    console.error('登入錯誤:', error);
    loginError.textContent = error.message || '連線失敗，請稍後再試';
  }
});

logoutBtn.addEventListener('click', () => {
  signOutAdmin();
});

async function loadAppData() {
  try {
    const [appDataResponse, votingEventsResponse, voteRecordsResponse] = await Promise.allSettled([
      authorizedFetch('/api/app-data'),
      authorizedFetch('/api/voting-events'),
      authorizedFetch('/api/vote-records')
    ]);

    let appDataJson = {};
    let votingEventsJson = [];
    let voteRecordsJson = [];

    if (appDataResponse.status === 'fulfilled' && appDataResponse.value.ok) {
      appDataJson = await appDataResponse.value.json();
    } else {
      console.warn('載入 /api/app-data 失敗');
    }

    if (votingEventsResponse.status === 'fulfilled' && votingEventsResponse.value.ok) {
      votingEventsJson = await votingEventsResponse.value.json();
    } else {
      console.warn('載入 /api/voting-events 失敗');
    }

    if (voteRecordsResponse.status === 'fulfilled' && voteRecordsResponse.value.ok) {
      voteRecordsJson = await voteRecordsResponse.value.json();
    } else {
      console.warn('載入 /api/vote-records 失敗，先顯示其餘資料');
    }

    appData = {
      ...appData,
      ...appDataJson,
      votingEvents: votingEventsJson,
      voteRecords: voteRecordsJson
    };
    renderEvents();
    renderLocations();
    renderStats();
    renderVoteRecords();
  } catch (error) {
    console.error('載入應用程式資料失敗:', error);
  }
}

async function loadVoteRecords() {
  try {
    const response = await authorizedFetch('/api/vote-records');
    if (!response.ok) return;
    appData.voteRecords = await response.json();
    renderVoteRecords();
  } catch (error) {
    console.error('載入投票紀錄失敗:', error);
  }
}

const eventLocationSelectIds = ['locationSelect1', 'locationSelect2', 'locationSelect3'];
const eventAwardSelectIds = ['awardSelect1', 'awardSelect2', 'awardSelect3'];

function populateEventFormOptions(selectedLocations = [], selectedAwards = []) {
  const locationOptions = [{ id: '', name: '請選擇地點' }, ...Object.values(appData.locations).map((loc) => ({ id: loc.id, name: loc.name }))];
  const awardOptions = [{ id: '', desc: '請選擇獎勵條件' }, ...appData.awardConditions.map((item) => ({ id: item.condition_id, desc: item.condition_desc }))];

  eventLocationSelectIds.forEach((selectId, index) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = locationOptions.map((opt) => `<option value="${opt.id}">${opt.name}</option>`).join('');
    select.value = selectedLocations[index] || '';
  });

  eventAwardSelectIds.forEach((selectId, index) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = awardOptions.map((opt) => `<option value="${opt.id}">${opt.desc}</option>`).join('');
    select.value = selectedAwards[index] || '';
  });
}

function populateLocationTypeOptions(selectedType = '') {
  const select = document.getElementById('locationType');
  if (!select) return;

  const typeOptions = [{ value: '', label: '請選擇地點類型' }, ...appData.locationTypes.map((type) => ({ value: type, label: type }))];
  if (typeOptions.length === 1) {
    // fallback default options when DB is not available
    typeOptions.push(
      { value: 'park', label: '公園' },
      { value: 'venue', label: '場地' },
      { value: 'restaurant', label: '餐廳' },
      { value: 'other', label: '其他' }
    );
  }

  select.innerHTML = typeOptions.map((opt) => `<option value="${opt.value}">${opt.label}</option>`).join('');
  select.value = selectedType || '';
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const tabId = e.target.dataset.tab;
    if (!tabId) return;

    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.style.display = 'none');

    e.target.classList.add('active');
    const tab = document.getElementById(tabId);
    if (tab) tab.style.display = 'block';
  });
});

function renderEvents() {
  const eventsList = document.getElementById('eventsList');
  if (!appData.votingEvents || appData.votingEvents.length === 0) {
    eventsList.innerHTML = '<p class="empty-state">目前沒有投票活動設定</p>';
    return;
  }

  eventsList.innerHTML = appData.votingEvents.map(event => `
    <div class="event-item">
      <div class="event-info">
        <h3>${event.event_name}</h3>
        <p>類型: ${event.event_type} | 日期: ${new Date(event.event_date).toLocaleDateString('zh-TW')}</p>
        <p>時間: ${event.event_time} | 投票截止: ${new Date(event.voting_due).toLocaleString('zh-TW')}</p>
        ${event.voting_active ? '<span class="current-badge">啟用中</span>' : '<span class="inactive-badge">已停用</span>'}
      </div>
      <div class="event-actions">
        <button class="btn-edit" type="button" onclick="editEvent('${event.event_id}')">編輯</button>
        <button class="btn-delete" type="button" onclick="deleteEvent('${event.event_id}')">停用</button>
      </div>
    </div>
  `).join('');
}

addEventBtn.addEventListener('click', () => {
  showEventForm();
});

addLocationBtn.addEventListener('click', () => {
  showLocationForm();
});

function editEvent(eventId) {
  const event = appData.votingEvents.find((item) => item.event_id === eventId);
  if (event) {
    showEventForm(event);
  }
}

async function deleteEvent(eventId) {
  if (!confirm('確認要停用這個投票活動的設定嗎？這不會刪除活動本身。')) {
    return;
  }

  try {
    const response = await authorizedFetch(`/api/voting-event/${eventId}/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.ok) {
      await loadAppData();
      alert('已停用該投票活動設定');
    } else {
      const result = await response.json();
      alert(result.message || '停用投票活動設定失敗');
    }
  } catch (error) {
    console.error('停用投票活動設定失敗:', error);
    alert('停用投票活動設定失敗');
  }
}

function showEventForm(event = null) {
  if (event) {
    eventFormTitle.textContent = '編輯活動';
    document.getElementById('eventId').value = event.event_id;
    document.getElementById('eventName').value = event.event_name;
    document.getElementById('eventType').value = event.event_type;
    document.getElementById('eventDate').value = event.event_date.split('T')[0];
    document.getElementById('eventTime').value = event.event_time;
    document.getElementById('votingDue').value = event.voting_due.slice(0, 16);
    const selectedLocations = event.selected_locations || ['', '', ''];
    const selectedAwards = event.selected_awards || ['', '', ''];
    populateEventFormOptions(selectedLocations, selectedAwards);
  } else {
    eventFormTitle.textContent = '新增活動';
    eventEditForm.reset();
    document.getElementById('eventId').value = '';
    populateEventFormOptions([], []);
  }

  eventForm.style.display = 'block';
}

cancelEventBtn.addEventListener('click', () => {
  eventForm.style.display = 'none';
});

eventEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const eventId = document.getElementById('eventId').value || `event_${Date.now()}`;
  const selectedLocations = eventLocationSelectIds.map((id) => document.getElementById(id).value);
  const selectedAwards = eventAwardSelectIds.map((id) => document.getElementById(id).value);

  if (selectedLocations.some((value) => !value) || selectedAwards.some((value) => !value)) {
    alert('請選取 3 個地點與 3 個獎勵條件');
    return;
  }

  if (new Set(selectedLocations).size !== 3) {
    alert('請選擇 3 個不同的地點');
    return;
  }

  if (new Set(selectedAwards).size !== 3) {
    alert('請選擇 3 個不同的獎勵條件');
    return;
  }

  const formData = {
    eventId,
    name: document.getElementById('eventName').value,
    type: document.getElementById('eventType').value,
    date: document.getElementById('eventDate').value,
    time: document.getElementById('eventTime').value,
    votingDue: document.getElementById('votingDue').value,
    selectedLocations,
    selectedAwards
  };

  try {
    const response = await authorizedFetch(`/api/events/${eventId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (response.ok) {
      eventForm.style.display = 'none';
      await loadAppData();
    } else {
      const result = await response.json();
      alert(result.message || '儲存活動失敗');
    }
  } catch (error) {
    console.error('儲存活動失敗:', error);
    alert('儲存活動失敗');
  }
});

function renderLocations() {
  if (!appData.locations || Object.keys(appData.locations).length === 0) {
    locationsList.innerHTML = '<p class="empty-state">目前沒有地點資料</p>';
    return;
  }

  // 將地點轉換為陣列並按ID排序（新地點通常有更大的ID）
  const locationsArray = Object.values(appData.locations).sort((a, b) => {
    // 如果ID包含時間戳，則按時間戳排序
    const aTimestamp = a.id.includes('_') ? parseInt(a.id.split('_')[1]) : 0;
    const bTimestamp = b.id.includes('_') ? parseInt(b.id.split('_')[1]) : 0;
    return bTimestamp - aTimestamp; // 新地點在前
  });

  locationsList.innerHTML = locationsArray.map((location) => `
    <div class="location-item">
      <div class="location-info">
        <h3>${location.name}</h3>
        <p>類型: ${location.type} | 座標: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}</p>
      </div>
      <div class="location-actions">
        <button class="btn-edit" type="button" onclick="editLocation('${location.id}')">編輯</button>
        <button class="btn-delete" type="button" onclick="deleteLocation('${location.id}')">刪除</button>
      </div>
    </div>
  `).join('');
}

function editLocation(locationId) {
  const location = appData.locations[locationId];
  if (location) {
    showLocationForm(location);
  }
}

function deleteLocation(locationId) {
  alert('刪除功能尚未實作，請改用資料庫管理介面。');
}

function showLocationForm(location = null) {
  populateLocationTypeOptions(location ? location.type : '');

  if (location) {
    // 編輯模式：直接顯示表單
    locationFormTitle.textContent = '編輯地點';
    document.getElementById('locationId').value = location.id;
    document.getElementById('locationName').value = location.name;
    document.getElementById('locationType').value = location.type;
    document.getElementById('latitude').value = location.lat;
    document.getElementById('longitude').value = location.lng;
    locationForm.style.display = 'block';
    setTimeout(initLocationMap, 100);
  } else {
    // 新增模式：先顯示地圖選取介面
    showLocationMapSelector();
  }
}

function showLocationFormWithCoordinates(lat, lng) {
  locationFormTitle.textContent = '新增地點';
  locationEditForm.reset();
  document.getElementById('locationId').value = '';
  document.getElementById('latitude').value = lat.toFixed(6);
  document.getElementById('longitude').value = lng.toFixed(6);
  populateLocationTypeOptions('');
  locationForm.style.display = 'block';
  setTimeout(initLocationMap, 100);
}

function showLocationMapSelector() {
  // 創建地圖選取模態框
  const modal = document.createElement('div');
  modal.id = 'locationMapModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>請在地圖上點選地點</h3>
        <span class="modal-close">&times;</span>
      </div>
      <div class="modal-body">
        <div id="locationSelectorMap" style="height: 400px; width: 100%;"></div>
        <div class="selected-coordinates">
          <p>選取的座標：<span id="selectedLat">尚未選取</span>, <span id="selectedLng">尚未選取</span></p>
        </div>
      </div>
      <div class="modal-footer">
        <button id="confirmLocationBtn" class="btn-primary" disabled>確認選取</button>
        <button id="cancelMapBtn" class="btn-secondary">取消</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // 初始化地圖：預設顯示台中823公園
  const defaultLat = 24.1875;
  const defaultLng = 120.6890;

  const map = new google.maps.Map(document.getElementById('locationSelectorMap'), {
    center: { lat: defaultLat, lng: defaultLng },
    zoom: 15,
  });

  let selectedMarker = null;
  let selectedLat = null;
  let selectedLng = null;

  // 點擊地圖來選取位置
  map.addListener('click', (event) => {
    const lat = event.latLng.lat();
    const lng = event.latLng.lng();

    // 移除之前的marker
    if (selectedMarker) {
      selectedMarker.setMap(null);
    }

    // 創建新marker
    selectedMarker = new google.maps.Marker({
      position: { lat, lng },
      map,
    });

    // 更新選取的座標
    selectedLat = lat;
    selectedLng = lng;
    document.getElementById('selectedLat').textContent = lat.toFixed(6);
    document.getElementById('selectedLng').textContent = lng.toFixed(6);
    document.getElementById('confirmLocationBtn').disabled = false;
  });

  // 確認選取按鈕
  document.getElementById('confirmLocationBtn').addEventListener('click', () => {
    if (selectedLat && selectedLng) {
      // 關閉模態框
      document.body.removeChild(modal);
      // 顯示表單並設定座標
      showLocationFormWithCoordinates(selectedLat, selectedLng);
    }
  });

  // 取消按鈕
  document.getElementById('cancelMapBtn').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // 關閉按鈕
  modal.querySelector('.modal-close').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // 顯示模態框
  modal.style.display = 'block';
}

function initLocationMap() {
  const lat = parseFloat(document.getElementById('latitude').value) || 25.0330;
  const lng = parseFloat(document.getElementById('longitude').value) || 121.5654;

  const map = new google.maps.Map(document.getElementById('locationMap'), {
    center: { lat, lng },
    zoom: 15,
  });

  const marker = new google.maps.Marker({
    position: { lat, lng },
    map,
    draggable: true,
  });

  marker.addListener('dragend', (event) => {
    document.getElementById('latitude').value = event.latLng.lat().toFixed(6);
    document.getElementById('longitude').value = event.latLng.lng().toFixed(6);
  });

  ['latitude', 'longitude'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      const newLat = parseFloat(document.getElementById('latitude').value);
      const newLng = parseFloat(document.getElementById('longitude').value);
      if (!isNaN(newLat) && !isNaN(newLng)) {
        const position = new google.maps.LatLng(newLat, newLng);
        marker.setPosition(position);
        map.setCenter(position);
      }
    });
  });
}

locationEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const locationId = document.getElementById('locationId').value || `loc_${Date.now()}`;
  const formData = {
    locationId,
    name: document.getElementById('locationName').value,
    type: document.getElementById('locationType').value,
    lat: parseFloat(document.getElementById('latitude').value),
    lng: parseFloat(document.getElementById('longitude').value),
  };

  try {
    const response = await authorizedFetch(`/api/locations/${locationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (response.ok) {
      locationForm.style.display = 'none';
      await loadAppData();
    } else {
      alert('儲存地點失敗');
    }
  } catch (error) {
    console.error('儲存地點失敗:', error);
    alert('儲存地點失敗');
  }
});

function renderStats() {
  if (!appData.currentEvent) {
    statsContainer.innerHTML = '<p class="empty-state">目前沒有進行中的活動</p>';
    return;
  }

  const totalVotes = Object.values(appData.voteStats || {}).reduce((sum, stat) => sum + (stat.count || 0), 0);
  const rows = Object.entries(appData.voteStats || {}).map(([locationId, stats]) => {
    const location = appData.locations[locationId];
    return `
      <div class="stat-item">
        <h4>${location ? location.name : locationId}</h4>
        <p>票數: ${stats.count || 0}</p>
        ${stats.awards ? Object.entries(stats.awards).map(([award, count]) => `<p>${award}: ${count} 票</p>`).join('') : ''}
      </div>
    `;
  }).join('');

  statsContainer.innerHTML = `
    <div class="stats-summary">
      <h3>${appData.currentEvent.event_name} - 投票統計</h3>
      <p>總投票數: ${totalVotes}</p>
    </div>
    <div class="stats-details">
      ${rows}
    </div>
  `;
}

function renderVoteRecords() {
  if (!voteRecordsContainer) return;
  const rows = appData.voteRecords || [];
  if (rows.length === 0) {
    voteRecordsContainer.innerHTML = '<p class="empty-state">目前沒有投票紀錄</p>';
    return;
  }

  voteRecordsContainer.innerHTML = `
    <div class="records-table-wrap">
      <table class="records-table">
        <thead>
          <tr>
            <th>時間</th>
            <th>活動</th>
            <th>名字</th>
            <th>遊戲ID</th>
            <th>來源地</th>
            <th>投票地點</th>
            <th>獎勵條件</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${row.votingDatetime ? new Date(row.votingDatetime).toLocaleString('zh-TW') : '-'}</td>
              <td>${row.eventName || row.eventId || '-'}</td>
              <td>${row.userName || '-'}</td>
              <td>${row.userGameId || '-'}</td>
              <td>${row.userLocation || '-'}</td>
              <td>${row.votingLocationName || row.votingLocationId || '-'}</td>
              <td>${row.votingAwardDesc || row.votingAwardId || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

refreshStatsBtn.addEventListener('click', () => {
  loadAppData();
});

refreshRecordsBtn.addEventListener('click', () => {
  loadVoteRecords();
});

socket.on('locations-update', (locations) => {
  if (!isLoggedIn) return;
  appData.locations = locations;
  renderLocations();
});

socket.on('event-update', (event) => {
  if (!isLoggedIn) return;
  appData.currentEvent = event;
  renderEvents();
  renderStats();
});

socket.on('vote-stats-update', () => {
  if (!isLoggedIn) return;
  loadVoteRecords();
});

window.addEventListener('load', async () => {
  showLoginScreen();
  try {
    await initSupabaseClient();
    const token = await getAccessToken();
    if (!token) return;
    await verifyAdminAccess();
    showAdminPanel();
    loginError.textContent = '';
    await loadAppData();
  } catch (error) {
    console.warn('尚未建立有效 admin session:', error.message || error);
    showLoginScreen();
  }
});
