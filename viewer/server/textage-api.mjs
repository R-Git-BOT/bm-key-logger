import { parseCatalog, parseTextageChart } from './textage-parser.mjs';

const cache = new Map();
const TTL = 60 * 60 * 1000;
async function cached(key, create) {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  const entry = { expires:Date.now() + TTL, promise:Promise.resolve().then(create) };
  cache.set(key, entry);
  try { return await entry.promise; } catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}
async function fetchSource(path) {
  // No arbitrary URLs, redirects, remote code execution, or bulk chart fetches.
  if (!/^(?:titletbl|actbl|datatbl)\.js$|^(?:\d{1,2}|s)\/[a-zA-Z0-9_-]{1,60}\.html$/.test(path)) throw new Error('無効な取得先');
  const response = await fetch(`https://textage.cc/score/${path}`, { signal:AbortSignal.timeout(15000), redirect:'error' });
  if (!response.ok) throw new Error(`TexTageから取得できませんでした (${response.status})`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 3_000_000) throw new Error('データ容量の上限を超えました'); chunks.push(chunk); }
  return new TextDecoder('shift-jis').decode(Buffer.concat(chunks));
}
export const getCatalog = () => cached('catalog', async () => parseCatalog(...await Promise.all(['titletbl.js','actbl.js','datatbl.js'].map(fetchSource))));
export async function getChart(id, difficulty) {
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || !['N','H','A','L'].includes(difficulty)) throw new Error('曲・難易度を指定してください');
  return cached(`${id}/${difficulty}`, async () => {
    const song = (await getCatalog()).find(song => song.id === id);
    if (!song) throw new Error('曲が見つかりません');
    const source = await cached(`source/${id}`, () => fetchSource(`${song.version}/${id}.html`));
    return parseTextageChart(source, song, difficulty);
  });
}
export function textageMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/textage/')) return next();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.statusCode = 405; res.end(JSON.stringify({ error:'GETのみ利用できます' })); return; }
  const action = url.pathname === '/api/textage/catalog' ? getCatalog() : url.pathname === '/api/textage/chart' ? getChart(url.searchParams.get('id') ?? '', url.searchParams.get('difficulty') ?? '') : Promise.reject(new Error('無効なAPI'));
  action.then(data => res.end(JSON.stringify(data))).catch(error => { res.statusCode = 502; res.end(JSON.stringify({ error:error.message || '譜面の取得に失敗しました' })); });
}
export const textagePlugin = () => ({ name:'textage-local-api', configureServer(server) { server.middlewares.use(textageMiddleware); }, configurePreviewServer(server) { server.middlewares.use(textageMiddleware); } });
