'use strict';

// 다른 앱의 저장 내용과 섞이지 않도록 별도 이름으로 보관해요.
const STORAGE_KEY = 'sand-booking-v1';
const $ = id => document.getElementById(id);
const draftFields = ['date', 'time', 'guest', 'people', 'memo'];

// 한국 시간을 기준으로 오늘 날짜를 자동으로 구해요.
function todayString() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = name => parts.find(item => item.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function offsetDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekRange(today) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = offsetDate(today, -((weekday + 6) % 7));
  return { start, end: offsetDate(start, 6) };
}

function dateLabel(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' });
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function validTime(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
let state = { bookings: [], filter: 'today', draft: { date: todayString(), time: '', guest: '', people: '1', memo: '' }, editingId: null };
let deletedBooking = null;

// 저장된 날짜와 예약 내용을 확인한 뒤 불러와요.
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved && typeof saved === 'object') {
    if (Array.isArray(saved.bookings)) state.bookings = saved.bookings.filter(item => item && typeof item.id === 'string' && validDate(item.date) && validTime(item.time) && typeof item.guest === 'string' && Number.isInteger(item.people) && item.people >= 1 && item.people <= 999 && typeof item.memo === 'string');
    state.filter = saved.filter === 'week' ? 'week' : 'today';
    if (saved.draft && typeof saved.draft === 'object') for (const field of draftFields) if (typeof saved.draft[field] === 'string') state.draft[field] = saved.draft[field];
    if (!validDate(state.draft.date)) state.draft.date = todayString();
    if (typeof saved.editingId === 'string' && state.bookings.some(item => item.id === saved.editingId)) state.editingId = saved.editingId;
  }
} catch { $('save-status').textContent = '저장한 내용을 불러오지 못했어요. 새로 입력해 주세요.'; }

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('save-status').textContent = '입력한 내용을 이 브라우저에 저장했어요.';
    return true;
  } catch {
    $('save-status').textContent = '자동 저장이 어려워요. 필요한 목록은 인쇄해 주세요.';
    return false;
  }
}

function syncDraft() {
  draftFields.forEach(field => { state.draft[field] = $(field).value; });
  saveState();
  renderDraftWarning();
}

function fillDraft() {
  draftFields.forEach(field => { $(field).value = state.draft[field]; });
  $('entry-title').textContent = state.editingId ? '예약 수정하기' : '새 예약 적기';
  $('save-booking').textContent = state.editingId ? '수정 저장' : '예약 추가';
  $('cancel-edit').hidden = !state.editingId;
  renderDraftWarning();
}

function resetDraft() {
  state.editingId = null;
  state.draft = { date: todayString(), time: '', guest: '', people: '1', memo: '' };
  fillDraft();
}

// 같은 날짜와 시간이 정확히 일치하면 겹친 예약으로 알려드려요.
function conflictCounts() {
  const counts = new Map();
  state.bookings.forEach(item => { const key = `${item.date} ${item.time}`; counts.set(key, (counts.get(key) || 0) + 1); });
  return counts;
}

function renderDraftWarning() {
  const matches = state.bookings.filter(item => item.id !== state.editingId && item.date === $('date').value && item.time === $('time').value);
  $('draft-warning').hidden = !matches.length;
  $('draft-warning').textContent = matches.length ? `시간 겹침 주의: 같은 날짜·시간에 ${matches.length}건의 예약이 있어요. 확인 후 추가해 주세요.` : '';
}

