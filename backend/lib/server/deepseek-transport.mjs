import { PublicError } from './persona-service.mjs';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

/** Never enable by merely finding an API key. Requires explicit budget + gate. */
export function createDeepSeekTransport({ apiKey, model, enabled = false, approvedCallBudget = 0, reserveCall, fetchImpl }) {
  let attempts = 0;
  return async (messages) => {
    if (enabled !== true || !Number.isInteger(approvedCallBudget) || approvedCallBudget < 1 || attempts >= approvedCallBudget) throw new PublicError('BUDGET_DISABLED', '真实模型调用未授权或额度已用完。', 503);
    if (typeof reserveCall !== 'function' || typeof fetchImpl !== 'function') throw new PublicError('BUDGET_GATE_REQUIRED', '缺少服务端预算闸门或明确传入的网络通道。', 503);
    if (typeof apiKey !== 'string' || !apiKey.trim() || typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(model)) throw new PublicError('MODEL_NOT_CONFIGURED', '后端模型配置不完整。', 503);
    // Reserve synchronously before any await; failures/timeouts also consume one attempt.
    attempts += 1;
    let reserved;
    try { reserved = await reserveCall(); } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError('BUDGET_UNAVAILABLE', '预算校验不可用，未发出模型请求。', 503);
    }
    if (reserved !== true) throw new PublicError('BUDGET_EXHAUSTED', '服务端预算不足，未发出模型请求。', 429);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, thinking: { type: 'disabled' }, stream: false, max_tokens: 800, response_format: { type: 'json_object' } })
      });
      // workerd rejects redirect:'error' before any network request. Manual
      // mode plus explicit 3xx rejection preserves the no-redirect boundary.
      if (response.status >= 300 && response.status < 400) {
        throw new PublicError('MODEL_REDIRECTED', '模型接口发生了意外跳转，已停止且未跟随跳转；该次预算按已尝试计。', 503);
      }
      if (!response.ok) {
        // Only a fixed category leaves this adapter. Never expose the provider
        // body, credentials, headers, or request content in errors or logs.
        const failures = {
          400: ['MODEL_REQUEST_REJECTED', '模型接口拒绝了请求格式，需要维护者检查配置。'],
          401: ['MODEL_AUTH_FAILED', '模型服务鉴权失败，需要维护者检查服务端密钥。'],
          402: ['MODEL_BALANCE_UNAVAILABLE', '模型服务账户余额不可用，AI暂时无法回答。'],
          403: ['MODEL_ACCESS_DENIED', '模型服务拒绝了本站访问，需要维护者检查接入权限。'],
          422: ['MODEL_REQUEST_REJECTED', '模型接口参数不兼容，需要维护者检查配置。'],
          429: ['MODEL_RATE_LIMITED', '模型服务暂时限流，未自动重试。'],
        };
        const [code, message] = failures[response.status] || ['MODEL_UNAVAILABLE', '模型服务暂不可用，未自动重试。'];
        throw new PublicError(code, `${message}该次预算按已尝试计，可以先查看原文。`, 503);
      }
      const data = await response.json();
      if (data.choices?.[0]?.finish_reason !== 'stop' || typeof data.choices[0].message?.content !== 'string' || !data.choices[0].message.content.trim()) {
        throw new PublicError('MODEL_INCOMPLETE', '模型未返回完整回答，未自动重试；该次预算按已尝试计，可以先查看原文。', 503);
      }
      return data.choices[0].message.content;
    } catch (error) {
      if (error instanceof PublicError) throw error;
      throw new PublicError(controller.signal.aborted ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE',
        controller.signal.aborted ? '模型响应超时，未自动重试；该次预算按已尝试计，可以先查看原文。'
          : '模型网络连接或响应异常，未自动重试；该次预算按已尝试计，可以先查看原文。', 503);
    }
    finally { clearTimeout(timer); }
  };
}
