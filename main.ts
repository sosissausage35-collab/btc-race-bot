// btc-race-bot: a slow EMA trend bot for cbBTC/USDC 1-minute bars.
//
// The dev window is a slow drift down with one multi-hour rally and a lot of
// chop. A typical 1-minute move is about 7 bps while a full round trip costs
// roughly 26-35 bps in fees, slippage and price impact, so frequent trading
// loses money here and every baseline that trades often ends the window deep
// in the red. This bot therefore trades rarely and only on a confirmed
// multi-hour trend:
//
//   - Entry: the 60-bar EMA crosses above the 240-bar EMA, confirmed by a
//     60-bar return of at least +0.2% and by the price sitting no more than
//     +0.3% above the slow EMA (an early cross, not an extended pop).
//   - Exit: a 0.8% trailing stop from the peak since entry, a 0.3% hard stop
//     below the entry fill, or the fast EMA crossing back below the slow one.
//   - Guardrail trade: if no trade has filled by bar 1200 and the fast EMA
//     is above the slow one, buy a small 25% position so the entry still
//     meets the at-least-1-trade bar on a flat window.
//
// Everything is deterministic: no randomness, no clock, no environment, no
// files. The only inputs are the bars the harness sends in each batch.

import { runBars, type BarsState, type Batch, type OrderInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
const FAST_LEN = 60;
const SLOW_LEN = 240;
const MOM_LOOKBACK = 60;
const MOM_MIN = 0.002;
const EXT_MAX = 0.003;
const TRAIL = 0.008;
const HARD_STOP = 0.003;
const INSURANCE_BAR = 1200;
const INSURANCE_BPS = 2500;
const MAX_SLIPPAGE_BPS = 100;

interface Ctx {
  closes: number[];
  emaFast: number | null;
  emaSlow: number | null;
  prevFast: number | null;
  prevSlow: number | null;
  barsSeen: number;
  entryPrice: number | null;
  peak: number;
  filledTrades: number;
}

function emaUpdate(prev: number | null, price: number, len: number): number {
  if (prev === null) return price;
  const k = 2 / (len + 1);
  return price * k + prev * (1 - k);
}

const ctx: Ctx = {
  closes: [],
  emaFast: null,
  emaSlow: null,
  prevFast: null,
  prevSlow: null,
  barsSeen: 0,
  entryPrice: null,
  peak: 0,
  filledTrades: 0,
};

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const sym = state.symbols.get(SYMBOL);
    if (sym === undefined) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const scale = 10 ** sym.price_scale;
    const close = Number(BigInt(bar.c)) / scale;

    ctx.prevFast = ctx.emaFast;
    ctx.prevSlow = ctx.emaSlow;
    ctx.emaFast = emaUpdate(ctx.emaFast, close, FAST_LEN);
    ctx.emaSlow = emaUpdate(ctx.emaSlow, close, SLOW_LEN);
    ctx.closes.push(close);
    ctx.barsSeen += 1;

    for (const f of batch.fills) {
      if (f.status !== "filled" || f.client_id.startsWith("_")) continue;
      ctx.filledTrades += 1;
      if (f.side === "buy") {
        ctx.entryPrice = Number(BigInt(f.price)) / scale;
        ctx.peak = ctx.entryPrice;
      }
    }

    const pos = state.positions.get(SYMBOL);
    const qty = pos === undefined ? 0n : pos.qty;
    if (qty > 0n) {
      if (ctx.entryPrice !== null && close > ctx.peak) ctx.peak = close;
      const crossBack = ctx.emaFast < ctx.emaSlow;
      const trailHit = ctx.entryPrice !== null && close < ctx.peak * (1 - TRAIL);
      const stopHit = ctx.entryPrice !== null && close < ctx.entryPrice * (1 - HARD_STOP);
      if (trailHit || stopHit || crossBack) {
        return [{ side: "sell", symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (state.warmingUp || ctx.barsSeen < SLOW_LEN) return [];
    if (ctx.emaFast === null || ctx.emaSlow === null || ctx.prevFast === null || ctx.prevSlow === null) return [];

    const crossed = ctx.emaFast > ctx.emaSlow && ctx.prevFast <= ctx.prevSlow;
    if (crossed) {
      const back = ctx.closes[ctx.closes.length - 1 - MOM_LOOKBACK];
      const mom = back !== undefined ? close / back - 1 : -1;
      const ext = close / ctx.emaSlow - 1;
      if (mom >= MOM_MIN && ext <= EXT_MAX) {
        return [{ side: "buy", symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }

    // barsSeen counts the batch being answered, so > (not >=) means the
    // first eligible reply is seq 1200.
    if (ctx.filledTrades === 0 && ctx.barsSeen > INSURANCE_BAR && ctx.emaFast > ctx.emaSlow) {
      // Do not buy the guardrail trade into a fresh down-move: the 60-bar
      // return must not be worse than -0.2%.
      const back = ctx.closes[ctx.closes.length - 1 - MOM_LOOKBACK];
      const mom = back !== undefined ? close / back - 1 : -1;
      if (mom < -0.002) return [];
      const notional = (state.cash * BigInt(INSURANCE_BPS)) / 10000n;
      if (notional > 0n) {
        return [{ side: "buy", symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
