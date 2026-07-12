# Claude Code 指示書：Binance 新規上場ショートのベースライン検証

作成: 2026-07-12（続き）/ 依頼者: しゅん

---

## 0. 背景と目的

同じディレクトリ `C:\Users\admin\Projects\mexc-new-listing-short\research\` で、
今日の午前に **MEXC 新規上場ショート** を全検証した結果、期待値ゼロだった。
その結果は `research/out/REPORT.md` に保存済み。

しゅんの本当の目的は「新規上場ショート」に固執することではなく、
**「レバ1で気長にショートして勝てる型」を探す**こと。

MEXCで無理でも、**Binance は新規上場審査が厳しい＝銘柄の質が違う可能性**がある。
これを実測で確認する。

---

## 1. 前提（絶対に読め）

### 今日の午前の検証で確定した、絶対に守るべきこと

1. **アンカーは `createTime` ではなく「初ローソク t0」を使う**
   - MEXCでは13.8%が createTime と実際の取引開始が1日以上ズレていた（最悪312日）
   - Binanceでも同じ罠がある可能性がある。必ず初ローソクを t0 とする
   - createTime との差分（diffDays）を記録して集計する

2. **未来行（time > now）を必ず切る**
   - 直近上場銘柄で未来時刻のダミー行が返る API 仕様がある

3. **フィルターは一切かけない**
   - state / isNew / 銘柄カテゴリ で絞らない
   - 名前で株式・コモディティを除外するのは後の集計時のみ（取得は全件）

4. **同一足で SL と TP の両方に触れたら SL 優先（悲観的）**

5. **全結果に n / SD / SE / t値 を併記**

6. **「最良セル拾い」ではなく「プラスのセル割合」で判定**
   - 単発の勝率85%は信じない
   - パラメータを振ってプラスが安定するかが本物のエッジ指標

7. **サバイバーシップバイアスを明記**
   - Binance の delist 済み銘柄は API に残らない可能性が高い
   - 生存者だけを見ている＝実際より結果が良く出る方向にバイアス

---

## 2. Binance API の実測すべき仕様

これは推測ではなく、**実際に叩いて確認せよ**。

### 想定エンドポイント（要検証）

- `GET https://fapi.binance.com/fapi/v1/exchangeInfo`
  → 全先物銘柄と onboardDate（上場日）

- `GET https://fapi.binance.com/fapi/v1/klines?symbol={s}&interval=1h&startTime={ms}&endTime={ms}`
  → Kline（時刻はミリ秒、上限1500本/リクエスト）

- 認証不要のパブリック API

### 実測すべき項目

1. `exchangeInfo` の1件目のレスポンス構造を確認
2. 上場日らしきフィールドの名前と単位（ms か s か）
3. Kline 1リクエストの実際の上限本数
4. レート制限（過剰リクエストで 429 が返るか）

**推測で先に進むな。実物を見てから設計する。**

---

## 3. 成果物

```
research/
  fetch-binance.mjs         # データ取得（キャッシュ付き）
  backtest-binance.mjs      # 【A】ベースライン
  grid-binance.mjs          # 【E】全グリッド
  strata-binance.mjs        # 層別化（pump/ボラ/カテゴリ）
  cohort-binance.mjs        # コホート分析（半期ごと）
  drawdown-binance.mjs      # 下落プロファイル
  data/
    exchange-info.json      # exchangeInfo の生レスポンス
    kline-binance/{S}.json  # 各銘柄の生Kline（キャッシュ）
  out/
    binance-symbols.csv     # 銘柄マスタ
    binance-grid.csv        # 全グリッド結果
    REPORT-BINANCE.md       # 人間が読む結論
```

---

## 4. Step 1 — Binance API のフィールド構造を確認する

まず最初は「1件だけ見る」。

- exchangeInfo を1回叩き、レスポンスのトップレベルキーと `symbols[0]` を丸ごとダンプ
- 上場日らしきフィールドがどれで、単位が何かを報告
- **ここで一度止まって俺に見せろ**

---

## 5. Step 2 — 銘柄マスタと Kline 取得

Step 1 の結果を踏まえて設計する。

### 銘柄マスタ

- Binance USDT-M 先物の全銘柄（PERPETUAL のみ、DELIVERY除外）
- 上場日（onboardDate）でソート、新しい順
- **フィルターは一切かけない。ステーブル取引ペア（USDC/DAI等）除外もしない**
- **最古の上場日を実測して報告**（MEXCは2020-06まで、Binanceはもっと古い可能性）

### Kline取得

- interval: `1h`
- 各銘柄について「上場時刻 -6h 〜 上場時刻 +30日」を取得
- 1リクエストの本数上限を確認したうえで、必要ならチャンク分割
- レート制限対策：**リクエスト間 250ms sleep、429/5xx は指数バックオフで3回リトライ**
- キャッシュ必須（`data/kline-binance/{SYMBOL}.json` があれば再取得しない）
- 失敗は捨てずに理由付きで `failed-binance.json` に記録
- 進捗ログ10件ごと

### 完了報告

1. 総銘柄数 / 取得成功数 / 失敗数と理由
2. **diffDays**（createTime/onboardDate と初ローソクのズレ）分布。1日以上ズレの件数
3. **actualDays** 分布（30日フルで取れた件数）
4. 最古の上場日、最新の上場日

**ここでまた止まる。**

---

