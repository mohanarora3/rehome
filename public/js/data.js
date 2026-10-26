// Shared reference data for Rehome: cities, categories and the sample returns batch.
// Used by the browser and by the server functions.

export const CITIES = [
  { id: 'DEL', name: 'Delhi', lat: 28.61, lon: 77.21 },
  { id: 'BOM', name: 'Mumbai', lat: 19.08, lon: 72.88 },
  { id: 'BLR', name: 'Bengaluru', lat: 12.97, lon: 77.59 },
  { id: 'MAA', name: 'Chennai', lat: 13.08, lon: 80.27 },
  { id: 'HYD', name: 'Hyderabad', lat: 17.39, lon: 78.49 },
  { id: 'CCU', name: 'Kolkata', lat: 22.57, lon: 88.36 },
  { id: 'PNQ', name: 'Pune', lat: 18.52, lon: 73.86 },
  { id: 'AMD', name: 'Ahmedabad', lat: 23.02, lon: 72.57 },
  { id: 'JAI', name: 'Jaipur', lat: 26.91, lon: 75.79 },
  { id: 'IXC', name: 'Chandigarh', lat: 30.73, lon: 76.78 },
];

export const cityById = Object.fromEntries(CITIES.map((c) => [c.id, c]));

export function cityIdFromName(name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  const aliases = { bangalore: 'BLR', bombay: 'BOM', madras: 'MAA', calcutta: 'CCU', 'new delhi': 'DEL', gurgaon: 'DEL', gurugram: 'DEL', noida: 'DEL' };
  if (aliases[n]) return aliases[n];
  const hit = CITIES.find((c) => c.name.toLowerCase() === n || c.id.toLowerCase() === n);
  return hit ? hit.id : null;
}

// Shipping weight per category (kg) drives transfer cost.
export const CATEGORIES = {
  apparel: { label: 'Apparel', kg: 0.6 },
  sneakers: { label: 'Sneakers', kg: 1.2 },
  beauty: { label: 'Beauty', kg: 0.3 },
  games: { label: 'Games & toys', kg: 1.4 },
  books: { label: 'Books', kg: 0.5 },
  audio: { label: 'Audio', kg: 0.5 },
};

export const CONDITIONS = {
  new: { label: 'New, unopened', factor: 1.0 },
  like_new: { label: 'Like new', factor: 0.92 },
  good: { label: 'Good', factor: 0.75 },
  fair: { label: 'Fair', factor: 0.55 },
  damaged: { label: 'Damaged', factor: 0.25 },
};

