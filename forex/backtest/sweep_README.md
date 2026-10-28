# ICT 4H Sweep backtest – summary (CHoCH on 15m)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf 4H EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 1525 |
| with 15m CHoCH | 1412 |
| orders placed | 1410 |
| filled | 1137 |
| cancelled: invalidated | 8 |
| cancelled: missed | 44 |
| cancelled: expired | 221 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | +0.119 (457) | +0.333 (295) | -0.019 (385) | 21% |
| grade A or B | +0.176 (430) | +0.249 (282) | -0.061 (353) | 21% |
| grade A | +0.258 (281) | +0.222 (206) | -0.104 (249) | 23% |
| 4H swing >= 1.5 ATR | +0.138 (423) | +0.376 (275) | -0.068 (346) | 21% |
| sweep 0.1-1.0 ATR | +0.321 (300) | +0.297 (216) | -0.042 (274) | 22% |
| displacement >= 1.5 ATR | -0.089 (193) | -0.048 (141) | +0.060 (147) | 24% |
| FVG zone only | +0.139 (378) | +0.255 (247) | -0.037 (319) | 23% |
| R:R >= 2 | +0.139 (414) | +0.380 (265) | -0.009 (350) | 19% |
| entry in discount / premium (TTrades) | -0.092 (96) | +0.816 (77) | -0.192 (87) | 11% |
| TTrades checklist 5/5 | -0.092 (96) | +0.809 (76) | -0.192 (87) | 11% |
| A1 = grade A + TTrades checklist 5/5 | +0.374 (50) | +0.065 (43) | -0.157 (49) | 13% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | +0.264 (281) | +0.315 (199) | -0.073 (256) | 24% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 143 | 25.2% | +0.134 ± 0.2 | 1.18 | +19.1 | 36.5 |
| GBPUSD | 148 | 17.6% | -0.119 ± 0.203 | 0.86 | -17.7 | 36.9 |
| AUDUSD | 129 | 24.0% | +0.206 ± 0.257 | 1.27 | +26.5 | 26.9 |
| NZDUSD | 158 | 20.9% | +0.173 ± 0.242 | 1.21 | +27.4 | 28.2 |
| USDCAD | 160 | 20.0% | +0.244 ± 0.24 | 1.3 | +39.1 | 36.1 |
| USDCHF | 157 | 24.2% | +0.646 ± 0.389 | 1.83 | +101.4 | 23.9 |
| USDJPY | 123 | 14.6% | -0.372 ± 0.197 | 0.57 | -45.7 | 49.4 |
| XAUUSD | 119 | 21.8% | -0.042 ± 0.202 | 0.95 | -5.0 | 23.4 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
