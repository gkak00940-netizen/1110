'use strict';

// 주문서는 이 브라우저에만 저장돼요. 다른 곳으로 보내지 않아요.
const STORAGE_KEY = 'sand-order-form-v1';
const MAX_ITEMS = 6;
const money = value => `${Math.round(value).toLocaleString('ko-KR')}원`;
const today = new Date();
const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const fields = ['order-date', 'order-number', 'customer', 'phone', 'memo'];
const defaults = {
  'order-date': localDate, 'order-number': '주문-001',
  customer: '김○○', phone: '010-0000-0001', memo: '',
  items: [{ name: '유자샌드 1박스', quantity: 1, price: 12000 }]
};
let order = structuredClone(defaults);
let storageAvailable = true;
const itemsElement = document.getElementById('items');

// 저장된 값이 잘못되었을 때도 화면이 멈추지 않도록 확인해요.
function numberInRange(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.floor(number))) : 0;
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved && typeof saved === 'object' && Array.isArray(saved.items)) {
    for (const field of fields) {
      if (typeof saved[field] === 'string') order[field] = saved[field].slice(0, field === 'memo' ? 100 : 28);
    }
    order.items = saved.items.slice(0, MAX_ITEMS).map(item => ({
      name: String(item?.name ?? '').slice(0, 24),
      quantity: numberInRange(item?.quantity, 9999),
      price: numberInRange(item?.price, 99999999)
    }));
  }
} catch {
  storageAvailable = false;
}

function saveOrder() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  document.getElementById('save-status').textContent = storageAvailable
    ? '입력한 내용을 이 브라우저에 저장했어요.'
    : '자동 저장이 어려워요. 창을 닫기 전에 인쇄해 주세요.';
}

// 입력한 내용을 종이에 보여 줄 글자와 금액에도 함께 반영해요.
function updateTotals() {
  let subtotal = 0;
  [...itemsElement.children].forEach((row, index) => {
    const item = order.items[index];
    const amount = item.quantity * item.price;
    subtotal += amount;
    row.querySelector('.line-amount').textContent = money(amount);
    row.querySelector('[data-print="name"]').textContent = item.name || '미입력';
    row.querySelector('[data-print="quantity"]').textContent = item.quantity.toLocaleString('ko-KR');
    row.querySelector('[data-print="price"]').textContent = money(item.price);
  });
  const tax = Math.round(subtotal * 0.1);
  document.getElementById('subtotal').textContent = money(subtotal);
  document.getElementById('tax').textContent = money(tax);
  document.getElementById('total').textContent = money(subtotal + tax);
  document.querySelectorAll('[data-for]').forEach(element => {
    element.textContent = order[element.dataset.for] || '—';
  });
  document.getElementById('add-item').disabled = order.items.length >= MAX_ITEMS;
}

function renderItems() {
  itemsElement.replaceChildren();
  order.items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    // 고정된 화면 틀만 넣고, 작성한 내용은 아래에서 안전하게 채워요.
    row.innerHTML = `
      <label><span class="field-name">품목</span><input data-field="name" type="text" maxlength="24"><span class="print-value" data-print="name"></span></label>
      <label><span class="field-name">수량</span><input data-field="quantity" type="number" min="0" max="9999" step="1" inputmode="numeric"><span class="print-value" data-print="quantity"></span></label>
      <label><span class="field-name">단가 (원)</span><input data-field="price" type="number" min="0" max="99999999" step="1" inputmode="numeric"><span class="print-value" data-print="price"></span></label>
      <div class="line-amount" aria-label="품목 금액"></div>
      <button type="button" class="delete-button screen-only">삭제</button>`;
    row.querySelectorAll('input').forEach(input => {
      const key = input.dataset.field;
      input.value = item[key];
      input.setAttribute('aria-label', `${index + 1}번째 ${key === 'name' ? '품목' : key === 'quantity' ? '수량' : '단가 (원)'}`);
      input.addEventListener('input', () => {
        item[key] = key === 'name' ? input.value : numberInRange(input.value, key === 'quantity' ? 9999 : 99999999);
        updateTotals();
        saveOrder();
      });
      if (key !== 'name') input.addEventListener('change', () => { input.value = item[key]; });
    });
    const deleteButton = row.querySelector('button');
    deleteButton.setAttribute('aria-label', `${index + 1}번째 품목 삭제`);
    deleteButton.addEventListener('click', () => {
      order.items.splice(index, 1);
      renderItems();
      saveOrder();
      document.getElementById('notice').textContent = '품목을 삭제했어요.';
      const next = itemsElement.children[Math.min(index, order.items.length - 1)];
      (next?.querySelector('input') || document.getElementById('add-item')).focus();
    });
    itemsElement.append(row);
  });
  updateTotals();
}

fields.forEach(field => {
  const input = document.getElementById(field);
  input.value = order[field];
  input.addEventListener('input', () => {
    order[field] = input.value;
    updateTotals();
    saveOrder();
  });
});

document.getElementById('add-item').addEventListener('click', () => {
  if (order.items.length >= MAX_ITEMS) return;
  order.items.push({ name: '', quantity: 1, price: 0 });
  renderItems();
  saveOrder();
  itemsElement.lastElementChild.querySelector('input').focus();
  document.getElementById('notice').textContent = '새 품목 줄을 추가했어요.';
});
document.getElementById('print').addEventListener('click', () => {
  updateTotals();
  window.print();
});
window.addEventListener('beforeprint', updateTotals);
renderItems();
saveOrder();
