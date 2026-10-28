# ICT sweep – validation backtest

Data: forex-data 5-minute bars (HistData, bid), 2023-01 to 2026-10. Periods in time order: train 2023-01..2024-06, validation 2024-07..2025-06, test 2025-07..end. Costs per pair (spread + slippage, e.g. EURUSD 0.8 + 0.2 pips; XAUUSD 30 + 10 cents). Entry: limit at the zone edge, placed when the lower-timeframe candle after the CHoCH has closed, fillable only after the higher-timeframe sweep candle closed; stop = sweep extreme; target = opposite liquidity; a 5-minute bar touching stop and target counts as a stop; entry and target in one bar = no trade. No parameter was fitted. Expectancy = average R per trade. Max drawdown from the equity curve of the trades in time order (all pairs merged in the pooled table).

## EURUSD only

### 1D → 1H

| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |
|---|---|---|---|---|---|---|
| all setups | train | 11 | +0.934 ± 1.307 | 2.13 | 18% | 7.1 |
| all setups | validation | 7 | -0.225 ± 0.782 | 0.74 | 14% | 4.0 |
| all setups | test | 5 | +1.289 ± 2.298 | 2.60 | 20% | 2.0 |
| all setups | all | 23 | +0.658 ± 0.804 | 1.79 | 17% | 7.1 |
| grade A | train | 6 | +0.878 ± 1.887 | 2.04 | 17% | 5.0 |
| grade A | validation | 7 | -0.225 ± 0.782 | 0.74 | 14% | 4.0 |
| grade A | test | 2 | -1.012 ± 0.005 | 0.00 | 0% | 2.0 |
| grade A | all | 15 | +0.111 ± 0.815 | 1.13 | 13% | 6.0 |
| grade B | train | 4 | +1.504 ± 2.517 | 2.98 | 25% | 2.0 |
| grade B | validation | – | – | – | – | – |
| grade B | test | 2 | +4.738 ± 5.741 | 10.45 | 50% | 1.0 |
| grade B | all | 6 | +2.582 ± 2.279 | 4.83 | 33% | 2.0 |
| grade C | train | 1 | -1.013 ± – | 0.00 | 0% | 1.0 |
| grade C | validation | – | – | – | – | – |
| grade C | test | 1 | -1.006 ± – | 0.00 | 0% | 1.0 |
| grade C | all | 2 | -1.009 ± 0.003 | 0.00 | 0% | 2.0 |
| checklist 5/5 | train | 3 | -1.014 ± 0.003 | 0.00 | 0% | 3.0 |
| checklist 5/5 | validation | 1 | -1.003 ± – | 0.00 | 0% | 1.0 |
| checklist 5/5 | test | 1 | -1.017 ± – | 0.00 | 0% | 1.0 |
| checklist 5/5 | all | 5 | -1.012 ± 0.003 | 0.00 | 0% | 5.1 |
| A1 (A + 5/5) | train | 1 | -1.012 ± – | 0.00 | 0% | 1.0 |
| A1 (A + 5/5) | validation | 1 | -1.003 ± – | 0.00 | 0% | 1.0 |
| A1 (A + 5/5) | test | 1 | -1.017 ± – | 0.00 | 0% | 1.0 |
| A1 (A + 5/5) | all | 3 | -1.011 ± 0.004 | 0.00 | 0% | 3.0 |

### 4H → 15m

| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |
|---|---|---|---|---|---|---|
| all setups | train | 50 | +0.408 ± 0.353 | 1.59 | 32% | 7.0 |
| all setups | validation | 38 | -0.855 ± 0.095 | 0.08 | 8% | 32.5 |
| all setups | test | 53 | +0.553 ± 0.402 | 1.79 | 30% | 7.6 |
| all setups | all | 141 | +0.122 ± 0.203 | 1.16 | 25% | 36.5 |
| grade A | train | 27 | -0.074 ± 0.335 | 0.90 | 26% | 10.6 |
| grade A | validation | 30 | -0.847 ± 0.116 | 0.10 | 7% | 25.4 |
| grade A | test | 32 | +0.405 ± 0.471 | 1.57 | 28% | 7.1 |
| grade A | all | 89 | -0.162 ± 0.207 | 0.80 | 20% | 36.1 |
| grade B | train | 19 | +1.268 ± 0.762 | 3.15 | 42% | 3.1 |
| grade B | validation | 7 | -1.014 ± 0.002 | 0.00 | 0% | 7.1 |
| grade B | test | 14 | +0.657 ± 0.693 | 2.00 | 36% | 2.1 |
| grade B | all | 40 | +0.655 ± 0.448 | 1.95 | 32% | 9.1 |
| grade C | train | 4 | -0.421 ± 0.610 | 0.46 | 25% | 3.1 |
| grade C | validation | 1 | +0.016 ± – | – | 100% | 0.0 |
| grade C | test | 7 | +1.022 ± 1.800 | 2.39 | 29% | 3.6 |
| grade C | all | 12 | +0.457 ± 1.052 | 1.67 | 33% | 3.6 |
| checklist 5/5 | train | 10 | +0.571 ± 1.107 | 1.69 | 20% | 7.3 |
| checklist 5/5 | validation | 9 | -1.014 ± 0.002 | 0.00 | 0% | 9.1 |
| checklist 5/5 | test | 15 | -0.175 ± 0.851 | 0.82 | 7% | 8.2 |
| checklist 5/5 | all | 34 | -0.177 ± 0.494 | 0.81 | 9% | 18.3 |
| A1 (A + 5/5) | train | 3 | -1.057 ± 0.023 | 0.00 | 0% | 3.2 |
| A1 (A + 5/5) | validation | 7 | -1.014 ± 0.002 | 0.00 | 0% | 7.1 |
| A1 (A + 5/5) | test | 10 | -1.024 ± 0.005 | 0.00 | 0% | 10.2 |
| A1 (A + 5/5) | all | 20 | -1.025 ± 0.005 | 0.00 | 0% | 20.5 |

### 2H → 5m

| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |
|---|---|---|---|---|---|---|
| all setups | train | 112 | -0.428 ± 0.152 | 0.52 | 14% | 50.9 |
| all setups | validation | 75 | -0.086 ± 0.331 | 0.90 | 13% | 29.9 |
| all setups | test | 112 | +0.319 ± 0.307 | 1.40 | 22% | 21.8 |
| all setups | all | 299 | -0.062 ± 0.154 | 0.93 | 17% | 80.8 |
| grade A | train | 71 | -0.291 ± 0.214 | 0.66 | 17% | 24.6 |
| grade A | validation | 54 | -0.024 ± 0.408 | 0.97 | 15% | 25.4 |
| grade A | test | 73 | -0.139 ± 0.285 | 0.83 | 18% | 28.4 |
| grade A | all | 198 | -0.162 ± 0.170 | 0.81 | 17% | 50.0 |
| grade B | train | 32 | -0.723 ± 0.174 | 0.23 | 9% | 23.1 |
| grade B | validation | 14 | -0.543 ± 0.510 | 0.44 | 7% | 12.6 |
| grade B | test | 32 | +1.224 ± 0.741 | 2.80 | 34% | 5.2 |
| grade B | all | 78 | +0.108 ± 0.339 | 1.13 | 19% | 35.7 |
| grade C | train | 9 | -0.461 ± 0.599 | 0.51 | 11% | 4.3 |
| grade C | validation | 7 | +0.350 ± 1.399 | 1.39 | 14% | 6.3 |
| grade C | test | 7 | +0.960 ± 1.934 | 2.15 | 14% | 4.1 |
| grade C | all | 23 | +0.218 ± 0.735 | 1.24 | 13% | 10.4 |
| checklist 5/5 | train | 26 | -0.898 ± 0.152 | 0.11 | 4% | 23.4 |
| checklist 5/5 | validation | 16 | -0.403 ± 0.538 | 0.56 | 12% | 8.5 |
| checklist 5/5 | test | 30 | +0.283 ± 0.618 | 1.33 | 17% | 13.6 |
| checklist 5/5 | all | 72 | -0.296 ± 0.292 | 0.68 | 11% | 33.9 |
| A1 (A + 5/5) | train | 16 | -0.796 ± 0.247 | 0.19 | 6% | 12.7 |
| A1 (A + 5/5) | validation | 9 | +0.124 ± 0.941 | 1.15 | 22% | 4.2 |
| A1 (A + 5/5) | test | 20 | -0.608 ± 0.306 | 0.35 | 10% | 14.6 |
| A1 (A + 5/5) | all | 45 | -0.528 ± 0.245 | 0.43 | 11% | 23.8 |

## All 7 majors + gold, pooled

### 1D → 1H

| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |
|---|---|---|---|---|---|---|
| all setups | train | 86 | -0.116 ± 0.291 | 0.87 | 13% | 24.2 |
| all setups | validation | 65 | -0.371 ± 0.288 | 0.58 | 11% | 28.3 |
| all setups | test | 60 | -0.052 ± 0.359 | 0.94 | 15% | 24.3 |
| all setups | all | 211 | -0.176 ± 0.179 | 0.80 | 13% | 37.2 |
| grade A | train | 49 | +0.225 ± 0.445 | 1.27 | 18% | 13.6 |
| grade A | validation | 47 | -0.583 ± 0.184 | 0.35 | 11% | 29.4 |
| grade A | test | 38 | -0.018 ± 0.462 | 0.98 | 16% | 16.5 |
| grade A | all | 134 | -0.127 ± 0.219 | 0.85 | 15% | 30.6 |
| grade B | train | 32 | -0.498 ± 0.372 | 0.48 | 6% | 19.9 |
| grade B | validation | 14 | -0.644 ± 0.333 | 0.29 | 7% | 9.0 |
| grade B | test | 16 | +0.229 ± 0.792 | 1.28 | 19% | 5.1 |
| grade B | all | 62 | -0.343 ± 0.289 | 0.62 | 10% | 32.0 |
| grade C | train | 5 | -1.016 ± 0.002 | 0.00 | 0% | 5.1 |
| grade C | validation | 4 | +3.078 ± 4.088 | 5.06 | 25% | 3.0 |
| grade C | test | 6 | -1.018 ± 0.009 | 0.00 | 0% | 6.1 |
| grade C | all | 15 | +0.075 ± 1.091 | 1.08 | 7% | 9.1 |
| checklist 5/5 | train | 30 | -0.116 ± 0.550 | 0.87 | 10% | 14.3 |
| checklist 5/5 | validation | 16 | +0.044 ± 1.021 | 1.05 | 6% | 7.5 |
| checklist 5/5 | test | 20 | -0.372 ± 0.651 | 0.62 | 5% | 12.3 |
| checklist 5/5 | all | 66 | -0.155 ± 0.397 | 0.83 | 8% | 14.6 |
| A1 (A + 5/5) | train | 12 | +0.694 ± 1.256 | 1.81 | 17% | 5.2 |
| A1 (A + 5/5) | validation | 6 | -1.007 ± 0.002 | 0.00 | 0% | 6.0 |
| A1 (A + 5/5) | test | 13 | -0.017 ± 1.002 | 0.98 | 8% | 8.1 |
| A1 (A + 5/5) | all | 31 | +0.067 ± 0.636 | 1.07 | 10% | 10.1 |

### 4H → 15m

| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |
|---|---|---|---|---|---|---|
| all setups | train | 437 | +0.124 ± 0.133 | 1.15 | 20% | 55.1 |
| all setups | validation | 294 | +0.337 ± 0.245 | 1.42 | 21% | 61.8 |
| all setups | test | 382 | -0.045 ± 0.122 | 0.94 | 20% | 59.7 |
| all setups | all | 1113 | +0.122 ± 0.093 | 1.15 | 20% | 62.8 |
| grade A | train | 260 | +0.225 ± 0.171 | 1.29 | 22% | 28.4 |
| grade A | validation | 204 | +0.234 ± 0.207 | 1.30 | 24% | 58.6 |
| grade A | test | 246 | -0.100 ± 0.129 | 0.88 | 21% | 55.2 |
| grade A | all | 710 | +0.115 ± 0.097 | 1.15 | 22% | 58.6 |
| grade B | train | 144 | +0.174 ± 0.256 | 1.21 | 20% | 41.6 |
| grade B | validation | 77 | +0.302 ± 0.593 | 1.33 | 10% | 16.2 |
| grade B | test | 104 | -0.064 ± 0.237 | 0.92 | 20% | 24.5 |
| grade B | all | 325 | +0.128 ± 0.195 | 1.15 | 18% | 41.6 |
| grade C | train | 33 | -0.900 ± 0.103 | 0.09 | 6% | 29.7 |
| grade C | validation | 13 | +2.168 ± 2.868 | 3.92 | 31% | 5.1 |
| grade C | test | 32 | +0.441 ± 0.745 | 1.53 | 19% | 14.0 |
| grade C | all | 78 | +0.161 ± 0.568 | 1.18 | 15% | 34.8 |
| checklist 5/5 | train | 111 | -0.106 ± 0.278 | 0.89 | 11% | 27.2 |
| checklist 5/5 | validation | 78 | +0.759 ± 0.752 | 1.82 | 10% | 24.9 |
| checklist 5/5 | test | 88 | -0.324 ± 0.263 | 0.66 | 9% | 38.3 |
| checklist 5/5 | all | 277 | +0.068 ± 0.254 | 1.07 | 10% | 48.8 |
| A1 (A + 5/5) | train | 49 | +0.231 ± 0.460 | 1.26 | 14% | 14.6 |
| A1 (A + 5/5) | validation | 44 | +0.040 ± 0.484 | 1.04 | 11% | 14.3 |
| A1 (A + 5/5) | test | 50 | -0.174 ± 0.361 | 0.81 | 12% | 29.8 |
| A1 (A + 5/5) | all | 143 | +0.031 ± 0.250 | 1.03 | 13% | 29.8 |

