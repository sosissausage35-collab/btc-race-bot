# btc-race-bot

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/sosissausage35-collab/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/sosissausage35-collab/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

A BTC trading bot for the [make.fun 24-hour race](https://make.fun/bounty/btc-race-24h-20261118-1444): it trades cbBTC vs USDC, one minute at a time, on replayed 1-minute bars, long only, starting from 1,000 USDC paper money.

## Strategy

A slow EMA trend follower, built for a market where a typical 1-minute move is about 7 bps and a full round trip costs roughly 26-35 bps in fees, slippage and price impact — so frequent trading loses money and this bot trades rarely, only on a confirmed multi-hour trend:

- **Entry:** the 60-bar EMA crosses above the 240-bar EMA, confirmed by a 60-bar return of at least +0.2% and by the price sitting no more than +0.3% above the slow EMA (an early cross, not an extended pop). Full size.
- **Exit:** a 0.8% trailing stop from the peak since entry, a 0.3% hard stop below the entry fill, or the fast EMA crossing back below the slow one.
- **Guardrail trade:** if no trade has filled by bar 1200 and the fast EMA is above the slow one, buy a small 25% position so the entry still meets the at-least-1-trade bar on a flat window.

Everything is deterministic: no randomness, no clock, no environment, no files. The only inputs are the bars the harness sends in each batch.

## Dev result

On the kit's dev window (1,440 bars, BTC $65,083 -> $62,261): **+7.45 USDC net PnL, 2 trades, max drawdown -0.97%**. First half +7.45, second half 0.00 (no trade, no loss — the strategy stays out when there is no trend). For comparison, every kit baseline loses money on the same window (buy-and-hold -31.63, momentum -23.87, ema-cross -148.17, adx-momentum -75.57, rsi-bollinger -39.92).

## Files

- `main.ts` — the bot (Node 22, stdlib only, erasable TypeScript).
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's bars shim.

## Run

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/btc-race-bot --driver process
```
