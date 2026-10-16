import config from '../config.js';

export async function confirmTelegramLink({token, telegram}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${config.VAL_API_BASE_URL}/api/integrations/telegram/confirm-link`, {
      method:'POST',
      headers:{'content-type':'application/json', authorization:`Bearer ${config.VAL_BOT_SHARED_SECRET}`},
      body:JSON.stringify({token, telegram}),
      signal:controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const err = new Error(body.message || `VAL API returned ${response.status}`); err.status=response.status; throw err; }
    return body;
  } finally { clearTimeout(timer); }
}