// [id, product, brand, category, size, condition, currentCity, listPrice]
const RAW = [
  ['R-0101', 'Pegasus running jacket', 'Nike', 'apparel', 'M', 'like_new', 'MAA', 3995],
  ['R-0102', 'Dri-FIT training tee', 'Nike', 'apparel', 'L', 'new', 'MAA', 1795],
  ['R-0103', 'Air Zoom Pegasus 41', 'Nike', 'sneakers', 'UK 9', 'like_new', 'DEL', 10795],
  ['R-0104', 'Ultraboost Light', 'Adidas', 'sneakers', 'UK 8', 'good', 'BOM', 16999],
  ['R-0105', 'Essentials hoodie', 'Adidas', 'apparel', 'XL', 'new', 'DEL', 3599],
  ['R-0106', 'Velocity Nitro 3', 'Puma', 'sneakers', 'UK 10', 'like_new', 'MAA', 8999],
  ['R-0107', 'Fresh Foam 1080', 'New Balance', 'sneakers', 'UK 9', 'new', 'BOM', 15999],
  ['R-0108', 'Chuck 70 high top', 'Converse', 'sneakers', 'UK 7', 'like_new', 'DEL', 6999],
  ['R-0109', 'Mexico 66', 'Onitsuka Tiger', 'sneakers', 'UK 8', 'new', 'MAA', 11000],
  ['R-0110', 'Classic clog', 'Crocs', 'sneakers', 'M7', 'good', 'DEL', 3995],
  ['R-0111', 'Go Walk 7', 'Skechers', 'sneakers', 'UK 9', 'fair', 'MAA', 5499],
  ['R-0112', '511 slim jeans', "Levi's", 'apparel', '32', 'like_new', 'BOM', 3599],
  ['R-0113', 'Trucker denim jacket', "Levi's", 'apparel', 'L', 'new', 'MAA', 5499],
  ['R-0114', 'Linen blend shirt', 'Zara', 'apparel', 'M', 'like_new', 'DEL', 2990],
  ['R-0115', 'Satin midi dress', 'Zara', 'apparel', 'S', 'new', 'MAA', 3990],
  ['R-0116', 'Relaxed-fit overshirt', 'H&M', 'apparel', 'L', 'good', 'DEL', 2299],
  ['R-0117', 'AIRism oversized tee', 'Uniqlo', 'apparel', 'M', 'new', 'MAA', 1290],
  ['R-0118', 'Block-print cotton kurta', 'Fabindia', 'apparel', 'M', 'like_new', 'BOM', 2490],
  ['R-0119', 'Chanderi silk dupatta', 'Fabindia', 'apparel', 'Free', 'new', 'DEL', 1990],
  ['R-0120', 'Anarkali kurta set', 'Biba', 'apparel', 'L', 'like_new', 'MAA', 3999],
  ['R-0121', 'Silk-blend kurta pajama', 'Manyavar', 'apparel', '40', 'new', 'MAA', 6999],
  ['R-0122', 'Slim-fit formal shirt', 'Allen Solly', 'apparel', '40', 'good', 'BOM', 1999],
  ['R-0123', 'Polo tee', 'U.S. Polo Assn.', 'apparel', 'L', 'like_new', 'DEL', 1699],
  ['R-0124', 'Ruby Woo lipstick', 'MAC', 'beauty', '3 g', 'new', 'DEL', 2150],
  ['R-0125', 'Studio Fix foundation', 'MAC', 'beauty', '30 ml', 'new', 'MAA', 3950],
  ['R-0126', 'Niacinamide 10% serum', 'The Ordinary', 'beauty', '30 ml', 'new', 'BOM', 990],
  ['R-0127', 'Kumkumadi face oil', 'Forest Essentials', 'beauty', '30 ml', 'new', 'MAA', 4500],
  ['R-0128', 'Fit Me matte foundation', 'Maybelline', 'beauty', '30 ml', 'new', 'DEL', 599],
  ['R-0129', '9to5 primer + matte lipstick', 'Lakmé', 'beauty', '3.6 g', 'new', 'MAA', 599],
  ['R-0130', 'Vitamin C face wash', 'Mamaearth', 'beauty', '100 ml', 'new', 'BOM', 349],
  ['R-0131', 'Soft Pinch liquid blush', 'Rare Beauty', 'beauty', '7.5 ml', 'new', 'DEL', 2700],
  ['R-0132', 'Black Opium eau de parfum', 'Yves Saint Laurent', 'beauty', '50 ml', 'new', 'BOM', 10500],
  ['R-0133', 'Monopoly Classic', 'Hasbro', 'games', '', 'like_new', 'DEL', 1999],
  ['R-0134', 'Jenga', 'Hasbro', 'games', '', 'good', 'MAA', 999],
  ['R-0135', 'UNO card game', 'Mattel', 'games', '', 'new', 'BOM', 249],
  ['R-0136', 'Scrabble Original', 'Mattel', 'games', '', 'like_new', 'MAA', 1499],
  ['R-0137', 'Catan base game', 'Catan', 'games', '', 'new', 'DEL', 4499],
  ['R-0138', 'Ticket to Ride Europe', 'Days of Wonder', 'games', '', 'like_new', 'MAA', 4999],
  ['R-0139', 'Classic 1000-piece puzzle', 'Ravensburger', 'games', '', 'new', 'BOM', 1599],
  ['R-0140', 'Millennium Falcon set', 'LEGO', 'games', '', 'like_new', 'DEL', 15999],
  ['R-0141', 'Hot Wheels 5-car pack', 'Hot Wheels', 'games', '', 'damaged', 'MAA', 699],
  ['R-0142', 'Atomic Habits (paperback)', 'Penguin Random House', 'books', '', 'like_new', 'DEL', 799],
  ['R-0143', 'The Psychology of Money', 'Jaico Publishing', 'books', '', 'new', 'BOM', 399],
  ['R-0144', 'Harry Potter box set', 'Bloomsbury', 'books', '', 'good', 'MAA', 4999],
  ['R-0145', 'One Piece Vol. 1-3 box', 'VIZ Media', 'books', '', 'new', 'DEL', 2499],
  ['R-0146', 'Rockerz 450 headphones', 'boAt', 'audio', '', 'good', 'MAA', 1499],
  ['R-0147', 'Tune 520BT headphones', 'JBL', 'audio', '', 'like_new', 'BOM', 3999],
  ['R-0148', 'WH-1000XM5 headphones', 'Sony', 'audio', '', 'like_new', 'DEL', 29990],
  ['R-0149', 'Original Classic sneaker', 'Reebok', 'sneakers', 'UK 9', 'damaged', 'DEL', 5999],
  ['R-0150', 'Yoga leggings', 'Lululemon', 'apparel', 'S', 'new', 'BOM', 9800],
];

export const SAMPLE_RETURNS = RAW.map(([id, product, brand, category, size, condition, city, listPrice]) => ({
  id, product, brand, category, size, condition, city,
  listPrice,
  // What a bulk liquidator typically pays: about 28% of list for sellable stock.
  liquidationValue: Math.round(listPrice * 0.28),
}));

export const CSV_COLUMNS = ['id', 'product', 'brand', 'category', 'size', 'condition', 'city', 'listPrice', 'liquidationValue'];

export function toCsv(items) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map((it) => CSV_COLUMNS.map((k) => esc(k === 'city' ? cityById[it.city]?.name ?? it.city : it[k])).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}
