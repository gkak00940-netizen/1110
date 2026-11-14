'use strict';

// 사진은 서버나 갤러리로 자동 전송하지 않고 브라우저 보관함에 넣어요.
const DB_NAME = 'sand-field-photos-v1';
const PREF_KEY = 'sand-field-photos-prefs-v1';
const MAX_SHARE = 10;
const $ = id => document.getElementById(id);
let db;
let sites = [];
let photos = [];
let currentSite = '';
let stream = null;
let pendingCamera = false;
let cameraRequest = 0;
let busy = false;
let urls = [];
let largeUrl = '';
let pendingDelete = [];
const selected = new Set();

function notice(text, error = false) {
  $('notice').textContent = text;
  $('notice').className = error ? 'notice error' : 'notice';
}

function sizeLabel(bytes) {
  if (!bytes) return '0킬로바이트';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ko-KR')}킬로바이트` : `${(bytes / 1024 / 1024).toLocaleString('ko-KR', { maximumFractionDigits:1 })}메가바이트`;
}

function dateLabel(value) {
  return new Date(value).toLocaleString('ko-KR', { timeZone:'Asia/Seoul', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ site:currentSite, quality:$('quality').value, memo:$('photo-memo').value })); }
  catch { notice('설정을 저장하지 못했어요. 사진 보관 상태는 아래에서 확인해 주세요.', true); }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('sites', { keyPath:'id' });
      const store = database.createObjectStore('photos', { keyPath:'id' });
      store.createIndex('site', 'site');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => notice('다른 창의 현장 사진함을 닫고 다시 열어 주세요.', true);
  });
}

function readAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 저장 완료를 확인한 뒤에만 화면에 보관된 사진으로 표시해요.
function write(storeName, operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('보관 작업을 완료하지 못했어요.'));
  });
}

function currentPhotos() { return photos.filter(photo => photo.site === currentSite).sort((a, b) => b.created - a.created); }
function selectedPhotos() { return currentPhotos().filter(photo => selected.has(photo.id)); }

function controls() {
  $('start-camera').disabled = busy || pendingCamera || !db || !currentSite;
  $('capture').disabled = busy || !stream || !$('camera').videoWidth || !currentSite;
  $('site').disabled = busy || pendingCamera;
  $('site-name').disabled = busy || pendingCamera || !db;
  $('add-site').disabled = busy || pendingCamera || !db;
  $('quality').disabled = busy;
  $('photo-memo').disabled = busy;
  const count = selectedPhotos().length;
  $('selection-count').textContent = `선택한 사진 ${count}장`;
  ['share', 'copy-caption', 'delete-selected', 'clear-selection'].forEach(id => { $(id).disabled = busy || !count; });
  $('select-batch').disabled = busy || !currentPhotos().length;
  document.querySelectorAll('.photo input').forEach(input => { input.disabled = busy; });
}

function renderSites() {
  $('site').replaceChildren();
  if (!sites.length) {
    const option = new Option('현장을 먼저 만들어 주세요', '');
    $('site').append(option);
  }
  sites.forEach(site => $('site').append(new Option(site.name, site.id)));
  $('site').value = currentSite;
}

function renderPhotos() {
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  $('photos').replaceChildren();
  const shown = currentPhotos();
  const valid = new Set(shown.map(photo => photo.id));
  [...selected].forEach(id => { if (!valid.has(id)) selected.delete(id); });
  $('album-title').textContent = currentSite ? `${sites.find(site => site.id === currentSite)?.name || '현장'} 사진` : '현장 사진';
  $('album-count').textContent = `${shown.length}장`;
  $('storage-info').textContent = `이 현장 ${sizeLabel(shown.reduce((sum, photo) => sum + photo.blob.size, 0))} · 전체 ${photos.length}장, ${sizeLabel(photos.reduce((sum, photo) => sum + photo.blob.size, 0))}`;
  $('empty').hidden = !!shown.length;
  shown.forEach(photo => {
    const card = document.createElement('article'); card.className = selected.has(photo.id) ? 'photo selected' : 'photo';
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(photo.id);
    checkbox.setAttribute('aria-label', `${dateLabel(photo.created)} 사진 선택`);
    label.append(checkbox, document.createTextNode('선택'));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selected.size >= MAX_SHARE) { checkbox.checked = false; notice('한 번에 최대 10장까지 선택해 주세요.', true); return; }
      if (checkbox.checked) selected.add(photo.id); else selected.delete(photo.id);
      card.classList.toggle('selected', checkbox.checked); controls();
    });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'photo-open';
    button.setAttribute('aria-label', `${dateLabel(photo.created)} 사진 크게 보기`);
    const image = document.createElement('img');
    const url = URL.createObjectURL(photo.blob); urls.push(url);
    image.src = url; image.alt = photo.memo || '보관한 현장 사진'; image.loading = 'lazy'; button.append(image);
    button.addEventListener('click', () => {
      largeUrl = URL.createObjectURL(photo.blob); $('large-photo').src = largeUrl;
      $('large-caption').textContent = `${dateLabel(photo.created)}\n${photo.memo || '설명 없음'}\n${sizeLabel(photo.blob.size)}`;
      $('photo-dialog').showModal();
    });
    const time = document.createElement('p'); time.className = 'photo-time'; time.textContent = dateLabel(photo.created);
    const memo = document.createElement('p'); memo.textContent = photo.memo || '설명 없음';
    card.append(label, button, time, memo); $('photos').append(card);
  });
  controls();
}

