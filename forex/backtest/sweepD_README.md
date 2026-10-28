# ICT 1D Sweep backtest – summary (CHoCH on 1H)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf D EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 770 |
| with 15m CHoCH | 753 |
| orders placed | 753 |
| filled | 635 |
| cancelled: invalidated | 21 |
| cancelled: missed | 55 |
| cancelled: expired | 42 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | +0.282 (279) | +0.006 (149) | -0.232 (207) | 22% |
| grade A or B | +0.188 (247) | -0.069 (126) | -0.184 (185) | 22% |
| grade A | +0.287 (168) | -0.144 (84) | -0.094 (126) | 24% |
| 4H swing >= 1.5 ATR | +0.312 (245) | -0.016 (116) | -0.202 (180) | 22% |
| sweep 0.1-1.0 ATR | +0.189 (176) | -0.221 (102) | -0.248 (128) | 22% |
| displacement >= 1.5 ATR | +0.416 (138) | +0.158 (73) | -0.291 (99) | 28% |
| FVG zone only | +0.236 (226) | -0.028 (107) | -0.058 (170) | 25% |
| R:R >= 2 | +0.306 (239) | -0.016 (128) | -0.254 (187) | 18% |
| entry in discount / premium (TTrades) | +0.428 (79) | +0.341 (39) | -0.415 (66) | 14% |
| TTrades checklist 5/5 | +0.428 (79) | +0.341 (39) | -0.415 (66) | 14% |
| A1 = grade A + TTrades checklist 5/5 | +0.489 (38) | +0.364 (14) | +0.016 (38) | 17% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | +0.249 (176) | -0.147 (93) | -0.066 (136) | 24% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 73 | 24.7% | +0.149 ± 0.269 | 1.2 | +10.9 | 10.2 |
| GBPUSD | 80 | 15.0% | -0.131 ± 0.275 | 0.85 | -10.4 | 22.3 |
| AUDUSD | 106 | 23.6% | +0.041 ± 0.222 | 1.05 | +4.3 | 26.9 |
| NZDUSD | 78 | 23.1% | +0.055 ± 0.281 | 1.07 | +4.3 | 14.5 |
| USDCAD | 90 | 22.2% | +0.149 ± 0.347 | 1.19 | +13.4 | 23.9 |
| USDCHF | 75 | 29.3% | +0.151 ± 0.26 | 1.21 | +11.3 | 11.8 |
| USDJPY | 73 | 13.7% | -0.143 ± 0.293 | 0.83 | -10.4 | 19.3 |
| XAUUSD | 60 | 26.7% | +0.138 ± 0.301 | 1.19 | +8.3 | 15.2 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
