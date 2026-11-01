import { PublicError } from './persona-service.mjs';

const MAX_BYTES = 16000;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

async function boundedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new PublicError('JSON_REQUIRED', '仅接受JSON请求。', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new PublicError('TOO_LARGE', '请求过大。', 413);
  if (!request.body) throw new PublicError('INVALID_JSON', '请求内容为空。');
  const reader = request.body.getReader();
  let total = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel(); throw new PublicError('TOO_LARGE', '请求过大。', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new PublicError('INVALID_JSON', 'JSON格式不正确。'); }
}

/** Supply an owner-controlled origin; never take it from the request body. */
export async function handleRequest(request, { service, allowedOrigin }) {
  try {
    const url = new URL(request.url);
    if (url.origin !== allowedOrigin) throw new PublicError('ORIGIN_DENIED', '请求来源不匹配。', 403);
    if (url.pathname === '/api/status' && request.method === 'GET') return json(service.status());
    if (!['/api/search', '/api/chat'].includes(url.pathname)) return json({ code: 'NOT_FOUND', message: '未找到接口。' }, 404);
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: '此接口只接受POST。' }, 405);
    if (request.headers.get('origin') !== allowedOrigin) throw new PublicError('ORIGIN_DENIED', '请从本站页面发起请求。', 403);
    const payload = await boundedJson(request);
    const result = url.pathname === '/api/search' ? service.search(payload) : await service.answer(payload);
    return json(result, result.mode === 'disabled' ? 503 : 200);
  } catch (error) {
    if (error instanceof PublicError) return json({ code: error.code, message: error.message,
      ...(Array.isArray(error.sources) && error.sources.length ? { mode: 'model-error', answer: error.message, generated: false, sources: error.sources } : {}) }, error.status);
    return json({ code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用；未输出后台错误或配置信息。' }, 503);
  }
}
