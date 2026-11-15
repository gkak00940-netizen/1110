'use strict';

// 사진은 서버나 갤러리로 자동 전송하지 않고 이 휴대폰의 브라우저 보관함에 넣어요.
// 예전 버전에서 찍은 사진도 그대로 보이도록 보관함 이름은 바꾸지 않아요.
const DB_NAME = 'sand-field-photos-v1';
const MAX_SHARE = 10;
const $ = id => document.getElementById(id);
let db;
let photos = [];
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
  if (!bytes) return '0KB';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('ko-KR')}KB` : `${(bytes / 1024 / 1024).toLocaleString('ko-KR', { maximumFractionDigits:1 })}MB`;
}

function dateLabel(value) {
  return new Date(value).toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false });
}

function fileStamp(value) {
  const d = new Date(value); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
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
    request.onblocked = () => notice('다른 창의 현장 사진을 닫고 다시 열어 주세요.', true);
  });
}

function readPhotos() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos').objectStore('photos').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 저장 완료를 확인한 뒤에만 화면에 보관된 사진으로 표시해요.
function writePhotos(operation) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', 'readwrite');
    operation(transaction.objectStore('photos'));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('보관 작업을 완료하지 못했어요.'));
  });
}

function sortedPhotos() { return [...photos].sort((a, b) => b.created - a.created); }
function selectedPhotos() { return sortedPhotos().filter(photo => selected.has(photo.id)); }

function controls() {
  $('start-camera').disabled = busy || pendingCamera || !db;
  $('capture').disabled = busy || !stream || !$('camera').videoWidth;
  const count = selectedPhotos().length;
  $('selection-count').textContent = `선택한 사진 ${count}장`;
  ['share', 'delete-selected', 'clear-selection'].forEach(id => { $(id).disabled = busy || !count; });
  $('select-batch').disabled = busy || !photos.length;
  document.querySelectorAll('.photo input').forEach(input => { input.disabled = busy; });
}

function renderPhotos() {
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  $('photos').replaceChildren();
  const shown = sortedPhotos();
  [...selected].forEach(id => { if (!shown.some(photo => photo.id === id)) selected.delete(id); });
  $('album-count').textContent = `${shown.length}장`;
  $('storage-info').textContent = shown.length ? `이 휴대폰에 ${shown.length}장, ${sizeLabel(shown.reduce((sum, photo) => sum + photo.blob.size, 0))} 보관 중 · 보낸 사진은 지워서 공간을 비워 주세요.` : '';
  $('empty').hidden = !!shown.length;
  shown.forEach(photo => {
    const card = document.createElement('article'); card.className = selected.has(photo.id) ? 'photo selected' : 'photo';
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(photo.id);
    checkbox.setAttribute('aria-label', `${dateLabel(photo.created)} 사진 선택`);
    label.append(checkbox);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && selected.size >= MAX_SHARE) { checkbox.checked = false; notice(`한 번에 최대 ${MAX_SHARE}장까지 선택할 수 있어요.`, true); return; }
      if (checkbox.checked) selected.add(photo.id); else selected.delete(photo.id);
      card.classList.toggle('selected', checkbox.checked); controls();
    });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'photo-open';
    button.setAttribute('aria-label', `${dateLabel(photo.created)} 사진 크게 보기`);
    const image = document.createElement('img');
    const url = URL.createObjectURL(photo.blob); urls.push(url);
    image.src = url; image.alt = ''; image.loading = 'lazy'; button.append(image);
    button.addEventListener('click', () => {
      largeUrl = URL.createObjectURL(photo.blob); $('large-photo').src = largeUrl;
      $('large-caption').textContent = `${dateLabel(photo.created)} · ${sizeLabel(photo.blob.size)}`;
      $('photo-dialog').showModal();
    });
    const time = document.createElement('p'); time.className = 'photo-time'; time.textContent = dateLabel(photo.created);
    card.append(button, label, time); $('photos').append(card);
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

$('camera').addEventListener('loadeddata', controls);

$('start-camera').addEventListener('click', async () => {
  if (pendingCamera || busy) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { notice('이 화면에서는 카메라를 쓸 수 없어요. 휴대폰 크롬에서 앱 주소를 열어 주세요.', true); return; }
  const requestId = ++cameraRequest;
  pendingCamera = true; controls(); notice('카메라 사용을 허용해 주세요.');
  try {
    const opened = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:{ ideal:'environment' }, width:{ ideal:2560 }, height:{ ideal:1920 } } });
    if (requestId !== cameraRequest || document.hidden) { opened.getTracks().forEach(track => track.stop()); return; }
    stream = opened; $('camera').srcObject = stream;
    $('camera').hidden = false; $('camera-placeholder').hidden = true;
    $('start-camera').hidden = true; $('stop-camera').hidden = false; $('capture').hidden = false;
    await $('camera').play(); notice('준비됐어요. 사진 찍기를 눌러 주세요.');
  } catch (error) {
    stopCamera();
    const message = error.name === 'NotAllowedError' ? '카메라 권한이 필요해요. 크롬의 사이트 설정에서 카메라를 허용해 주세요.' : error.name === 'NotFoundError' ? '카메라를 찾지 못했어요.' : '카메라를 켜지 못했어요. 다른 앱의 카메라를 닫고 다시 시도해 주세요.';
    notice(message, true);
  } finally { pendingCamera = false; controls(); }
});
$('stop-camera').addEventListener('click', () => { stopCamera(); notice('카메라를 껐어요. 찍은 사진은 그대로 있어요.'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
window.addEventListener('pagehide', stopCamera);

$('capture').addEventListener('click', async () => {
  if (!stream || busy || !$('camera').videoWidth) return;
  busy = true; controls();
  try {
    // 자동으로 사진 용량을 줄여서 보관해요.
    const video = $('camera'); const maxEdge = 1600;
    const ratio = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    if (!blob) throw new Error('사진을 만들지 못했어요.');
    const photo = { id:crypto.randomUUID(), site:'', memo:'', created:Date.now(), blob, width:canvas.width, height:canvas.height };
    await writePhotos(store => store.add(photo)); photos.push(photo);
    notice(`사진을 보관했어요. (${sizeLabel(blob.size)})`);
  } catch { notice('사진을 보관하지 못했어요. 휴대폰 저장 공간을 확인하고 다시 찍어 주세요.', true); }
  finally { busy = false; renderPhotos(); }
});

$('select-batch').addEventListener('click', () => { selected.clear(); sortedPhotos().slice(0, MAX_SHARE).forEach(photo => selected.add(photo.id)); renderPhotos(); });
$('clear-selection').addEventListener('click', () => { selected.clear(); renderPhotos(); });

// 휴대폰의 공유 화면을 열어요. 카카오톡, 메시지, 드라이브, 퀵 쉐어 등 설치된 앱을 모두 고를 수 있어요.
$('share').addEventListener('click', async () => {
  if (busy) return;
  const picked = selectedPhotos(); if (!picked.length) return;
  const files = picked.map((photo, index) => new File([photo.blob], `사진_${fileStamp(photo.created)}_${index + 1}.jpg`, { type:'image/jpeg', lastModified:photo.created }));
  if (!navigator.share || !navigator.canShare?.({ files })) { notice('이 브라우저는 사진 공유를 지원하지 않아요. 휴대폰 크롬에서 열어 주세요. 그래도 안 되면 사진 수를 줄여 주세요.', true); return; }
  busy = true; controls();
  try {
    // 사진만 보내요. 글을 함께 넣으면 일부 앱(메시지 등)에서 사진이 빠지는 경우가 있어요.
    await navigator.share({ files });
    notice('보낼 앱으로 사진을 넘겼어요. 받은 것을 확인한 뒤 지워 주세요.');
  } catch (error) {
    notice(error.name === 'AbortError' ? '공유를 취소했어요.' : '공유하지 못했어요. 사진 수를 줄여 다시 시도해 주세요.', error.name !== 'AbortError');
  } finally { busy = false; controls(); }
});

$('delete-selected').addEventListener('click', () => {
  pendingDelete = selectedPhotos().map(photo => photo.id);
  if (!pendingDelete.length) return;
  $('delete-description').textContent = `선택한 사진 ${pendingDelete.length}장을 이 휴대폰에서 지워요.`;
  $('delete-dialog').showModal();
});
$('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
$('confirm-delete').addEventListener('click', async () => {
  if (busy || !pendingDelete.length) return;
  const ids = [...pendingDelete]; busy = true; controls(); $('confirm-delete').disabled = true; $('cancel-delete').disabled = true;
  try {
    await writePhotos(store => ids.forEach(id => store.delete(id)));
    photos = photos.filter(photo => !ids.includes(photo.id)); ids.forEach(id => selected.delete(id));
    $('delete-dialog').close(); notice(`사진 ${ids.length}장을 지웠어요.`);
  } catch { notice('사진을 지우지 못했어요. 다시 시도해 주세요.', true); }
  finally { pendingDelete = []; busy = false; $('confirm-delete').disabled = false; $('cancel-delete').disabled = false; renderPhotos(); }
});
$('close-photo').addEventListener('click', () => $('photo-dialog').close());
$('photo-dialog').addEventListener('close', () => { $('large-photo').removeAttribute('src'); if (largeUrl) URL.revokeObjectURL(largeUrl); largeUrl = ''; });

async function initialize() {
  controls();
  try {
    db = await openDatabase();
    db.onversionchange = () => { db.close(); notice('보관함이 변경됐어요. 화면을 새로 고쳐 주세요.', true); };
    photos = await readPhotos();
    renderPhotos();
    notice(photos.length ? '카메라를 켜서 찍거나, 사진을 골라 공유하세요.' : '카메라 켜기를 눌러 사진을 찍어 보세요.');
  } catch { db = null; controls(); notice('사진 보관함을 열지 못했어요. 일반 크롬 창에서 다시 열어 주세요. 비공개 모드에서는 보관이 안 될 수 있어요.', true); }
}
initialize();

// 휴대폰 홈 화면에 앱으로 설치하고, 인터넷이 약해도 화면이 열리게 해요.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 설치 기능이 없어도 앱은 그대로 써요. */ });
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; $('install-app').hidden = false;
});
$('install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null; $('install-app').hidden = true;
  if (outcome === 'accepted') notice('앱을 설치하고 있어요. 홈 화면의 현장 사진 아이콘으로 열어 주세요.');
});
window.addEventListener('appinstalled', () => { $('install-app').hidden = true; });
