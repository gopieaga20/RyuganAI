// Helper for backend/tests/test_strategy_parity.py: prints the JS strategy vote at several end bars of the candles
// read from stdin, so Python can check its port gives identical results.
import fs from 'node:fs';
import { evaluate } from '../js/strategies.js';

const { candles, ends, intraday, news } = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = ends.map(e => {
  const r = evaluate(candles.slice(0, e + 1), { intraday, news: news ? { label: news } : null });
  return { end: e, call: r.call, confidence: r.confidence, score: r.score, maxScore: r.maxScore, adx: r.adx, atr: r.atr, rsi: r.rsi,
    votes: r.votes.map(v => ({ id: v.id, vote: v.vote, weight: v.weight })) };
});
process.stdout.write(JSON.stringify(out));
