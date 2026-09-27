'use strict';

import { CONFIG } from './config.js';
import { algoFallback } from './signals.js';

export async function callClaude(userPrompt, systemPrompt, useSearch = true) {
  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/ai/chat', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!res.ok) {
      // 503 = AI not configured on the server; anything else = transient failure.
      // Either way, degrade gracefully to the deterministic algo signals.
      return algoFallback(userPrompt);
    }

    const data = await res.json();
    return data.text || '';

  } catch (err) {
    console.error('AI proxy error:', err);
    return algoFallback(userPrompt);
  }
}

/* Extract JSON safely from any response string */
export function extractJson(raw) {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}
