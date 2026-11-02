#!/usr/bin/env node
/*
 * DOIntelligence — pengambil data pasar & berita.
 *
 * Dijalankan oleh GitHub Actions (.github/workflows/data.yml) secara berkala,
 * lalu hasilnya dipublikasikan ke cabang `data` sebagai JSON statis yang
 * dibaca halaman (tanpa backend, tanpa API key, tanpa biaya).
 *
 * Sumber:
 *  - Yahoo Finance chart API  : harga & histori saham IDX (.JK), saham global,
 *                               indeks IHSG, emas berjangka (GC=F), forex.
 *  - Frankfurter (ECB)        : kurs USD/IDR dan pasangan lain.
 *  - RSS media                : CNBC Indonesia, Antara Ekonomi, Tempo Bisnis,
 *                               CNBC World Markets.
 *
 * Aturan: kalau sebuah sumber gagal, angka karangan TIDAK pernah ditulis.
 * Data lama boleh dibawa sebagai cadangan, tetapi selalu memakai `asOf` aslinya
 * sehingga halaman bisa menampilkan kapan data itu benar-benar diambil.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const GRAM_PER_OZ = 31.1034768;
const DEADLINE = Date.now() + 12 * 60 * 1000; // batas aman durasi job

/* ---------------- daftar instrumen ---------------- */
const INDEX = [['^JKSE', 'IHSG', 'Indeks Harga Saham Gabungan']];
const IDX = [
  ['BBCA.JK', 'BBCA', 'Bank Central Asia'],
  ['BBRI.JK', 'BBRI', 'Bank Rakyat Indonesia'],
  ['TLKM.JK', 'TLKM', 'Telkom Indonesia'],
  ['BMRI.JK', 'BMRI', 'Bank Mandiri'],
  ['ASII.JK', 'ASII', 'Astra International'],
  ['ANTM.JK', 'ANTM', 'Aneka Tambang'],
  ['ICBP.JK', 'ICBP', 'Indofood CBP'],
  ['ADRO.JK', 'ADRO', 'Adaro Energy'],
  ['UNTR.JK', 'UNTR', 'United Tractors'],
  ['GOTO.JK', 'GOTO', 'GoTo Gojek Tokopedia'],
];
const GLOBAL = [
  ['AAPL', 'AAPL', 'Apple'],
  ['MSFT', 'MSFT', 'Microsoft'],
  ['NVDA', 'NVDA', 'NVIDIA'],
  ['TSLA', 'TSLA', 'Tesla'],
  ['GOOGL', 'GOOGL', 'Alphabet'],
];
const FXPAIRS = [
  ['EURIDR=X', 'EUR/IDR', 'Euro'],
  ['SGDIDR=X', 'SGD/IDR', 'Dolar Singapura'],
  ['JPYIDR=X', 'JPY/IDR', 'Yen Jepang (per 1 yen)'],
  ['GBPIDR=X', 'GBP/IDR', 'Pound Inggris'],
  ['CNYIDR=X', 'CNY/IDR', 'Yuan Tiongkok'],
];