### 2H → 5m

| Setups | Period | Trades | Expectancy R ± s.e. | Profit factor | Win rate | Max drawdown R |
|---|---|---|---|---|---|---|
| all setups | train | 916 | +0.192 ± 0.122 | 1.23 | 19% | 66.4 |
| all setups | validation | 630 | +0.052 ± 0.130 | 1.06 | 17% | 63.7 |
| all setups | test | 844 | +0.139 ± 0.116 | 1.17 | 19% | 71.3 |
| all setups | all | 2390 | +0.137 ± 0.071 | 1.16 | 18% | 92.5 |
| grade A | train | 562 | +0.260 ± 0.158 | 1.31 | 19% | 44.6 |
| grade A | validation | 404 | +0.189 ± 0.155 | 1.23 | 21% | 35.8 |
| grade A | test | 527 | +0.127 ± 0.129 | 1.16 | 21% | 71.9 |
| grade A | all | 1493 | +0.194 ± 0.086 | 1.24 | 20% | 71.9 |
| grade B | train | 292 | +0.034 ± 0.192 | 1.04 | 18% | 34.8 |
| grade B | validation | 178 | -0.179 ± 0.281 | 0.81 | 11% | 42.6 |
| grade B | test | 259 | +0.198 ± 0.253 | 1.23 | 17% | 56.3 |
| grade B | all | 729 | +0.041 ± 0.137 | 1.05 | 16% | 108.4 |
| grade C | train | 62 | +0.321 ± 0.638 | 1.35 | 16% | 26.6 |
| grade C | validation | 48 | -0.246 ± 0.379 | 0.73 | 15% | 25.0 |
| grade C | test | 58 | -0.015 ± 0.475 | 0.98 | 10% | 24.4 |
| grade C | all | 168 | +0.043 ± 0.306 | 1.05 | 14% | 51.4 |
| checklist 5/5 | train | 199 | +0.335 ± 0.351 | 1.36 | 13% | 34.9 |
| checklist 5/5 | validation | 120 | -0.129 ± 0.305 | 0.87 | 10% | 34.3 |
| checklist 5/5 | test | 202 | +0.319 ± 0.338 | 1.34 | 12% | 45.4 |
| checklist 5/5 | all | 521 | +0.222 ± 0.200 | 1.23 | 12% | 51.5 |
| A1 (A + 5/5) | train | 94 | +1.238 ± 0.670 | 2.45 | 19% | 13.6 |
| A1 (A + 5/5) | validation | 61 | +0.328 ± 0.487 | 1.37 | 15% | 15.9 |
| A1 (A + 5/5) | test | 110 | +0.095 ± 0.358 | 1.10 | 13% | 32.7 |
| A1 (A + 5/5) | all | 265 | +0.554 ± 0.303 | 1.62 | 15% | 32.7 |

## Execution-delay sensitivity (all setups, pooled, train / validation / test)

Measured with `ICT_DELAY_BARS=n python scripts/sweep_backtest.py ...` (order placed n lower-timeframe candles later):

| Delay | 2H → 5m | 4H → 15m |
|---|---|---|
| 0 (zone known) | +0.192 / +0.052 / +0.139 | +0.124 / +0.337 / −0.045 |
| 1 candle | +0.113 / +0.041 / +0.094 | +0.139 / +0.283 / −0.086 |
| 2 candles | +0.086 / +0.012 / +0.070 | +0.087 / +0.227 / −0.106 |
| 4 candles | +0.034 / −0.046 / +0.025 | +0.143 / +0.224 / −0.079 |

The 2H result shrinks steadily when the order goes in later (5-minute candles: 5-20 minutes), so it depends on near-instant execution; the 4H test period is negative at every delay.

A1 and the TTrades 5/5 checklist are labels for the setup's shape, not evidence of an edge: compare their rows across the three periods and with the standard errors.
