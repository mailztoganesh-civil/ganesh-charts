# ICT 2H Sweep backtest – summary (CHoCH on 5m)

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. forex-data 5-minute bars from 2023-01-01; costs per pair as in the CRT backtest. Made by `python scripts/sweep_backtest.py <forex-data> --tf 2H EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`; execution rules in that script's header. Average R per filled trade, all pairs pooled; trades in brackets. No threshold was tuned.

## Funnel (all pairs)

| Step | Count |
|---|---|
| sweeps (closed back inside) | 8736 |
| with 15m CHoCH | 8469 |
| orders placed | 8441 |
| filled | 6649 |
| cancelled: invalidated | 105 |
| cancelled: missed | 873 |
| cancelled: expired | 814 |

## Results

| Variant | Train | Validation | Test | Win % (all) |
|---|---|---|---|---|
| all setups (rules as in the app) | -0.038 (2526) | +0.056 (1735) | +0.005 (2388) | 20% |
| grade A or B | -0.021 (2187) | +0.073 (1507) | +0.003 (2072) | 20% |
| grade A | -0.003 (1275) | +0.107 (916) | -0.067 (1240) | 20% |
| 4H swing >= 1.5 ATR | +0.041 (1958) | +0.056 (1366) | -0.038 (1883) | 20% |
| sweep 0.1-1.0 ATR | -0.074 (1572) | +0.216 (1127) | +0.033 (1470) | 21% |
| displacement >= 1.5 ATR | -0.062 (932) | -0.043 (632) | -0.012 (964) | 24% |
| FVG zone only | -0.002 (2145) | +0.040 (1465) | -0.043 (2029) | 21% |
| R:R >= 2 | -0.031 (2140) | +0.084 (1527) | +0.021 (2043) | 16% |
| entry in discount / premium (TTrades) | -0.101 (534) | +0.564 (367) | +0.174 (561) | 13% |
| TTrades checklist 5/5 | -0.104 (525) | +0.568 (364) | +0.178 (552) | 13% |
| A1 = grade A + TTrades checklist 5/5 | +0.301 (215) | +0.779 (164) | +0.094 (263) | 17% |
| app default filters (sweep >= 0.05, displacement >= 1.0, swing >= 1.0) | -0.103 (1491) | +0.140 (1075) | +0.030 (1458) | 22% |

## Per pair (all setups, whole period)

| Pair | Trades | Win | Avg R | PF | Sum R | Max DD |
|---|---|---|---|---|---|---|
| EURUSD | 768 | 20.3% | +0.026 ± 0.097 | 1.03 | +19.8 | 72.2 |
| GBPUSD | 801 | 18.0% | -0.089 ± 0.09 | 0.9 | -71.3 | 184.0 |
| AUDUSD | 858 | 17.5% | -0.193 ± 0.081 | 0.78 | -165.7 | 192.1 |
| NZDUSD | 891 | 20.5% | +0.183 ± 0.124 | 1.22 | +162.8 | 57.9 |
| USDCAD | 890 | 21.6% | +0.146 ± 0.105 | 1.18 | +129.8 | 77.7 |
| USDCHF | 908 | 20.9% | +0.026 ± 0.104 | 1.03 | +24.0 | 102.2 |
| USDJPY | 791 | 20.4% | +0.025 ± 0.1 | 1.03 | +19.4 | 73.5 |
| XAUUSD | 742 | 18.6% | -0.141 ± 0.097 | 0.83 | -104.5 | 135.1 |

Not tested here: the CRT-confluence filter (it needs the CRT state at each moment), news, swaps.