const FEEDS = [
  { name: 'CNBC Indonesia', url: 'https://www.cnbcindonesia.com/rss' },
  { name: 'Antara Ekonomi', url: 'https://www.antaranews.com/rss/ekonomi.xml' },
  { name: 'Tempo Bisnis', url: 'https://rss.tempo.co/bisnis' },
  { name: 'CNBC World Markets', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
];

/* ---------------- util ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
const log = (...a) => console.log(...a);

function readSafe(file) {
  try {
    const p = join(OUT, file);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

class RateLimited extends Error {
  constructor() {
    super('429 Too Many Requests');
  }
}

let circuit = 0; // jumlah kegagalan 429 berurutan
let proxyOnly = false; // setelah dua 429, langsung lewat cadangan proxy

async function http(url, { tries = 3, timeout = 20000, headers = {}, allow429 = true } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    if (Date.now() > DEADLINE) throw new Error('batas waktu job tercapai');
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, Accept: '*/*', ...headers } });
      clearTimeout(t);
      if (res.status === 429) {
        circuit++;
        if (!allow429) throw new RateLimited();
        const wait = 12000 * (i + 1);
        log(`   429, tunggu ${wait / 1000}s lalu coba lagi`);
        await sleep(wait);
        lastErr = new RateLimited();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      circuit = 0;
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (e instanceof RateLimited) break;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

const httpJson = async (url, opts) => JSON.parse(await http(url, { headers: { Accept: 'application/json' }, ...opts }));

/* ---------------- Yahoo Finance ---------------- */
async function yahooChart(symbol, range, interval = '1d') {
  const path = `v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  let err;
  if (!proxyOnly) {
    for (const host of ['query1', 'query2']) {
      try {
        const j = await httpJson(`https://${host}.finance.yahoo.com/${path}`, { tries: 2 });
        const res = j?.chart?.result?.[0];
        if (!res || !res.timestamp?.length) throw new Error('chart kosong');
        return res;
      } catch (e) {
        err = e;
        if (circuit >= 2) {
          proxyOnly = true;
          break;
        }
        await sleep(600);
      }
    }
  }
  // Cadangan: pembaca publik r.jina.ai meneruskan permintaan ke Yahoo dari IP lain.
  // Datanya tetap dari Yahoo; label sumber di aplikasi menyebutkan jalur proxy.
  try {
    const txt = await http(`https://r.jina.ai/https://query1.finance.yahoo.com/${path}`, { timeout: 45000, tries: 1 });
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a < 0 || b < 0) throw new Error('proxy: respons tak dikenali');
    const j = JSON.parse(txt.slice(a, b + 1));
    const res = j?.chart?.result?.[0];
    if (!res || !res.timestamp?.length) throw new Error('proxy: chart kosong');
    res.__proxy = true;
    return res;
  } catch (e) {
    throw err || e;
  }
}

function parseBars(res) {
  const q = res.indicators?.quote?.[0] || {};
  const bars = [];
  (res.timestamp || []).forEach((t, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((v) => v == null || !isFinite(v))) return;
    bars.push([t, r2(o), r2(h), r2(l), r2(c)]);
  });
  return bars;
}

