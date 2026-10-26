// Writes public/sample/returns.csv from the sample batch in public/js/data.js.
import fs from 'node:fs';
import { SAMPLE_RETURNS, toCsv } from '../public/js/data.js';
fs.mkdirSync('public/sample', { recursive: true });
fs.writeFileSync('public/sample/returns.csv', toCsv(SAMPLE_RETURNS) + '\n');
console.log(`Wrote ${SAMPLE_RETURNS.length} rows to public/sample/returns.csv`);