function textElement(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function render() {
  const today = todayString();
  const week = weekRange(today);
  const thisWeek = state.bookings.filter(item => item.date >= week.start && item.date <= week.end);
  const todays = state.bookings.filter(item => item.date === today);
  const visible = (state.filter === 'week' ? thisWeek : todays).slice().sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  $('today-label').textContent = `오늘 ${new Date(`${today}T12:00:00Z`).toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul', year:'numeric', month:'long', day:'numeric', weekday:'long' })}`;
  $('today-count').textContent = `${todays.length.toLocaleString('ko-KR')}건`;
  $('week-count').textContent = `${thisWeek.length.toLocaleString('ko-KR')}건`;
  $('people-count').textContent = `${thisWeek.reduce((sum, item) => sum + item.people, 0).toLocaleString('ko-KR')}명`;
  $('list-title').textContent = state.filter === 'week' ? '이번 주 예약 목록' : '오늘 예약 목록';
  $('date-range').textContent = state.filter === 'week' ? `${dateLabel(week.start)} ~ ${dateLabel(week.end)}` : dateLabel(today);
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
  $('booking-table').hidden = !visible.length;
  $('empty').hidden = !!visible.length;
  const counts = conflictCounts();
  const overlapping = visible.filter(item => counts.get(`${item.date} ${item.time}`) > 1);
  $('conflict-summary').hidden = !overlapping.length;
  $('conflict-summary').textContent = overlapping.length ? `시간 겹침 주의: 이 목록에 같은 날짜·시간의 예약 ${overlapping.length}건이 있어요. 빨간색 예약을 확인해 주세요.` : '';
  $('booking-list').replaceChildren();
  visible.forEach(item => {
    const row = document.createElement('tr');
    const conflict = counts.get(`${item.date} ${item.time}`) > 1;
    if (conflict) row.className = 'conflict-row';
    const date = document.createElement('td'); date.dataset.label = '날짜·시간';
    const dateContent = document.createElement('div');
    dateContent.append(textElement('span', dateLabel(item.date), 'date-text'), textElement('span', item.time, 'time-text'));
    if (conflict) dateContent.append(textElement('span', '시간 겹침', 'conflict-label'));
    date.append(dateContent);
    const guest = textElement('td', item.guest); guest.dataset.label = '손님';
    const people = textElement('td', `${item.people}명`); people.dataset.label = '인원';
    const memo = document.createElement('td'); memo.dataset.label = '메모'; memo.append(textElement('span', item.memo || '—', 'memo-text'));
    const actions = document.createElement('td'); actions.className = 'screen-only'; actions.dataset.label = '관리';
    const buttons = document.createElement('div'); buttons.className = 'row-actions';
    const edit = textElement('button', '수정'); edit.type = 'button'; edit.setAttribute('aria-label', `${item.guest} ${item.time} 예약 수정`);
    edit.addEventListener('click', () => {
      state.editingId = item.id;
      state.draft = { date:item.date, time:item.time, guest:item.guest, people:String(item.people), memo:item.memo };
      fillDraft(); saveState(); $('date').focus(); $('booking-form').scrollIntoView({ behavior:'smooth', block:'center' });
    });
    const remove = textElement('button', '삭제', 'delete-button'); remove.type = 'button'; remove.setAttribute('aria-label', `${item.guest} ${item.time} 예약 삭제`);
    remove.addEventListener('click', () => {
      deletedBooking = item;
      state.bookings = state.bookings.filter(entry => entry.id !== item.id);
      if (state.editingId === item.id) resetDraft();
      saveState(); render();
      $('feedback').textContent = `${item.guest} 손님의 예약을 삭제했어요.`;
      $('undo-delete').hidden = false;
    });
    buttons.append(edit, remove); actions.append(buttons); row.append(date, guest, people, memo, actions); $('booking-list').append(row);
  });
  renderDraftWarning();
}

draftFields.forEach(field => $(field).addEventListener('input', syncDraft));
$('booking-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('booking-form').reportValidity()) return;
  const people = Number($('people').value);
  if (!validDate($('date').value) || !validTime($('time').value) || !Number.isInteger(people) || people < 1 || people > 999 || !$('guest').value.trim()) { $('feedback').textContent = '날짜·시간·손님 이름·인원을 다시 확인해 주세요.'; return; }
  const wasEditing = !!state.editingId;
  const item = { id: state.editingId || crypto.randomUUID(), date: $('date').value, time: $('time').value, guest: $('guest').value.trim(), people, memo: $('memo').value.trim() };
  if (state.editingId) state.bookings = state.bookings.map(entry => entry.id === state.editingId ? item : entry);
  else state.bookings.push(item);
  resetDraft();
  const saved = saveState(); render();
  $('feedback').textContent = `${wasEditing ? '예약을 수정했어요.' : '예약을 추가했어요.'}${saved ? '' : ' 자동 저장이 어려우니 인쇄해 두세요.'}${item.date !== todayString() && state.filter === 'today' ? ' 오늘 외의 예약은 해당 주에 이번 주 목록에서 볼 수 있어요.' : ''}`;
});
$('cancel-edit').addEventListener('click', () => { resetDraft(); saveState(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; saveState(); render(); }));
$('undo-delete').addEventListener('click', () => {
  if (!deletedBooking) return;
  state.bookings.push(deletedBooking); deletedBooking = null;
  $('undo-delete').hidden = true; saveState(); render(); $('feedback').textContent = '삭제한 예약을 되돌렸어요.';
});

// 예시에는 실제 손님 정보를 넣지 않아요. 여러 번 눌러도 같은 예시는 중복되지 않아요.
$('examples').addEventListener('click', () => {
  const today = todayString(); const week = weekRange(today);
  const samples = [
    { date:today, time:'10:00', guest:'김○○', people:2, memo:'유자샌드 1박스 · 12,000원 방문 수령\n가상 연락처 010-0000-0001' },
    { date:today, time:'10:00', guest:'이○○', people:1, memo:'유자샌드 2박스 방문 수령 · 시간 겹침 확인용' },
    { date:today, time:'14:00', guest:'박○○', people:3, memo:'가공 농산물 선물 상담' },
    { date:week.start, time:'11:00', guest:'최○○', people:2, memo:'유자샌드 1박스 방문 수령' },
    { date:week.end, time:'15:30', guest:'정○○', people:4, memo:'유자샌드 단체 주문 상담' }
  ];
  let added = 0;
  samples.forEach((item, index) => { const id = `example-${today}-${index}`; if (!state.bookings.some(entry => entry.id === id)) { state.bookings.push({ id, ...item }); added++; } });
  state.filter = 'week'; saveState(); render();
  $('feedback').textContent = added ? `가상 예약 ${added}건을 넣었어요. 같은 시간의 빨간 경고도 살펴보세요.` : '오늘의 예시 예약 5건이 이미 있어요.';
});
$('print').addEventListener('click', () => { render(); window.print(); });
window.addEventListener('beforeprint', render);
// 날짜가 바뀌면 오늘과 이번 주 목록도 자동으로 새로 계산해요.
setInterval(render, 60000);
fillDraft();
render();
