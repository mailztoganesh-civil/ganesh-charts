# ICT 1D Sweep backtest – summary (CHoCH on 1H)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf D EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 256 |
| with 15m CHoCH | 251 |
| orders placed | 251 |
| filled | 217 |
| cancelled: invalidated | 4 |
| cancelled: missed | 5 |
| cancelled: expired | 25 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | +0.000 (90) | -0.333 (66) | -0.064 (61) | 15% |
| grade A or B | +0.059 (85) | -0.555 (62) | +0.042 (55) | 16% |
| grade A | +0.281 (57) | -0.527 (48) | -0.038 (39) | 17% |
| 4H swing >= 1.5 ATR | +0.047 (86) | -0.321 (58) | +0.040 (55) | 16% |
| sweep 0.1-1.0 ATR | +0.111 (61) | -0.494 (47) | -0.287 (40) | 16% |
| displacement >= 1.5 ATR | +0.410 (42) | -0.341 (34) | +0.068 (25) | 23% |
| FVG zone only | +0.255 (67) | -0.487 (53) | +0.169 (49) | 18% |
| R:R >= 2 | -0.025 (88) | -0.402 (64) | -0.062 (58) | 13% |
| entry in discount / premium (TTrades) | +0.072 (25) | +0.044 (16) | -0.370 (20) | 8% |
| TTrades checklist 5/5 | +0.072 (25) | +0.044 (16) | -0.370 (20) | 8% |
| A1 = grade A + TTrades checklist 5/5 | +0.845 (11) | -1.000 (6) | -0.015 (13) | 10% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | +0.068 (59) | -0.515 (47) | +0.318 (39) | 19% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 24 | 20.8% | +0.680 ± 0.756 | 1.85 | +16.3 | 7.1 |
| GBPUSD | 26 | 3.8% | -0.851 ± 0.159 | 0.12 | -22.1 | 22.1 |
| AUDUSD | 43 | 16.3% | -0.274 ± 0.324 | 0.68 | -11.8 | 17.1 |
| NZDUSD | 28 | 17.9% | -0.269 ± 0.33 | 0.68 | -7.5 | 10.4 |
| USDCAD | 25 | 16.0% | +0.066 ± 0.68 | 1.08 | +1.7 | 9.1 |
| USDCHF | 29 | 20.7% | +0.189 ± 0.56 | 1.25 | +5.5 | 14.2 |
| USDJPY | 26 | 11.5% | -0.029 ± 0.646 | 0.97 | -0.8 | 14.1 |
| XAUUSD | 16 | 12.5% | -0.456 ± 0.375 | 0.45 | -7.3 | 7.9 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