async function quote({ ticker, symbol, name, cls, range = '1y' }) {
  const res = await yahooChart(ticker, range);
  const bars = parseBars(res);
  if (!bars.length) throw new Error('tidak ada candle');
  const meta = res.meta || {};
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const price = meta.regularMarketPrice ?? last[4];
  // chartPreviousClose di Yahoo adalah penutupan sebelum AWAL rentang (bisa setahun lalu),
  // jadi perubahan harian dihitung dari dua candle terakhir saja.
  const prevClose = prev?.[4] ?? last[1];
  return {
    symbol,
    name,
    cls,
    ticker,
    currency: meta.currency || null,
    price: r2(price),
    prevClose: r2(prevClose),
    changePct: prevClose ? r2(((price - prevClose) / prevClose) * 100) : null,
    dayHigh: r2(meta.regularMarketDayHigh ?? last[2]),
    dayLow: r2(meta.regularMarketDayLow ?? last[3]),
    spark: bars.slice(-30).map((b) => b[4]),
    asOf: iso(meta.regularMarketTime) || iso(last[0]),
    source: res.__proxy ? 'Yahoo Finance (lewat proxy r.jina.ai)' : 'Yahoo Finance',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`,
    bars,
  };
}

/* ---------------- kurs ---------------- */
async function getFx() {
  const out = {
    source: 'Frankfurter (kurs referensi ECB)',
    sourceUrl: 'https://frankfurter.dev',
    date: null,
    rates: {},
  };
  try {
    const j = await httpJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR,EUR,SGD,JPY,GBP,CNY', { tries: 2 });
    out.date = j.date;
    out.rates = j.rates || {};
  } catch (e) {
    const res = await yahooChart('USDIDR=X', '5d');
    const p = res.meta?.regularMarketPrice;
    if (!p) throw new Error('kurs USD/IDR tidak tersedia');
    out.source = 'Yahoo Finance (cadangan, Frankfurter gagal)';
    out.sourceUrl = 'https://finance.yahoo.com/quote/USDIDR=X';
    out.rates = { IDR: p };
  }
  const idr = out.rates.IDR;
  if (!idr) throw new Error('kurs IDR tidak tersedia');
  const pair = (code) => (out.rates[code] ? r2(idr / out.rates[code]) : null);
  return {
    ...out,
    usdIdr: r2(idr),
    pairs: { EUR: pair('EUR'), SGD: pair('SGD'), JPY: pair('JPY'), GBP: pair('GBP'), CNY: pair('CNY') },
  };
}

/* ---------------- emas ---------------- */
async function getGold(usdIdr) {
  const res = await yahooChart('GC=F', '1y');
  const bars = parseBars(res);
  const meta = res.meta || {};
  const usdOz = meta.regularMarketPrice ?? bars[bars.length - 1]?.[4];
  if (!usdOz) throw new Error('harga emas tidak tersedia');
  if (!usdIdr) throw new Error('kurs USD/IDR tidak tersedia untuk konversi emas');
  const toGram = (v) => r2((v / GRAM_PER_OZ) * usdIdr);
  const prevOz = bars[bars.length - 2]?.[4] ?? usdOz;
  return {
    symbol: 'EMAS',
    name: 'Emas per gram (XAU/IDR)',
    cls: 'Emas',
    ticker: 'GC=F',
    price: toGram(usdOz),
    prevClose: toGram(prevOz),
    changePct: r2(((usdOz - prevOz) / prevOz) * 100),
    spark: bars.slice(-30).map((b) => toGram(b[4])),
    spotUsdOz: r2(usdOz),
    asOf: iso(meta.regularMarketTime) || iso(bars[bars.length - 1]?.[0]),
    source: 'Yahoo Finance (emas berjangka GC=F, USD/ons) x kurs USD/IDR',
    sourceUrl: 'https://finance.yahoo.com/quote/GC=F',
    bars: bars.map((b) => [b[0], toGram(b[1]), toGram(b[2]), toGram(b[3]), toGram(b[4])]),
  };
}

/* ---------------- RSS ---------------- */
function decodeEnt(s = '') {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“',
    rdquo: '”', hellip: '…', ndash: '–', mdash: '—', copy: '©', deg: '°', euro: '€', pound: '£',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

const stripTags = (s = '') => decodeEnt(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseRss(xml, source) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body);
      if (!r) return '';
      return r[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    };
    const title = stripTags(pick('title'));
    const link = stripTags(pick('link')) || stripTags(pick('guid'));
    if (!title || !/^https?:/i.test(link)) continue;
    const rawDate = stripTags(pick('pubDate') || pick('dc:date') || pick('published'));
    let publishedAt = rawDate ? new Date(rawDate) : null;
    if (!publishedAt || isNaN(publishedAt)) publishedAt = new Date();
    items.push({
      title,
      link,
      source,
      publishedAt: publishedAt.toISOString(),
      summary: stripTags(pick('description')).slice(0, 220),
    });
  }
  return items;
}

/* ---------------- utama ---------------- */
const REQUESTED_AT = new Date().toISOString();
const errors = [];
const assets = [];
const history = {};

async function step(label, fn) {
  try {
    return await fn();
  } catch (e) {
    errors.push({ step: label, message: String(e?.message || e) });
    log(`[lewati] ${label}: ${e?.message || e}`);
    return null;
  }
}

const fx = await step('kurs', getFx);
if (fx) log(`kurs USD/IDR ${fx.usdIdr} (${fx.source})`);

async function collect(list, cls, range) {
  for (const [ticker, symbol, name] of list) {
    const q = await step(ticker, () => quote({ ticker, symbol, name, cls, range }));
    if (q) {
      history[symbol] = { ticker, cls, source: q.source, asOf: q.asOf, bars: q.bars };
      delete q.bars;
      assets.push(q);
      log(`  ${symbol} ${q.price} (${q.changePct > 0 ? '+' : ''}${q.changePct}%)`);
    }
    await sleep(1200); // sopan ke Yahoo, hindari 429
  }
}

await collect(INDEX, 'Indeks', '1y');
await collect(IDX, 'Saham IDX', '1y');
await collect(GLOBAL, 'Saham global', '1y');
await collect(FXPAIRS, 'Forex', '6mo');

if (fx?.usdIdr) {
  const gold = await step('emas', () => getGold(fx.usdIdr));
  if (gold) {
    history.EMAS = { ticker: 'GC=F', cls: 'Emas', source: gold.source, asOf: gold.asOf, bars: gold.bars };
    delete gold.bars;
    assets.push(gold);
  }
}

// saham global & indeks dikutip USD -> tampilkan dalam IDR
if (fx?.usdIdr) {
  for (const a of assets) {
    if (a.currency === 'USD') {
      const k = fx.usdIdr;
      a.price = r2(a.price * k);
      a.prevClose = r2(a.prevClose * k);
      a.dayHigh = r2(a.dayHigh * k);
      a.dayLow = r2(a.dayLow * k);
      a.spark = a.spark.map((v) => r2(v * k));
      a.currency = 'IDR';
      a.quotedIn = 'USD';
      a.source = `Yahoo Finance (USD) × kurs USD/IDR ${fx.usdIdr}`;
      if (history[a.symbol]) {
        history[a.symbol].bars = history[a.symbol].bars.map((b) => [
          b[0], r2(b[1] * k), r2(b[2] * k), r2(b[3] * k), r2(b[4] * k),
        ]);
        history[a.symbol].note = 'dikonversi ke IDR';
      }
    }
  }
}

// forex: pakai kurs harian Frankfurter bila ada (lebih resmi daripada kuotasi intraday)
if (fx?.pairs) {
  for (const a of assets.filter((x) => x.cls === 'Forex')) {
    const code = a.symbol.split('/')[0];
    const p = fx.pairs[code];
    if (!p) continue;
    a.price = p;
    a.source = 'Frankfurter, kurs harian ECB';
    a.sourceUrl = 'https://frankfurter.dev';
    a.asOf = fx.date ? new Date(fx.date + 'T16:00:00Z').toISOString() : a.asOf;
  }
}

/* berita */
const newsItems = [];
for (const feed of FEEDS) {
  const xml = await step(`rss ${feed.name}`, () => http(feed.url, { timeout: 15000, tries: 2 }));
  if (!xml) continue;
  const items = parseRss(xml, feed.name);
  if (!items.length) errors.push({ step: `rss ${feed.name}`, message: 'tidak ada item' });
  newsItems.push(...items);
  log(`  berita ${feed.name}: ${items.length}`);
  await sleep(300);
}

/* cadangan: gabungkan dengan data publikasi sebelumnya */
const prevMarket = readSafe('market.json');
const prevHistory = readSafe('history.json');
const prevNews = readSafe('news.json');

const known = new Set(assets.map((a) => a.symbol));
let carried = 0;
if (prevMarket?.assets) {
  for (const a of prevMarket.assets) {
    if (known.has(a.symbol)) continue;
    // hanya bawa data yang memang pernah diambil dari sumber nyata
    if (!a.source || /dummy/i.test(a.source)) continue;
    assets.push({ ...a, carriedForward: true });
    carried++;
  }
}
if (prevHistory?.series) {
  for (const [sym, s] of Object.entries(prevHistory.series)) {
    if (!history[sym] && s?.bars?.length) history[sym] = s;
  }
}

const seen = new Set();
const dedup = newsItems.filter((n) => {
  const key = n.link.replace(/[?#].*$/, '').toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
// jatah per sumber supaya media dengan judul lebih lama tetap terwakili
const perSource = new Map();
for (const n of dedup) {
  const arr = perSource.get(n.source) || [];
  if (arr.length < 20) {
    arr.push(n);
    perSource.set(n.source, arr);
  }
}
const news = [...perSource.values()].flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 80);
if (news.length < 10 && prevNews?.items?.length) {
  for (const n of prevNews.items) {
    if (news.length >= 20) break;
    if (news.some((x) => x.link === n.link)) continue;
    news.push(n);
  }
  news.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

/* tulis keluaran */
mkdirSync(OUT, { recursive: true });
const generatedAt = new Date().toISOString();

const market = {
  generatedAt,
  requestedAt: REQUESTED_AT,
  fx: fx
    ? { usdIdr: fx.usdIdr, pairs: fx.pairs, date: fx.date, source: fx.source, sourceUrl: fx.sourceUrl }
    : prevMarket?.fx || null,
  assets,
  carriedForward: carried,
  unavailable: [
    {
      cls: 'Reksa dana',
      reason:
        'Tidak ada API publik gratis untuk NAV reksa dana Indonesia (data OJK/APERD tidak menyediakan feed terbuka). NAV diisi manual oleh pengguna dan diberi label "input manual".',
    },
    {
      cls: 'Harga saham real-time',
      reason:
        'Yahoo Finance memberi harga tertunda/penutupan. Angka pada aplikasi bukan kuotasi real-time bursa.',
    },
  ],
  errors,
};

writeFileSync(join(OUT, 'market.json'), JSON.stringify(market));
writeFileSync(join(OUT, 'history.json'), JSON.stringify({ generatedAt, series: history }));
writeFileSync(join(OUT, 'news.json'), JSON.stringify({ generatedAt, feeds: FEEDS.map((f) => f.name), items: news }));

log(
  `selesai: ${assets.length} instrumen (${carried} dibawa dari publikasi sebelumnya), ${news.length} berita, ` +
    `${Object.keys(history).length} seri histori, ${errors.length} sumber gagal`
);
