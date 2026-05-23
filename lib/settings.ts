export type AppSettings = {
  minPumpPct: number        // 初動ポンプ幅閾値 (%)
  entryHours: number        // エントリータイミング (上場後N時間後)
  slPct: number             // SL (%)
  tpPct: number             // TP (%)
  positionSizePct: number   // ポジションサイズ (資金の%)
  minVolUsdPerH: number     // 出来高最低ライン ($/h)
}

export const DEFAULT_SETTINGS: AppSettings = {
  minPumpPct:      50,
  entryHours:      24,
  slPct:           30,
  tpPct:           20,
  positionSizePct: 3,
  minVolUsdPerH:   50000,
}

const STORAGE_KEY = 'mexc-short-settings'

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
