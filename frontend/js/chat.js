'use strict';

import { CONFIG } from './config.js';
import { DOM } from './dom-utils.js';
import { State } from './state.js';
import { switchTab } from './app.js';

/* ═══════════════════════════════════════════
   MODULE: TAB 7 — AI ANALYST CHAT
═══════════════════════════════════════════ */
export function askA(q) {
  switchTab('analyst');
  const inp = document.getElementById('chat-input');
  if (inp) { inp.value = q; }
  sendChat();
}

export async function sendChat() {
  const inp = document.getElementById('chat-input');
  const q = (inp?.value || '').trim();
  if (!q) return;
  if (inp) inp.value = '';

  addMsg('user', q);
  State.chatHistory.push({ role: 'user', content: q });
  if (State.chatHistory.length > 20) State.chatHistory.splice(0, 2);

  const thinking = addMsg('ai', '<span class="spinr"></span> Fetching live market data...');

  try {
    const res = await fetch(CONFIG.PROXY_BASE + '/api/ai/chat', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: CONFIG.ANALYST_PERSONA,
        messages: State.chatHistory
      })
    });

    if (res.status === 503) {
      thinking.querySelector('.msg-bubble').textContent =
        'AI Analyst is not configured on the server. Set ANTHROPIC_API_KEY in backend/.env to enable it.';
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      thinking.querySelector('.msg-bubble').textContent =
        'AI request failed (' + res.status + ')' + (errBody.detail ? ': ' + String(errBody.detail).slice(0, 120) : '') + '.';
      return;
    }

    const data = await res.json();
    const reply = data.text || 'No text response returned. The model may need a different prompt.';

    // Safe render: textContent for user content, but format markdown-style bold safely
    const bubble = thinking.querySelector('.msg-bubble');
    if (bubble) {
      bubble.innerHTML = reply
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }
    State.chatHistory.push({ role: 'assistant', content: reply });
  } catch (e) {
    const bubble = thinking.querySelector('.msg-bubble');
    if (bubble) bubble.textContent = 'Network error: ' + (e.message || 'Unknown error. Check your internet connection.');
  }
  const ca = document.getElementById('chat-area');
  if (ca) ca.scrollTop = 99999;
}

export function addMsg(role, htmlContent) {
  const area = document.getElementById('chat-area');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  const sender = role === 'user' ? 'YOU' : '◉ RYUGAN ANALYST · 20+ YRS';
  el.innerHTML = `<div class="msg-sender">${DOM.esc(sender)}</div><div class="msg-bubble">${htmlContent}</div>`;
  area?.appendChild(el);
  if (area) area.scrollTop = 99999;
  return el;
}
