# ICT 4H Sweep backtest – summary (CHoCH on 15m)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf 4H EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 1525 |
| with lower-timeframe CHoCH | 1412 |
| orders placed | 1411 |
| filled | 1113 |
| cancelled: invalidated | 8 |
| cancelled: missed | 50 |
| cancelled: expired | 240 |
| cancelled: fill and target in one bar | 0 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | +0.124 (437) | +0.337 (294) | -0.045 (382) | 20% |
| grade A or B | +0.207 (404) | +0.253 (281) | -0.089 (350) | 21% |
| grade A | +0.226 (260) | +0.234 (204) | -0.100 (246) | 22% |
| grade B | +0.174 (144) | +0.303 (77) | -0.064 (104) | 18% |
| grade C | -0.897 (33) | +2.169 (13) | +0.444 (32) | 15% |
| 4H swing >= 1.5 ATR | +0.143 (404) | +0.380 (274) | -0.098 (343) | 20% |
| sweep 0.1-1.0 ATR | +0.325 (287) | +0.304 (215) | -0.078 (271) | 21% |
| displacement >= 1.5 ATR | -0.082 (185) | -0.043 (140) | +0.059 (146) | 24% |
| FVG zone only | +0.156 (335) | +0.271 (244) | -0.034 (316) | 23% |
| R:R >= 2 | +0.149 (403) | +0.384 (264) | -0.038 (349) | 18% |
| entry in discount / premium (TTrades) | -0.106 (111) | +0.767 (79) | -0.323 (88) | 10% |
| TTrades checklist 5/5 | -0.106 (111) | +0.760 (78) | -0.323 (88) | 10% |
| A1 = grade A + TTrades checklist 5/5 | +0.231 (49) | +0.041 (44) | -0.174 (50) | 13% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | +0.293 (268) | +0.322 (198) | -0.111 (253) | 24% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 141 | 24.8% | +0.122 ± 0.203 | 1.16 | +17.2 | 36.5 |
| GBPUSD | 146 | 17.1% | -0.121 ± 0.206 | 0.86 | -17.6 | 36.8 |
| AUDUSD | 129 | 24.0% | +0.205 ± 0.257 | 1.27 | +26.5 | 26.9 |
| NZDUSD | 154 | 20.1% | +0.173 ± 0.248 | 1.21 | +26.6 | 27.5 |
| USDCAD | 156 | 19.9% | +0.305 ± 0.261 | 1.38 | +47.5 | 36.1 |
| USDCHF | 147 | 21.8% | +0.585 ± 0.41 | 1.72 | +86.1 | 30.5 |
| USDJPY | 123 | 14.6% | -0.373 ± 0.197 | 0.57 | -45.9 | 49.4 |
| XAUUSD | 117 | 21.4% | -0.037 ± 0.205 | 0.95 | -4.3 | 23.4 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
