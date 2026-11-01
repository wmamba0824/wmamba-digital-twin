// No chat/completion request, account balance, key, body, or provider text is
// returned. This can diagnose hosting connectivity without paid generation.
export async function checkProviderConnection({ apiKey, fetchImpl }) {
  if (!apiKey?.trim()) return { ok: false, code: 'MODEL_NOT_CONFIGURED' };
  try {
    const response = await fetchImpl('https://api.deepseek.com/models', {
      method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return { ok: false, code: response.status === 401 ? 'MODEL_AUTH_FAILED'
      : response.status >= 300 && response.status < 400 ? 'MODEL_REDIRECTED' : 'MODEL_ACCESS_FAILED', httpStatus: response.status };
    const data = await response.json();
    return { ok: data.data?.some(model => model.id === 'deepseek-flash') === true,
      code: data.data?.some(model => model.id === 'deepseek-flash') ? 'MODEL_CONNECTED' : 'MODEL_NOT_LISTED', httpStatus: response.status };
  } catch (error) {
    const message = String(error?.message || '');
    return { ok: false, code: /illegal invocation|incorrect.*this/i.test(message) ? 'MODEL_FETCH_CONTEXT'
      : /redirect/i.test(message) ? 'MODEL_REDIRECTED' : /blocked|denied|disallowed|not allowed|egress/i.test(message) ? 'MODEL_NETWORK_DENIED'
      : error?.name === 'SyntaxError' ? 'MODEL_NON_JSON' : /timeout|abort/i.test(error?.name || '') ? 'MODEL_TIMEOUT' : 'MODEL_NETWORK_FAILED' };
  }
}
