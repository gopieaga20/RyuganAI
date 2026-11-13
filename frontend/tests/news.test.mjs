// Same cases as backend/tests/test_autotrader.py test_news_keywords_match_whole_words_only: the dashboard and the auto-trader must agree.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { location: { protocol: 'http:' } };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;                // news.js refreshes on a timer at load; not wanted in a test
const { NewsFilter } = await import('../js/news.js');
globalThis.setInterval = realSetInterval;
const label = (...t) => NewsFilter.score(t.map(title => ({ title }))).label;

test('news keywords match whole words only', () => {
  assert.equal(label('HDFC Bank opens new branch', 'SBI bank results on Friday'), 'NEUTRAL');
  assert.equal(label('Infosys enterprise deal'), 'NEUTRAL');
  assert.equal(label('Nifty against the trend'), 'NEUTRAL');
  assert.equal(label('Markets weigh risk of rate cut', 'Analysts voice concern'), 'NEUTRAL');
  assert.equal(label('Reliance shares rallied 3%', 'TCS gains after deal'), 'BULLISH');
  assert.equal(label('Govt bans exports', 'Stock dropped 4%', 'Shares falling'), 'BEARISH');
});
