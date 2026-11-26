const cfg = window.DAIGOU_CONFIG || {};
const isConfigured =
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes('YOUR_PROJECT_ID') &&
  !cfg.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY');

const sb = isConfigured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const state = {
  trip: {
    title: '東京代購許願池 🇯🇵',
    traveler: '小琳',
    dates: '即將出發・歡迎大家許願',
    note: '看到想買的直接上傳照片＋寫名字，想要的也可以在別人底下按 +1！',
    exchange_rate: 0.215,
  },
  items: [],
  statusFilter: 'all',
  personFilter: 'all',
  categoryFilter: 'all',
  search: '',
  nickname: localStorage.getItem('daigou_nickname') || '',
  pendingBlob: null,
};

const STATUS_LABELS = {
  pending: '🛒 待購買',
  bought: '✅ 已買到',
  unavailable: '❌ 缺貨',
};

const NEXT_STATUS = {
  pending: 'bought',
  bought: 'unavailable',
  unavailable: 'pending',
};

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureNickname() {
  let name = state.nickname.trim();
  if (!name) {
    name = (window.prompt('請先輸入你的暱稱（之後發文或 +1 會自動帶入）：') || '').trim();
    if (name) {
      state.nickname = name;
      localStorage.setItem('daigou_nickname', name);
      $('myNicknameInput').value = name;
    }
  }
  return name;
}

