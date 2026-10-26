// Small RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF. Returns objects keyed by header.
const KEYS = { listprice: 'listPrice', price: 'listPrice', list_price: 'listPrice', liquidationvalue: 'liquidationValue', liquidation_value: 'liquidationValue', liquidation: 'liquidationValue', location: 'city', warehouse: 'city', name: 'product', item: 'product' };

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => {
    const k = h.trim().replace(/^﻿/, '');
    return KEYS[k.toLowerCase().replace(/\s+/g, '')] || KEYS[k.toLowerCase()] || k.charAt(0).toLowerCase() + k.slice(1);
  });
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