function stopCamera() {
  cameraRequest++;
  pendingCamera = false;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  $('camera').srcObject = null;
  $('camera').hidden = true; $('camera-placeholder').hidden = false;
  $('start-camera').hidden = false; $('stop-camera').hidden = true; $('capture').hidden = true;
  controls();
}

$('site-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !db) return;
  const name = $('site-name').value.trim();
  if (!name) { notice('현장 이름을 입력해 주세요.', true); $('site-name').focus(); return; }
  const existing = sites.find(site => site.name === name);
  if (existing) { currentSite = existing.id; selected.clear(); renderSites(); renderPhotos(); savePrefs(); notice('이미 있는 현장을 열었어요.'); return; }
  busy = true; controls();
  try {
    const site = { id:crypto.randomUUID(), name, created:Date.now() };
    await write('sites', store => store.add(site));
    sites.push(site); currentSite = site.id; selected.clear(); $('site-name').value = '';
    renderSites(); savePrefs(); notice('현장을 만들었어요. 카메라를 켜고 사진을 찍어 보세요.');
  } catch { notice('현장을 저장하지 못했어요. 브라우저의 저장 공간을 확인해 주세요.', true); }
  finally { busy = false; renderPhotos(); }
});
$('site').addEventListener('change', () => { currentSite = $('site').value; selected.clear(); savePrefs(); renderPhotos(); });
$('quality').addEventListener('change', savePrefs);
$('photo-memo').addEventListener('input', savePrefs);
$('camera').addEventListener('loadeddata', controls);

$('start-camera').addEventListener('click', async () => {
  if (!currentSite || pendingCamera || busy) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { notice('안전한 공개 주소를 갤럭시 크롬에서 열어 주세요. 이 화면에서는 카메라를 사용할 수 없어요.', true); return; }
  const requestId = ++cameraRequest;
  pendingCamera = true; controls(); notice('카메라 사용을 허용해 주세요.');
  try {
    const opened = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ ideal:2560 }, height:{ ideal:1920 } } });
    if (requestId !== cameraRequest || document.hidden) { opened.getTracks().forEach(track => track.stop()); return; }
    stream = opened; $('camera').srcObject = stream;
    $('camera').hidden = false; $('camera-placeholder').hidden = true;
    $('start-camera').hidden = true; $('stop-camera').hidden = false; $('capture').hidden = false;
    await $('camera').play(); notice('준비됐어요. 사진을 찍으면 선택한 현장에 보관해요.');
  } catch (error) {
    stopCamera();
    const message = error.name === 'NotAllowedError' ? '카메라 권한이 필요해요. 브라우저의 사이트 설정에서 카메라를 허용해 주세요.' : error.name === 'NotFoundError' ? '카메라를 찾지 못했어요. 카메라가 있는 휴대폰에서 열어 주세요.' : '카메라를 켜지 못했어요. 다른 앱의 카메라를 닫은 뒤 다시 시도해 주세요.';
    notice(message, true);
  } finally { pendingCamera = false; controls(); }
});
$('stop-camera').addEventListener('click', () => { stopCamera(); notice('카메라를 껐어요. 보관한 사진은 그대로 있어요.'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', stopCamera);

$('capture').addEventListener('click', async () => {
  if (!stream || busy || !$('camera').videoWidth) return;
  busy = true; controls(); notice('사진을 보관하고 있어요…');
  const site = currentSite; const memo = $('photo-memo').value.trim(); const created = Date.now();
  try {
    const video = $('camera'); const maxEdge = $('quality').value === 'clear' ? 2560 : 1600;
    const ratio = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', $('quality').value === 'clear' ? 0.9 : 0.8));
    if (!blob) throw new Error('사진을 만들지 못했어요.');
    const photo = { id:crypto.randomUUID(), site, memo, created, blob, width:canvas.width, height:canvas.height };
    await write('photos', store => store.add(photo)); photos.push(photo);
    notice(`사진을 보관했어요. ${sizeLabel(blob.size)} · 갤러리에는 따로 저장하지 않았어요.`);
  } catch { notice('사진을 보관하지 못했어요. 휴대폰 저장 공간을 확인하고 다시 찍어 주세요.', true); }
  finally { busy = false; renderPhotos(); }
});

$('select-batch').addEventListener('click', () => { selected.clear(); currentPhotos().slice(0, MAX_SHARE).forEach(photo => selected.add(photo.id)); renderPhotos(); });
$('clear-selection').addEventListener('click', () => { selected.clear(); renderPhotos(); });

function captionText(picked) {
  const name = sites.find(site => site.id === currentSite)?.name || '현장';
  return `[${name}] 현장 사진 ${picked.length}장\n${picked.map((photo, index) => `${index + 1}. ${dateLabel(photo.created)}${photo.memo ? ` · ${photo.memo}` : ''}`).join('\n')}`;
}

$('share').addEventListener('click', async () => {
  if (busy) return;
  const picked = selectedPhotos(); if (!picked.length) return;
  const siteName = (sites.find(site => site.id === currentSite)?.name || '현장').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const files = picked.map((photo, index) => new File([photo.blob], `${siteName}_${new Date(photo.created).toISOString().replace(/[:.]/g, '-')}_${index + 1}.jpg`, { type:'image/jpeg', lastModified:photo.created }));
  if (!navigator.share || !navigator.canShare?.({ files })) { notice('이 브라우저는 사진 묶음 공유를 지원하지 않아요. 갤럭시 크롬에서 열어 보시고, 그래도 안 되면 사진 수를 줄여 주세요.', true); return; }
  busy = true; controls();
  try {
    // 버튼을 누른 즉시 공유 화면을 열어요. 카카오톡 전송은 사용자가 마쳐요.
    await navigator.share({ files, title:siteName, text:captionText(picked) });
    notice('공유 앱에 사진을 전달했어요. 카카오톡 전송과 회사의 수신을 확인해 주세요. 사진은 그대로 보관했어요.');
  } catch (error) {
    notice(error.name === 'AbortError' ? '공유를 취소했어요. 사진은 그대로 보관돼 있어요.' : '공유하지 못했어요. 선택한 사진 수를 줄여 다시 시도해 주세요.', error.name !== 'AbortError');
  } finally { busy = false; controls(); }
});
$('copy-caption').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(captionText(selectedPhotos())); notice('현장 이름과 사진 설명을 복사했어요. 카카오톡에 붙여 넣어 주세요.'); }
  catch { notice('설명을 복사하지 못했어요. 브라우저에서 복사를 허용했는지 확인해 주세요.', true); }
});

