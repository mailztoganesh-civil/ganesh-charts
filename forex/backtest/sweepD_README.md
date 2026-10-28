# ICT 1D Sweep backtest – summary (CHoCH on 1H)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf D EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 256 |
| with lower-timeframe CHoCH | 251 |
| orders placed | 251 |
| filled | 211 |
| cancelled: invalidated | 4 |
| cancelled: missed | 5 |
| cancelled: expired | 31 |
| cancelled: fill and target in one bar | 0 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | -0.116 (86) | -0.371 (65) | -0.052 (60) | 13% |
| grade A or B | -0.060 (81) | -0.598 (61) | +0.057 (54) | 13% |
| grade A | +0.229 (49) | -0.583 (47) | -0.016 (38) | 15% |
| grade B | -0.500 (32) | -0.650 (14) | +0.231 (16) | 10% |
| grade C | -1.000 (5) | +3.075 (4) | -1.017 (6) | 7% |
| 4H swing >= 1.5 ATR | -0.072 (82) | -0.363 (57) | +0.056 (54) | 13% |
| sweep 0.1-1.0 ATR | -0.053 (58) | -0.550 (46) | -0.272 (39) | 13% |
| displacement >= 1.5 ATR | +0.168 (38) | -0.415 (33) | +0.108 (24) | 18% |
| FVG zone only | +0.275 (55) | -0.537 (52) | +0.190 (48) | 16% |
| R:R >= 2 | -0.116 (86) | -0.441 (63) | -0.046 (57) | 12% |
| entry in discount / premium (TTrades) | -0.113 (30) | +0.044 (16) | -0.370 (20) | 8% |
| TTrades checklist 5/5 | -0.113 (30) | +0.044 (16) | -0.370 (20) | 8% |
| A1 = grade A + TTrades checklist 5/5 | +0.692 (12) | -1.000 (6) | -0.015 (13) | 10% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | -0.107 (55) | -0.572 (46) | +0.350 (38) | 15% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 23 | 17.4% | +0.658 ± 0.804 | 1.79 | +15.1 | 7.1 |
| GBPUSD | 26 | 3.8% | -0.851 ± 0.159 | 0.12 | -22.1 | 22.1 |
| AUDUSD | 42 | 14.3% | -0.303 ± 0.331 | 0.65 | -12.7 | 17.1 |
| NZDUSD | 27 | 14.8% | -0.330 ± 0.336 | 0.62 | -8.9 | 10.4 |
| USDCAD | 24 | 16.7% | +0.109 ± 0.707 | 1.13 | +2.6 | 8.1 |
| USDCHF | 27 | 11.1% | -0.118 ± 0.53 | 0.86 | -3.2 | 17.3 |
| USDJPY | 26 | 11.5% | -0.030 ± 0.646 | 0.97 | -0.8 | 14.1 |
| XAUUSD | 16 | 12.5% | -0.456 ± 0.375 | 0.45 | -7.3 | 7.9 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