## 6. Step 3 — バックテスト定義

### t0 とラベル付け

- t0 = 初ローソクの時刻
- firstOpen = t0 の open
- pump6 / pump12 / pump24 = (t0からXh以内の max(high) / firstOpen) - 1

### カテゴリ判定（除外はしない、ラベルのみ）

- STOCK: シンボルに STOCK を含む
- ETF_INDEX: SPY/QQQ/TQQQ/SQQQ/SOXL/SOXS/ARKK/NAS100/SPX500/NVDL/TSLL 等
- COMMODITY: XAU/XAG/XPT/XPD/OIL/WTI/BRENT 等
- ESTABLISHED: BTC/ETH/SOL/BNB/XRP/DOGE/ADA 等主要30銘柄
- CRYPTO_NEW: 上記以外

### ショート・シミュレーション

パラメータ: entryH, SL%, TP%, maxHoldDays

1. entry = t0 + entryH の足の open（無ければスキップ、件数記録）
2. 次の足から1本ずつ前進：
   - high >= entry * (1+SL) → 負け（SL）
   - low  <= entry * (1-TP) → 勝ち（TP）
3. **同じ足で両方触れたら SL 優先**（悲観的）。件数を必ずカウント
4. maxHoldDays 経過で未決着 → その時点の close で決済
5. PnL(%) = (entry - exit) / entry * 100 - 0.04（往復手数料）

---

## 7. Step 4 — 出す数字（MEXCと同じ手法を全部そのまま流用）

### 【A】ベースライン

全銘柄・フィルター無し・entryH=24 / SL30 / TP20 / hold=7
- n / 勝率 / 平均PnL / 中央値PnL / 期待値
- 決着内訳（TP勝ち / SL負け / 時間切れの内訳）
- 最大負け / 最大勝ち / 同一足両方触れ件数
- カテゴリ別（ALL / CRYPTO_NEW / STOCK / COMMODITY / ESTABLISHED）にも分解

### 【B】ポンプ幅バケット

`0-5 / 5-10 / 10-20 / 20-30 / 30-50 / 50-100 / 100-200 / 200%+`

各バケット × 勝率 / 期待値 / n / SE / t値

### 【C】カテゴリ除外の効果

- 全銘柄 vs CRYPTO_NEWのみ vs 非STOCKのみ

### 【D】下落プロファイル

- t0+24h からの経過別リターン分布（+1d / +3d / +7d / +14d / +30d）
- 平均 / 中央値 / 「下がった割合」
- MFE（最大下落）と MAE（最大踏み上げ）分布
- 「-20% 到達率」

### 【E】全グリッド

- entryH: 6, 12, 24, 48, 72
- SL: 10, 15, 20, 25, 30, 40, 50
- TP: 3, 5, 8, 10, 15, 20, 30
- maxHold: 3, 7, 14

各セル: n / 勝率 / 平均PnL / TP率 / SL率 / 時間切れ率
出力: `out/binance-grid.csv`

### コンソール出力
- **プラスのセル割合**（★これが本物のエッジ指標）
- t>2 のセル数
- 期待値TOP20（n≥100 のみ）とワースト10

### コホート分析

Binanceが遡れる範囲でコホート分割（例：2020H2 / 2021H1 / ... / 2026H1）

各コホートで：
- n / 勝率 / 平均PnL / t値
- グリッドのプラス割合とセル平均期待値
- STOCK銘柄比率と pump<5% 比率

---

## 8. Step 5 — REPORT-BINANCE.md に必ず書くこと

1. API仕様（フィールド名・遡れる期間・Kline本数上限・レート制限）
2. 母数（総銘柄数・取得成功数・失敗理由内訳・カテゴリ内訳）
3. diffDays 分布（Binance でも createTime バグがあるか）
4. 【A】〜【E】の結果（すべて n 付き）
5. コホート分析結果
6. サバイバーシップバイアスの明記
7. **MEXCとの比較表**（同じ指標を並べて、性質の違いを浮かび上がらせる）
8. 結論を1行で

**推測を書くな。取れなかったデータは「取れなかった」と書け。**

---

## 9. 判断基準（俺がしゅんに提示するときの基準）

- **どのコホートでも期待値ゼロ付近＋グリッドプラス率50%前後** → MEXCと同じ。Binanceでも勝てない。撤退
- **直近コホートで期待値プラス＋t>2＋グリッドプラス率80%超＋n≥100** → 勝ち筋の可能性。追加検証（符号安定性・実装可能性）
- **古いコホートだけプラス、直近はゼロ** → MEXCと同じレジーム変化。撤退
- **中央値プラス・平均マイナス（=踏み上げ問題）** → MEXCと同じ。撤退

---

## 10. 進め方

1. **Step 1（フィールド構造確認）だけ**先にやる → **報告して止まる**
2. OKが出たら Step 2（取得）→ 完了報告 → **また止まる**
3. Step 3・4（バックテスト全部）→ REPORT-BINANCE.md 提出

**一気に最後まで走らせるな。上の3ヶ所で必ず止まって報告すること。**

---

## 11. しゅんとの合意事項

- **実弾投入は禁止**。この検証はデータ収集のみ
- MEXCの `research/` の資産（手法・キャッシュ・スクリプト）は流用してよい
- スクリプトは `-binance` サフィックスで区別する（MEXC版と混ぜない）
- 完了後、git commit まで。push は俺の許可を待つ
