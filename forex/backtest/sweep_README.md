# ICT 4H Sweep backtest – summary

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| 4H sweeps (closed back inside) | 4399 |
| with 15m CHoCH | 4146 |
| orders placed | 4135 |
| filled | 3310 |
| cancelled: invalidated | 35 |
| cancelled: missed | 389 |
| cancelled: expired | 401 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | +0.229 (1321) | -0.067 (867) | +0.054 (1122) | 25% |
| grade A or B | +0.257 (1150) | -0.086 (774) | +0.065 (949) | 25% |
| grade A | +0.294 (682) | -0.043 (468) | +0.054 (573) | 25% |
| 4H swing >= 1.5 ATR | +0.254 (1123) | -0.100 (723) | +0.008 (916) | 24% |
| sweep 0.1-1.0 ATR | +0.220 (846) | -0.025 (591) | +0.019 (709) | 25% |
| displacement >= 1.5 ATR | +0.166 (548) | -0.158 (348) | +0.140 (421) | 30% |
| FVG zone only | +0.270 (1074) | -0.054 (714) | +0.054 (921) | 27% |
| R:R >= 2 | +0.253 (1059) | -0.053 (696) | +0.068 (921) | 19% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | +0.196 (789) | -0.036 (554) | +0.036 (666) | 27% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 407 | 25.3% | +0.079 ± 0.115 | 1.1 | +32.0 | 63.9 |
| GBPUSD | 419 | 25.3% | +0.107 ± 0.123 | 1.14 | +45.0 | 38.2 |
| AUDUSD | 398 | 24.9% | -0.008 ± 0.112 | 0.99 | -3.3 | 49.4 |
| NZDUSD | 437 | 23.3% | +0.010 ± 0.115 | 1.01 | +4.4 | 50.7 |
| USDCAD | 434 | 28.1% | +0.342 ± 0.138 | 1.46 | +148.6 | 28.9 |
| USDCHF | 450 | 26.9% | +0.350 ± 0.167 | 1.47 | +157.5 | 29.5 |
| USDJPY | 392 | 20.7% | -0.031 ± 0.146 | 0.96 | -12.2 | 70.0 |
| XAUUSD | 373 | 20.9% | -0.179 ± 0.106 | 0.78 | -66.8 | 85.7 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
