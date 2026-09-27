'use strict';

export const Indicators = {
  ema(arr, period) {
    const k = 2 / (period + 1);
    let e = arr[0];
    return arr.map((v, i) => {
      if (i === 0) { e = v; return e; }
      e = v * k + e * (1 - k);
      return e;
    });
  },

  rsi(closes, period = 14) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < period) { result.push(50); continue; }
      let gain = 0, loss = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - closes[j - 1];
        if (d > 0) gain += d; else loss -= d;
      }
      const rs = (gain / period) / ((loss / period) || 0.0001);
      result.push(100 - 100 / (1 + rs));
    }
    return result;
  },

  bb(closes, period = 20, stdDev = 2) {
    return closes.map((_, i) => {
      if (i < period) return { mid: closes[i], upper: closes[i], lower: closes[i], width: 0 };
      const slice = closes.slice(i - period + 1, i + 1);
      const mid = slice.reduce((a, b) => a + b) / period;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
      return { mid, upper: mid + stdDev * std, lower: mid - stdDev * std, width: (stdDev * 2 * std) / mid * 100 };
    });
  },

  vwap(candles) {
    const result = [];
    let cumTPV = 0, cumVol = 0, lastDate = '';
    candles.forEach(c => {
      const d = c.date.toISOString().slice(0, 10);
      if (d !== lastDate) { cumTPV = 0; cumVol = 0; lastDate = d; }
      const tp = (c.h + c.l + c.c) / 3;
      cumTPV += tp * (c.v || 1);
      cumVol += (c.v || 1);
      result.push(cumVol > 0 ? cumTPV / cumVol : c.c);
    });
    return result;
  },

  atr(candles, period = 14) {
    const atr = [0];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].h - candles[i].l,
        Math.abs(candles[i].h - candles[i - 1].c),
        Math.abs(candles[i].l - candles[i - 1].c)
      );
      if (i < period) atr.push(tr);
      else if (i === period) atr.push((atr.reduce((a, b) => a + b, 0) + tr) / period);
      else atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
    return atr;
  },

  /** Indian market transaction charges */
  charges(entryPrice, exitPrice, qty, segment = 'intraday') {
    const bv = entryPrice * qty;
    const sv = exitPrice * qty;
    const brokerage = Math.min(20, bv * 0.0003) + Math.min(20, sv * 0.0003);
    let stt = 0, exchg = 0;

    if (segment === 'intraday') {
      stt = sv * 0.00025;
      exchg = (bv + sv) * 0.0000325;
    } else if (segment === 'futures') {
      stt = sv * 0.000125;
      exchg = (bv + sv) * 0.0000195;
    } else if (segment === 'options') {
      stt = sv * 0.000625;
      exchg = (bv + sv) * 0.0000500;
    }
    const gst = (brokerage + exchg) * 0.18;
    const stamp = bv * 0.00003;
    return Math.round(brokerage + stt + exchg + gst + stamp);
  }
};
