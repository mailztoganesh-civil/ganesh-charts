# CRT backtest – summary

Pairs: EURUSD, GBPUSD, AUDUSD, NZDUSD, USDCAD, USDCHF, USDJPY, XAUUSD. 5-minute data from the forex-data repository, 2023-01-01 onward; costs per pair in each pair's report. Made by `python scripts/crt_backtest.py <forex-data> EURUSD GBPUSD AUDUSD NZDUSD USDCAD USDCHF USDJPY XAUUSD`. Rules, costs, fills and the same-bar rule are in that script's header. Average R per trade, all pairs pooled; trades in brackets.

No thresholds were tuned: every filter uses the app's existing default. Train and validation are where a refinement would have to show an edge first; the test period is the final check.

## 1H

| Variant | Train | Validation | Test |
|---|---|---|---|
| original rules (two-sided outer-third counts) | -0.289 (19594) | -0.272 (15470) | -0.281 (19530) |
| current strict rules (baseline) | -0.294 (18851) | -0.277 (14868) | -0.287 (18784) |
| current strict rules (baseline) - target 50% of C1 | -0.328 (13728) | -0.299 (11006) | -0.320 (13726) |
| current strict rules (baseline) - WITHOUT costs (reference only) | +0.007 (18975) | -0.001 (14961) | +0.008 (18975) |
| + C1 size and not inside bar | -0.273 (14348) | -0.265 (11650) | -0.277 (15006) |
| + key level | -0.263 (4730) | -0.230 (3528) | -0.242 (4881) |
| + HTF bias agrees | -0.309 (7162) | -0.306 (5544) | -0.298 (7106) |
| + clean sweep depth | -0.225 (10318) | -0.210 (8536) | -0.187 (9893) |
| + rejection close | -0.221 (12730) | -0.199 (10100) | -0.212 (12843) |
| + kill zone (1H/4H only) | -0.230 (4865) | -0.208 (3858) | -0.258 (4897) |
| + planned R:R >= 2 | -0.436 (5436) | -0.425 (4267) | -0.424 (5231) |
| app default filters (size, key, sweep, rejection) | -0.173 (1847) | -0.136 (1421) | -0.196 (1856) |

## 4H

| Variant | Train | Validation | Test |
|---|---|---|---|
| original rules (two-sided outer-third counts) | -0.169 (5017) | -0.123 (3714) | -0.167 (4899) |
| current strict rules (baseline) | -0.177 (4712) | -0.126 (3496) | -0.173 (4647) |
| current strict rules (baseline) - target 50% of C1 | -0.212 (3712) | -0.114 (2751) | -0.180 (3621) |
| current strict rules (baseline) - WITHOUT costs (reference only) | -0.006 (4715) | +0.032 (3498) | -0.037 (4657) |
| + C1 size and not inside bar | -0.173 (3954) | -0.109 (2986) | -0.169 (3970) |
| + key level | -0.205 (2353) | -0.091 (1673) | -0.159 (2296) |
| + HTF bias agrees | -0.143 (1733) | -0.121 (1224) | -0.183 (1669) |
| + clean sweep depth | -0.126 (3327) | -0.100 (2562) | -0.145 (3275) |
| + rejection close | -0.094 (3145) | -0.091 (2335) | -0.132 (3080) |
| + kill zone (1H/4H only) | -0.139 (1553) | -0.107 (1043) | -0.177 (1394) |
| + planned R:R >= 2 | -0.298 (1820) | -0.142 (1336) | -0.260 (1646) |
| app default filters (size, key, sweep, rejection) | -0.061 (1057) | -0.014 (774) | -0.098 (1011) |

## D

| Variant | Train | Validation | Test |
|---|---|---|---|
| original rules (two-sided outer-third counts) | -0.004 (1003) | -0.050 (706) | -0.059 (895) |
| current strict rules (baseline) | -0.005 (931) | -0.049 (657) | -0.064 (840) |
| current strict rules (baseline) - target 50% of C1 | -0.031 (727) | -0.086 (497) | -0.070 (678) |
| current strict rules (baseline) - WITHOUT costs (reference only) | +0.061 (932) | +0.005 (656) | +0.011 (839) |
| + C1 size and not inside bar | +0.011 (856) | -0.042 (598) | -0.074 (769) |
| + key level | -0.071 (443) | -0.135 (334) | +0.043 (403) |
| + HTF bias agrees | +0.089 (351) | +0.170 (254) | -0.131 (351) |
| + clean sweep depth | +0.017 (780) | -0.043 (529) | -0.111 (671) |
| + rejection close | +0.035 (640) | -0.138 (450) | -0.133 (533) |
| + kill zone (1H/4H only) | – | – | – |
| + planned R:R >= 2 | +0.006 (324) | +0.028 (231) | -0.001 (342) |
| app default filters (size, key, sweep, rejection) | +0.003 (248) | -0.172 (167) | -0.045 (214) |

## Limits of this test

- Quotes: forex-data 5-minute bars come from HistData (bid side); they are treated as mid prices with half the spread added on each side, which is an approximation of real bid/ask fills.
- Entry is at the open of the candle after C2 (the CRT signal itself). Model-1 entries on the lower timeframe are not part of this test.
- Overlapping trades are all counted at 1R; no position limit, no news filter, no swap/rollover cost.
- 2023-01 to 2026-10 only (the 5-minute history available); about 3.8 years per pair.
