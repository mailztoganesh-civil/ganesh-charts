# ICT 2H Sweep backtest – summary (CHoCH on 5m)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf 2H EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 3103 |
| with 15m CHoCH | 2998 |
| orders placed | 2996 |
| filled | 2354 |
| cancelled: invalidated | 41 |
| cancelled: missed | 134 |
| cancelled: expired | 467 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | -0.003 (903) | -0.051 (617) | +0.042 (834) | 17% |
| grade A or B | -0.015 (844) | -0.013 (570) | +0.047 (776) | 17% |
| grade A | +0.035 (561) | +0.057 (396) | +0.039 (521) | 18% |
| 4H swing >= 1.5 ATR | +0.021 (824) | -0.027 (563) | +0.036 (761) | 17% |
| sweep 0.1-1.0 ATR | -0.006 (574) | +0.011 (417) | +0.057 (524) | 18% |
| displacement >= 1.5 ATR | -0.048 (353) | -0.046 (228) | +0.137 (342) | 20% |
| FVG zone only | +0.036 (773) | +0.045 (517) | -0.066 (709) | 18% |
| R:R >= 2 | -0.016 (852) | -0.056 (586) | +0.049 (789) | 15% |
| entry in discount / premium (TTrades) | -0.038 (186) | -0.122 (121) | +0.322 (198) | 11% |
| TTrades checklist 5/5 | -0.033 (185) | -0.128 (119) | +0.322 (198) | 11% |
| A1 = grade A + TTrades checklist 5/5 | +0.673 (92) | +0.294 (62) | +0.094 (110) | 14% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | -0.048 (559) | -0.023 (402) | +0.023 (525) | 19% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 298 | 16.8% | -0.118 ± 0.145 | 0.86 | -35.2 | 81.4 |
| GBPUSD | 279 | 15.1% | -0.065 ± 0.174 | 0.93 | -18.2 | 91.1 |
| AUDUSD | 291 | 16.2% | -0.108 ± 0.165 | 0.88 | -31.3 | 63.2 |
| NZDUSD | 325 | 18.5% | +0.121 ± 0.178 | 1.14 | +39.3 | 42.6 |
| USDCAD | 292 | 17.5% | -0.002 ± 0.173 | 1.0 | -0.6 | 70.9 |
| USDCHF | 333 | 17.1% | +0.090 ± 0.216 | 1.1 | +29.8 | 67.1 |
| USDJPY | 277 | 16.6% | -0.050 ± 0.195 | 0.94 | -13.9 | 64.3 |
| XAUUSD | 259 | 19.3% | +0.118 ± 0.243 | 1.14 | +30.6 | 38.5 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