$('delete-selected').addEventListener('click', () => {
  pendingDelete = selectedPhotos().map(photo => photo.id);
  if (!pendingDelete.length) return;
  $('delete-description').textContent = `선택한 사진 ${pendingDelete.length}장을 이 휴대폰의 앱 보관함에서 지워요.`;
  $('delete-dialog').showModal();
});
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
$('confirm-delete').addEventListener('click', async () => {
  if (busy || !pendingDelete.length) return;
  const ids = [...pendingDelete]; busy = true; controls(); $('confirm-delete').disabled = true; $('cancel-delete').disabled = true;
  try {
    await write('photos', store => ids.forEach(id => store.delete(id)));
    photos = photos.filter(photo => !ids.includes(photo.id)); ids.forEach(id => selected.delete(id));
    $('delete-dialog').close(); notice(`수신을 확인한 사진 ${ids.length}장을 앱 보관함에서 지웠어요.`);
  } catch { notice('사진을 지우지 못했어요. 보관함을 확인하고 다시 시도해 주세요.', true); }
  finally { pendingDelete = []; busy = false; $('confirm-delete').disabled = false; $('cancel-delete').disabled = false; renderPhotos(); }
});
$('close-photo').addEventListener('click', () => $('photo-dialog').close());
$('photo-dialog').addEventListener('close', () => { $('large-photo').removeAttribute('src'); if (largeUrl) URL.revokeObjectURL(largeUrl); largeUrl = ''; });

async function initialize() {
  controls();
  try {
    db = await openDatabase();
    db.onversionchange = () => { db.close(); notice('보관함이 변경됐어요. 화면을 새로 고쳐 주세요.', true); };
    [sites, photos] = await Promise.all([readAll('sites'), readAll('photos')]);
    try {
      const prefs = JSON.parse(localStorage.getItem(PREF_KEY));
      if (sites.some(site => site.id === prefs?.site)) currentSite = prefs.site;
      if (prefs?.quality === 'clear') $('quality').value = 'clear';
      if (typeof prefs?.memo === 'string') $('photo-memo').value = prefs.memo.slice(0, 120);
    } catch { /* 설정을 읽지 못해도 이미 보관한 사진은 다시 보여 줘요. */ }
    if (!currentSite && sites.length) currentSite = sites[0].id;
    renderSites(); renderPhotos();
    notice(sites.length ? '보관함을 열었어요. 현장을 고르고 사진을 찍거나 공유해 주세요.' : '먼저 현장 이름을 적고 현장 추가를 눌러 주세요.');
  } catch { db = null; controls(); notice('사진 보관함을 열지 못했어요. 일반 크롬 창에서 다시 열어 주세요. 비공개 모드에서는 보관이 제한될 수 있어요.', true); }
}
initialize();
