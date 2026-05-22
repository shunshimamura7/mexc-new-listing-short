import Link from 'next/link'
import { loadAllListings, storageStats } from '@/lib/storage'

export default async function HomePage() {
  const [stats, listings] = await Promise.all([storageStats(), loadAllListings()])
  const recentListings = listings
    .sort((a, b) => b.listingTime - a.listingTime)
    .slice(0, 5)

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink mb-1">ダッシュボード</h1>
          <p className="text-ink-dim text-sm">新規上場銘柄のショートトレード戦略をデータドリブンで検証・最適化</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-panel rounded-xl p-5 border border-rim">
            <div className="text-3xl font-bold text-blue-400 font-mono">{stats.count}</div>
            <div className="text-sm text-ink-dim mt-1">収集済み銘柄数</div>
          </div>
          <div className="bg-panel rounded-xl p-5 border border-rim">
            <div className="text-3xl font-bold text-ink-dim font-mono">
              {stats.bytes > 0 ? `${(stats.bytes / 1024).toFixed(1)} KB` : '—'}
            </div>
            <div className="text-sm text-ink-dim mt-1">ストレージ使用量</div>
          </div>
        </div>

        {/* Nav cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Link
            href="/score"
            className="group bg-panel border border-rim rounded-xl p-6 hover:border-red-500/40 hover:bg-panel-raised transition-all block"
          >
            <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/>
                <polyline points="16 17 22 17 22 11"/>
              </svg>
            </div>
            <div className="font-semibold text-ink mb-1 group-hover:text-red-400 transition-colors">スコアリング</div>
            <div className="text-ink-faint text-sm leading-relaxed">新規上場銘柄のショート機会を5点満点で自動評価</div>
          </Link>

          <Link
            href="/collect"
            className="group bg-panel border border-rim rounded-xl p-6 hover:border-blue-500/40 hover:bg-panel-raised transition-all block"
          >
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
            <div className="font-semibold text-ink mb-1 group-hover:text-blue-400 transition-colors">データ収集</div>
            <div className="text-ink-faint text-sm leading-relaxed">MEXC APIから新規上場銘柄のKlineデータを取得・保存</div>
          </Link>

          <Link
            href="/backtest"
            className="group bg-panel border border-rim rounded-xl p-6 hover:border-purple-500/40 hover:bg-panel-raised transition-all block"
          >
            <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center mb-4">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                <polyline points="16 7 22 7 22 13"/>
              </svg>
            </div>
            <div className="font-semibold text-ink mb-1 group-hover:text-purple-400 transition-colors">バックテスト</div>
            <div className="text-ink-faint text-sm leading-relaxed">SL/TP・エントリータイミングを最適化</div>
          </Link>
        </div>

        {/* Recent listings */}
        {recentListings.length > 0 && (
          <div className="bg-panel rounded-xl p-6 border border-rim">
            <h2 className="text-base font-semibold text-ink mb-4">直近の収集銘柄</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-faint text-left border-b border-rim">
                  <th className="pb-2 pr-6 font-medium">銘柄</th>
                  <th className="pb-2 pr-6 font-medium">上場日時</th>
                  <th className="pb-2 text-right font-medium">初動ポンプ率</th>
                </tr>
              </thead>
              <tbody>
                {recentListings.map((l) => (
                  <tr key={l.symbol} className="border-b border-rim hover:bg-panel-raised transition-colors">
                    <td className="py-2.5 pr-6 font-mono text-ink">{l.symbol}</td>
                    <td className="py-2.5 pr-6 text-ink-dim">
                      {new Date(l.listingTime).toLocaleString('ja-JP', {
                        month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 text-right">
                      <span className={l.initialPumpPct >= 30 ? 'text-green-400 font-medium' : 'text-ink-dim'}>
                        +{l.initialPumpPct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  )
}
