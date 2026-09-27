// 울산항 공공데이터 → data/*.json (GitHub Actions에서 실행, Node 20 이상, 외부 패키지 없음)
//  - data/port-now.json   : 울산항만공사_항내 선박위치정보(15156631) → 재항·부두 접안·정박지 대기 척수 (매 실행)
//  - data/bulk-trend.json : 울산항만공사_울산항 수출입 화물정보(15156637) → 최근 13개월 벌크 화물 (하루 한 번)
// 인증키는 저장소 Secrets 의 DATA_GO_KR_KEY 에만 둡니다. 호출이 실패하면 기존 파일을 그대로 둡니다.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const AGG = createRequire(import.meta.url)('./upa-agg.js');

const KEY = process.env.DATA_GO_KR_KEY || '';
const API = {
  pos: process.env.UPA_POS_URL || 'https://apis.data.go.kr/B551938/VslPstnInfoService/getVslPstnInfo',
  cargo: process.env.UPA_CARGO_URL || 'https://apis.data.go.kr/B551938/IntgCagInfoService/getIntgCagInfo',
};
const OUT = { pn: new URL('../data/port-now.json', import.meta.url), bt: new URL('../data/bulk-trend.json', import.meta.url) };
const ROWS = 1000;

async function page(url, params, pageNo, tries = 3) {
  const q = new URLSearchParams({ serviceKey: KEY, numOfRows: String(ROWS), pageNo: String(pageNo), resultType: 'json', ...params });
  for (let a = 1; ; a++) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(`${url}?${q}`, { signal: ctl.signal }).finally(() => clearTimeout(tm));
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = JSON.parse(text);
      if (j.resultCode === '030') return { items: [], total: 0 };                 // 자료 없음
      const code = j.response?.header?.resultCode;
      if (code !== '00') throw new Error(`resultCode ${code ?? text.slice(0, 120)}`);
      let items = j.response.body.items?.item ?? [];
      if (!Array.isArray(items)) items = [items];
      return { items, total: +j.response.body.totalCount || 0 };
    } catch (e) {
      if (a >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * a));
    }
  }
}
async function all(url, params) {
  const first = await page(url, params, 1);
  const pages = Math.ceil(first.total / ROWS), out = [...first.items];
  for (let p = 2; p <= pages; p += 5) {                                         // 5쪽씩 동시에
    const batch = [];
    for (let k = p; k < Math.min(p + 5, pages + 1); k++) batch.push(page(url, params, k));
    (await Promise.all(batch)).forEach((r) => out.push(...r.items));
  }
  return out;
}

async function portNow() {
  const rows = await all(API.pos, {});
  if (!rows.length) throw new Error('선박위치 0건');
  return { source: 'api', updated: new Date().toISOString(), ...AGG.portNow(rows, Date.now()) };
}
async function bulkTrend() {
  const k = new Date(Date.now() + 9 * 3600e3), y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
  const years = m >= 2 ? [y - 1, y] : [y - 2, y - 1, y];                       // 최근 13개월을 덮는 입항연도
  let rows = [];
  for (const yr of years) rows = rows.concat(await all(API.cargo, { prtCd: '820', ptentYr: String(yr), bzentyCd: '', callsgn: '', vyg: '' }));
  const d = AGG.bulkTrend(rows, Date.now());
  if (!d.records) throw new Error('벌크 화물 0건');
  return { source: 'api', updated: new Date().toISOString(), ...d };
}

if (!KEY) { console.log('DATA_GO_KR_KEY 없음: 갱신 건너뜀'); process.exit(0); }
async function run(name, fn, out, due = async () => true) {
  if (!(await due())) { console.log(`${name}: 오늘은 이미 갱신됨`); return; }
  try {
    const d = await fn();
    await writeFile(out, JSON.stringify(d, null, 1) + '\n');
    console.log(`${name}: 갱신`, JSON.stringify(d).slice(0, 160));
  } catch (e) { console.warn(`${name}: 실패, 기존 파일 유지 -`, e.message); }
}
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
await run('울산항 지금', portNow, OUT.pn);
await run('벌크 화물 동향', bulkTrend, OUT.bt, async () => {
  if (process.env.FORCE_BULK) return true;
  try { const j = JSON.parse(await readFile(OUT.bt, 'utf8')); return j.source !== 'api' || new Date(new Date(j.updated).getTime() + 9 * 3600e3).toISOString().slice(0, 10) !== todayKst(); }
  catch { return true; }
});