async function loadData() {
  if (!sb) {
    $('setupBanner').classList.remove('hidden');
    renderAll();
    return;
  }

  const [{ data: tripData, error: tripErr }, { data: itemsData, error: itemsErr }] = await Promise.all([
    sb.from('trip_settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('daigou_items').select('*').order('created_at', { ascending: false }),
  ]);

  if (tripErr) showToast('讀取旅程設定失敗：' + tripErr.message);
  if (itemsErr) showToast('讀取清單失敗：' + itemsErr.message);

  if (tripData) state.trip = tripData;
  state.items = itemsData || [];
  renderAll();
}

function renderTrip() {
  $('tripTitle').textContent = state.trip.title;
  $('tripTraveler').textContent = state.trip.traveler;
  $('tripDatesBadge').textContent = state.trip.dates || '日本之旅';
  $('tripNote').textContent = state.trip.note || '';
  $('tripRate').textContent = state.trip.exchange_rate || 0.215;
}

function getAllPeople() {
  const set = new Set();
  state.items.forEach((item) => {
    if (item.requester) set.add(item.requester);
    (item.plus_ones || []).forEach((p) => {
      if (p.name) set.add(p.name);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

function renderStatsAndFilters() {
  const totalItems = state.items.length;
  const totalUnits = state.items.reduce((sum, item) => {
    const plusCount = (item.plus_ones || []).reduce((s, p) => s + (p.count || 1), 0);
    return sum + (item.quantity || 1) + plusCount;
  }, 0);
  const boughtItems = state.items.filter((i) => i.status === 'bought').length;

  $('statTotalItems').textContent = totalItems;
  $('statTotalUnits').textContent = totalUnits;
  $('statBoughtItems').textContent = boughtItems;

  const select = $('personFilter');
  const current = state.personFilter;
  const people = getAllPeople();
  select.innerHTML =
    '<option value="all">所有人</option>' +
    people.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  if (people.includes(current)) {
    select.value = current;
  } else {
    state.personFilter = 'all';
    select.value = 'all';
  }
}

function getFilteredItems() {
  const q = state.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.statusFilter !== 'all' && item.status !== state.statusFilter) return false;
    if (state.categoryFilter !== 'all' && item.category !== state.categoryFilter) return false;
    if (state.personFilter !== 'all') {
      const involved =
        item.requester === state.personFilter ||
        (item.plus_ones || []).some((p) => p.name === state.personFilter);
      if (!involved) return false;
    }
    if (q) {
      const haystack = [
        item.title,
        item.requester,
        item.store,
        item.note,
        item.category,
        ...(item.plus_ones || []).map((p) => p.name),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function renderItems() {
  const grid = $('itemsGrid');
  const empty = $('emptyState');
  const items = getFilteredItems();

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const rate = Number(state.trip?.exchange_rate) || 0.215;
  const me = state.nickname.trim().toLowerCase();

  grid.innerHTML = items
    .map((item) => {
      const plusOnes = item.plus_ones || [];
      const totalUnits = (item.quantity || 1) + plusOnes.reduce((s, p) => s + (p.count || 1), 0);
      const myPlus = me ? plusOnes.find((p) => p.name.toLowerCase() === me) : null;
      const priceText = item.price_jpy
        ? `¥${item.price_jpy.toLocaleString()} (約 NT$${Math.round(item.price_jpy * rate).toLocaleString()})`
        : '';

      const photoHtml = item.image_url
        ? `<div class="card-photo-wrap" data-zoom="${escapeHtml(item.image_url)}">
             <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" loading="lazy" />
             <button class="status-badge status-${item.status}" data-action="cycle-status" data-id="${item.id}" title="點擊切換購買狀態">${STATUS_LABELS[item.status]}</button>
             <button class="card-delete-btn" data-action="delete" data-id="${item.id}" title="刪除項目">✕</button>
           </div>`
        : `<div class="card-photo-wrap no-photo">
             <span>📷 尚未上傳照片</span>
             <button class="status-badge status-${item.status}" data-action="cycle-status" data-id="${item.id}" title="點擊切換購買狀態">${STATUS_LABELS[item.status]}</button>
             <button class="card-delete-btn" data-action="delete" data-id="${item.id}" title="刪除項目">✕</button>
           </div>`;

      const plusChipsHtml = plusOnes
        .map((p) => {
          const isMe = me && p.name.toLowerCase() === me;
          return `<span class="plus-chip ${isMe ? 'is-me' : ''}">+1 ${escapeHtml(p.name)}${p.count > 1 ? ` ×${p.count}` : ''}</span>`;
        })
        .join('');

      const commentsHtml = (item.comments || [])
        .map(
          (c) =>
            `<div class="comment-item"><strong>${escapeHtml(c.author)}:</strong>${escapeHtml(c.text)}</div>`
        )
        .join('');

      return `
        <article class="item-card is-${item.status}">
          ${photoHtml}
          <div class="card-body">
            <div class="card-meta-top">
              <span class="cat-tag">${escapeHtml(item.category || '其他')}</span>
              <span>${item.store ? `📍 ${escapeHtml(item.store)}` : ''}</span>
            </div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            ${priceText ? `<div class="card-details"><span>💴 ${priceText}</span></div>` : ''}
            ${item.note ? `<p class="card-note">${escapeHtml(item.note)}</p>` : ''}

            <div class="plus-one-box">
              <div class="requester-line">
                <span class="requester-pill">🙋 發起人：${escapeHtml(item.requester)} ×${item.quantity || 1}</span>
                <span class="total-count-badge">共 ${totalUnits} 件</span>
              </div>
              ${plusChipsHtml ? `<div class="plus-chips">${plusChipsHtml}</div>` : ''}
              <div class="plus-actions">
                <button class="btn-plus" data-action="plus-one" data-id="${item.id}">
                  ${myPlus ? `＋1 再加一件 (已 +${myPlus.count})` : '＋1 我也要'}
                </button>
                ${
                  myPlus
                    ? `<button class="btn-minus" data-action="minus-one" data-id="${item.id}" title="減少一件">-1</button>`
                    : ''
                }
              </div>
            </div>

            <div class="comments-section">
              ${commentsHtml ? `<div class="comment-list">${commentsHtml}</div>` : ''}
              <form class="comment-form" data-id="${item.id}">
                <input type="text" placeholder="底下留言備註..." required />
                <button type="submit">送出</button>
              </form>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderAll() {
  renderTrip();
  renderStatsAndFilters();
  renderItems();
}

function compressImageToBlob(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve({ blob, previewUrl: canvas.toDataURL('image/jpeg', 0.82) });
            else reject(new Error('圖片壓縮失敗'));
          },
          'image/jpeg',
          0.82
        );
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleSelectedFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('請選擇圖片檔案');
    return;
  }
  try {
    const { blob, previewUrl } = await compressImageToBlob(file);
    state.pendingBlob = blob;
    $('uploadPreviewImg').src = previewUrl;
    $('uploadPlaceholder').classList.add('hidden');
    $('uploadPreviewWrap').classList.remove('hidden');
  } catch {
    showToast('圖片讀取失敗，請換一張試試');
  }
}

function resetUpload() {
  state.pendingBlob = null;
  $('photoInput').value = '';
  $('uploadPreviewImg').src = '';
  $('uploadPreviewWrap').classList.add('hidden');
  $('uploadPlaceholder').classList.remove('hidden');
}

function renderSummary() {
  const rate = Number(state.trip?.exchange_rate) || 0.215;
  const byPerson = new Map();

  const addEntry = (person, item, count) => {
    if (!byPerson.has(person)) byPerson.set(person, []);
    byPerson.get(person).push({
      title: item.title,
      count,
      status: item.status,
      priceJpy: item.price_jpy,
    });
  };

  state.items.forEach((item) => {
    addEntry(item.requester, item, item.quantity || 1);
    (item.plus_ones || []).forEach((p) => addEntry(p.name, item, p.count || 1));
  });

  if (byPerson.size === 0) {
    $('summaryBody').innerHTML = '<p>目前還沒有任何代購項目。</p>';
    return;
  }

  let html = '';
  for (const [person, entries] of byPerson.entries()) {
    const totalCount = entries.reduce((s, e) => s + e.count, 0);
    const estJpy = entries.reduce((s, e) => s + (e.priceJpy ? e.priceJpy * e.count : 0), 0);
    html += `
      <div class="summary-person-card">
        <div class="summary-person-head">
          <span>🙋 ${escapeHtml(person)}</span>
          <span>共 ${totalCount} 件 ${estJpy > 0 ? `・預估 ¥${estJpy.toLocaleString()} (約 NT$${Math.round(estJpy * rate).toLocaleString()})` : ''}</span>
        </div>
        <ul class="summary-list">
          ${entries
            .map(
              (e) =>
                `<li>${STATUS_LABELS[e.status]} <strong>${escapeHtml(e.title)}</strong> ×${e.count}</li>`
            )
            .join('')}
        </ul>
      </div>
    `;
  }
  $('summaryBody').innerHTML = html;
}

$('myNicknameInput').value = state.nickname;
$('myNicknameInput').addEventListener('input', (e) => {
  state.nickname = e.target.value;
  localStorage.setItem('daigou_nickname', state.nickname);
  renderItems();
});

$('statusFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.statusFilter = btn.dataset.status;
  renderItems();
});

$('personFilter').addEventListener('change', (e) => {
  state.personFilter = e.target.value;
  renderItems();
});

$('categoryFilter').addEventListener('change', (e) => {
  state.categoryFilter = e.target.value;
  renderItems();
});

$('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderItems();
});

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden'));
});

$('openAddBtn').addEventListener('click', () => {
  if (!sb) return showToast('請先設定 config.js 中的 Supabase 連線資訊');
  $('itemRequester').value = state.nickname;
  $('addModal').classList.remove('hidden');
});

$('summaryBtn').addEventListener('click', () => {
  renderSummary();
  $('summaryModal').classList.remove('hidden');
});

$('editTripBtn').addEventListener('click', () => {
  if (!sb) return showToast('請先設定 config.js 中的 Supabase 連線資訊');
  $('editTripTitle').value = state.trip.title;
  $('editTripTraveler').value = state.trip.traveler;
  $('editTripRate').value = state.trip.exchange_rate;
  $('editTripDates').value = state.trip.dates;
  $('editTripNote').value = state.trip.note;
  $('tripModal').classList.remove('hidden');
});

$('uploadZone').addEventListener('click', (e) => {
  if (e.target.id === 'removePhotoBtn') return;
  $('photoInput').click();
});
$('photoInput').addEventListener('change', (e) => {
  if (e.target.files[0]) handleSelectedFile(e.target.files[0]);
});
$('uploadZone').addEventListener('dragover', (e) => {
  e.preventDefault();
  $('uploadZone').classList.add('dragover');
});
$('uploadZone').addEventListener('dragleave', () => $('uploadZone').classList.remove('dragover'));
$('uploadZone').addEventListener('drop', (e) => {
  e.preventDefault();
  $('uploadZone').classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleSelectedFile(e.dataTransfer.files[0]);
});
$('removePhotoBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  resetUpload();
});

$('addItemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return;
  const requester = $('itemRequester').value.trim();
  if (requester && !state.nickname) {
    state.nickname = requester;
    localStorage.setItem('daigou_nickname', requester);
    $('myNicknameInput').value = requester;
  }

  const btn = $('submitItemBtn');
  btn.disabled = true;
  try {
    let imageUrl = '';
    if (state.pendingBlob) {
      const filePath = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error: uploadErr } = await sb.storage
        .from('daigou-photos')
        .upload(filePath, state.pendingBlob, { contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = sb.storage.from('daigou-photos').getPublicUrl(filePath);
      imageUrl = urlData.publicUrl;
    }

    const { error } = await sb.from('daigou_items').insert({
      title: $('itemTitle').value.trim(),
      requester,
      category: $('itemCategory').value,
      quantity: Number($('itemQty').value) || 1,
      price_jpy: $('itemPrice').value ? Number($('itemPrice').value) : null,
      store: $('itemStore').value.trim(),
      note: $('itemNote').value.trim(),
      image_url: imageUrl,
    });
    if (error) throw error;

    $('addItemForm').reset();
    resetUpload();
    $('addModal').classList.add('hidden');
    showToast('已新增到代購清單！');
    await loadData();
  } catch (err) {
    showToast(err.message || '新增失敗');
  } finally {
    btn.disabled = false;
  }
});

$('tripForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return;
  try {
    const { error } = await sb
      .from('trip_settings')
      .update({
        title: $('editTripTitle').value.trim(),
        traveler: $('editTripTraveler').value.trim(),
        exchange_rate: Number($('editTripRate').value),
        dates: $('editTripDates').value.trim(),
        note: $('editTripNote').value.trim(),
      })
      .eq('id', 1);
    if (error) throw error;
    $('tripModal').classList.add('hidden');
    showToast('旅程設定已更新');
    await loadData();
  } catch (err) {
    showToast(err.message || '更新失敗');
  }
});

$('itemsGrid').addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    if (!sb) return;
    const id = actionBtn.dataset.id;
    const action = actionBtn.dataset.action;

    if (action === 'plus-one' || action === 'minus-one') {
      const name = ensureNickname();
      if (!name) return;
      const delta = action === 'plus-one' ? 1 : -1;
      const { error } = await sb.rpc('update_plus_one', {
        target_id: id,
        user_name: name,
        delta,
      });
      if (error) return showToast(error.message);
      showToast(delta > 0 ? `${name} +1 成功！` : '已調整數量');
      await loadData();
      return;
    }

    if (action === 'cycle-status') {
      const item = state.items.find((i) => i.id === id);
      if (!item) return;
      const nextStatus = NEXT_STATUS[item.status] || 'pending';
      const { error } = await sb.from('daigou_items').update({ status: nextStatus }).eq('id', id);
      if (error) return showToast(error.message);
      showToast(`狀態已更新為：${STATUS_LABELS[nextStatus]}`);
      await loadData();
      return;
    }

    if (action === 'delete') {
      if (!window.confirm('確定要刪除這個代購項目嗎？')) return;
      const { error } = await sb.from('daigou_items').delete().eq('id', id);
      if (error) return showToast(error.message);
      showToast('已刪除項目');
      await loadData();
      return;
    }
  }

  const zoomEl = e.target.closest('[data-zoom]');
  if (zoomEl) {
    $('lightboxImg').src = zoomEl.dataset.zoom;
    $('lightbox').classList.remove('hidden');
  }
});

$('itemsGrid').addEventListener('submit', async (e) => {
  const form = e.target.closest('.comment-form');
  if (!form || !sb) return;
  e.preventDefault();
  const author = ensureNickname();
  if (!author) return;
  const input = form.querySelector('input');
  const text = input.value.trim();
  if (!text) return;

  const { error } = await sb.rpc('add_item_comment', {
    target_id: form.dataset.id,
    author_name: author,
    comment_text: text,
  });
  if (error) return showToast(error.message);
  input.value = '';
  await loadData();
});

$('lightbox').addEventListener('click', () => {
  $('lightbox').classList.add('hidden');
});

loadData();
