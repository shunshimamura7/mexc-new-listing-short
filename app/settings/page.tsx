'use client'

import { useEffect, useState } from 'react'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import type { AppSettings } from '@/lib/settings'
import type { PaperSettings } from '@/types'

function SettingRow({ label, desc, value, min, max, step, unit, onChange }: {
  label: string
  desc?: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="py-4 border-b border-rim last:border-0">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-ink">{label}</div>
          {desc && <div className="text-xs text-ink-faint mt-0.5">{desc}</div>}
        </div>
        <span className="font-mono font-bold text-ink text-base ml-4 flex-shrink-0">
          {unit.startsWith('$') ? `${unit}${value.toLocaleString()}` : `${value}${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-500"
      />
      <div className="flex justify-between text-xs text-ink-faint mt-1">
        <span>{unit.startsWith('$') ? `${unit}${min.toLocaleString()}` : `${min}${unit}`}</span>
        <span>{unit.startsWith('$') ? `${unit}${max.toLocaleString()}` : `${max}${unit}`}</span>
      </div>
    </div>
  )
}

const DEFAULT_PAPER: PaperSettings = {
  autoEntry: true, capitalUsdt: 1000, leverage: 10, slippage: 0.20,
}

export default function SettingsPage() {
  const [settings, setSettings]       = useState<AppSettings>(DEFAULT_SETTINGS)
  const [paper, setPaper]             = useState<PaperSettings>(DEFAULT_PAPER)
  const [toast, setToast]             = useState<string | null>(null)
  const [loaded, setLoaded]           = useState(false)
  const [paperSaving, setPaperSaving] = useState(false)

  useEffect(() => {
    setSettings(loadSettings())
    fetch('/api/paper-settings')
      .then((r) => r.json())
      .then((j) => { if (j.success) setPaper(j.settings) })
      .catch(() => {})
    setLoaded(true)
  }, [])

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setToast(null)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function handleSave() {
    saveSettings(settings)
    showToast('設定を保存しました')
  }

  function handleReset() {
    setSettings(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
    showToast('デフォルト値にリセットしました')
  }

  async function handlePaperSave() {
    setPaperSaving(true)
    try {
      await fetch('/api/paper-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paper),
      })
      showToast('ペーパートレード設定を保存しました')
    } catch {
      showToast('保存に失敗しました')
    } finally {
      setPaperSaving(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-ink">設定</h1>
          <p className="text-ink-dim text-sm mt-1">スコアリング・バックテスト・エントリー判断に使うデフォルトパラメータ</p>
        </div>

        {/* エントリー条件 */}
        <div className="bg-panel rounded-xl border border-rim p-5 mb-4">
          <h2 className="font-semibold text-ink mb-1">エントリー条件</h2>
          <p className="text-xs text-ink-faint mb-2">バックテストの最適化ベースライン</p>
          <SettingRow
            label="ポンプ幅閾値"
            desc="初動ポンプがこの値以上の銘柄のみ対象"
            value={settings.minPumpPct}
            min={10} max={200} step={10} unit="%"
            onChange={(v) => update('minPumpPct', v)}
          />
          <SettingRow
            label="エントリータイミング"
            desc="上場後N時間後にショートエントリー"
            value={settings.entryHours}
            min={1} max={60} step={1} unit="h後"
            onChange={(v) => update('entryHours', v)}
          />
          <SettingRow
            label="SL（損切りライン）"
            desc="エントリー価格からN%上昇で損切り"
            value={settings.slPct}
            min={5} max={50} step={5} unit="%"
            onChange={(v) => update('slPct', v)}
          />
          <SettingRow
            label="TP（利確ライン）"
            desc="エントリー価格からN%下落で利確"
            value={settings.tpPct}
            min={5} max={70} step={5} unit="%"
            onChange={(v) => update('tpPct', v)}
          />
        </div>

        {/* リスク管理 */}
        <div className="bg-panel rounded-xl border border-rim p-5 mb-6">
          <h2 className="font-semibold text-ink mb-1">リスク管理</h2>
          <p className="text-xs text-ink-faint mb-2">ポジションサイジング基準</p>
          <SettingRow
            label="ポジションサイズ"
            desc="1トレードで使う資金の割合"
            value={settings.positionSizePct}
            min={1} max={20} step={1} unit="%"
            onChange={(v) => update('positionSizePct', v)}
          />
          <SettingRow
            label="出来高最低ライン"
            desc="この値未満の銘柄は対象外"
            value={settings.minVolUsdPerH}
            min={10000} max={500000} step={10000} unit="$/h"
            onChange={(v) => update('minVolUsdPerH', v)}
          />
        </div>

        {/* 現在の設定サマリー */}
        <div className="bg-panel-raised rounded-xl border border-rim p-4 mb-6">
          <h3 className="text-xs text-ink-faint uppercase tracking-wide mb-3">設定サマリー</h3>
          <div className="grid grid-cols-3 gap-2 text-sm">
            {[
              { label: 'ポンプ閾値', value: `≥${settings.minPumpPct}%` },
              { label: 'エントリー', value: `${settings.entryHours}h後` },
              { label: 'SL', value: `${settings.slPct}%` },
              { label: 'TP', value: `${settings.tpPct}%` },
              { label: 'サイズ', value: `資金の${settings.positionSizePct}%` },
              { label: '出来高', value: `≥$${(settings.minVolUsdPerH / 1000).toFixed(0)}K/h` },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col">
                <span className="text-ink-faint text-xs">{label}</span>
                <span className="text-ink font-mono font-medium">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* バックテスト設定ボタン */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 rounded-lg font-medium text-white transition-colors"
          >
            保存
          </button>
          <button
            onClick={handleReset}
            className="px-5 py-2.5 bg-panel-raised hover:bg-panel border border-rim rounded-lg text-sm text-ink-dim hover:text-ink transition-colors"
          >
            デフォルトに戻す
          </button>
        </div>

        {/* ペーパートレード設定 */}
        <div className="bg-panel rounded-xl border border-rim p-5 mt-4">
          <h2 className="font-semibold text-ink mb-1">ペーパートレード</h2>
          <p className="text-xs text-ink-faint mb-4">スコアリングAPI検出時の自動エントリー設定（サーバー保存）</p>

          {/* 自動エントリー ON/OFF */}
          <div className="flex items-center justify-between py-3 border-b border-rim">
            <div>
              <div className="text-sm font-medium text-ink">自動エントリー</div>
              <div className="text-xs text-ink-faint mt-0.5">推奨対象検出時に8パターンを自動記録</div>
            </div>
            <button
              onClick={() => setPaper((p) => ({ ...p, autoEntry: !p.autoEntry }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${paper.autoEntry ? 'bg-amber-500' : 'bg-panel-raised border border-rim'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${paper.autoEntry ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <SettingRow label="仮想資金" desc="1パターンあたりの仮想証拠金"
            value={paper.capitalUsdt} min={100} max={10000} step={100} unit=" USDT"
            onChange={(v) => setPaper((p) => ({ ...p, capitalUsdt: v }))} />
          <SettingRow label="レバレッジ" desc="デフォルトレバレッジ倍率"
            value={paper.leverage} min={1} max={50} step={1} unit="x"
            onChange={(v) => setPaper((p) => ({ ...p, leverage: v }))} />
          <SettingRow label="想定スリッページ" desc="往復合計のスリッページ（%）"
            value={paper.slippage * 100} min={0} max={1} step={0.05} unit="%"
            onChange={(v) => setPaper((p) => ({ ...p, slippage: v / 100 }))} />

          <div className="mt-4 bg-panel-raised rounded-lg border border-rim p-3 text-xs text-ink-faint space-y-1">
            <div>コスト: テイカー {0.02}% × 2 + スリッページ {(paper.slippage * 100).toFixed(2)}% = <span className="text-ink">{(0.04 + paper.slippage * 100).toFixed(2)}%</span> (対想定元本)</div>
            <div>証拠金比ラウンドトリップコスト: <span className="text-amber-400">{((0.04 + paper.slippage * 100) * paper.leverage).toFixed(2)}%</span> (×{paper.leverage}倍)</div>
            <div>清算水準: エントリー価格 × {(1 + 0.9 / paper.leverage * 100).toFixed(1)}%</div>
          </div>

          <div className="mt-4 pt-2 text-xs text-ink-faint">
            <p>📌 cron-job.org 設定（毎時チェック）</p>
            <p className="mt-1 font-mono bg-panel-raised rounded px-2 py-1 text-[11px] break-all">
              URL: https://mexc-new-listing-short.vercel.app/api/paper-trades/check<br />
              Schedule: 0 * * * *<br />
              Header: Authorization: Bearer {'{'}{'{'}CRON_SECRET{'}'}{'}'}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <button
            onClick={handlePaperSave}
            disabled={paperSaving}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-panel-raised disabled:text-ink-faint disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors"
          >
            {paperSaving ? '保存中...' : 'ペーパートレード設定を保存'}
          </button>
        </div>

      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-900/80 border border-green-700 text-green-300 text-sm font-medium px-4 py-3 rounded-xl shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
