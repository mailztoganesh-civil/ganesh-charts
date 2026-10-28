# ICT 2H Sweep backtest – summary (CHoCH on 5m)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf 2H EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 3103 |
| with lower-timeframe CHoCH | 2998 |
| orders placed | 2997 |
| filled | 2390 |
| cancelled: invalidated | 51 |
| cancelled: missed | 115 |
| cancelled: expired | 438 |
| cancelled: fill and target in one bar | 3 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | +0.192 (916) | +0.052 (630) | +0.139 (844) | 18% |
| grade A or B | +0.183 (854) | +0.077 (582) | +0.151 (786) | 19% |
| grade A | +0.260 (562) | +0.189 (404) | +0.127 (527) | 20% |
| grade B | +0.034 (292) | -0.179 (178) | +0.198 (259) | 16% |
| grade C | +0.319 (62) | -0.246 (48) | -0.016 (58) | 14% |
| 4H swing >= 1.5 ATR | +0.238 (837) | +0.066 (574) | +0.142 (771) | 19% |
| sweep 0.1-1.0 ATR | +0.283 (584) | +0.168 (425) | +0.131 (528) | 20% |
| displacement >= 1.5 ATR | +0.035 (358) | +0.016 (233) | +0.216 (344) | 22% |
| FVG zone only | +0.173 (770) | +0.142 (529) | +0.044 (718) | 19% |
| R:R >= 2 | +0.188 (864) | +0.052 (599) | +0.145 (801) | 17% |
| entry in discount / premium (TTrades) | +0.328 (200) | -0.124 (122) | +0.318 (202) | 12% |
| TTrades checklist 5/5 | +0.335 (199) | -0.129 (120) | +0.318 (202) | 12% |
| A1 = grade A + TTrades checklist 5/5 | +1.237 (94) | +0.328 (61) | +0.095 (110) | 15% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | +0.148 (571) | +0.115 (412) | +0.112 (533) | 21% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 299 | 17.1% | -0.062 ± 0.154 | 0.93 | -18.6 | 80.8 |
| GBPUSD | 286 | 18.2% | +0.165 ± 0.196 | 1.2 | +47.2 | 49.0 |
| AUDUSD | 295 | 16.9% | +0.059 ± 0.186 | 1.07 | +17.4 | 49.8 |
| NZDUSD | 333 | 20.4% | +0.289 ± 0.191 | 1.34 | +96.1 | 31.0 |
| USDCAD | 297 | 18.5% | +0.116 ± 0.183 | 1.14 | +34.5 | 44.5 |
| USDCHF | 337 | 18.4% | +0.155 ± 0.222 | 1.18 | +52.4 | 62.5 |
| USDJPY | 283 | 18.0% | +0.066 ± 0.2 | 1.08 | +18.6 | 50.1 |
| XAUUSD | 260 | 19.6% | +0.303 ± 0.269 | 1.37 | +78.8 | 30.8 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
