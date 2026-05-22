import Link from 'next/link'
import { loadAllListings, storageStats } from '@/lib/storage'

export default async function HomePage() {
  const [stats, listings] = await Promise.all([storageStats(), loadAllListings()])

  const recentListings = listings
    .sort((a, b) => b.listingTime - a.listingTime)
    .slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2 text-white">MEXC New Listing Short</h1>
        <p className="text-gray-500 mb-8 text-sm">新規上場銘柄のショートトレード戦略をデータドリブンで検証・最適化</p>

        {/* ステータスカード */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
            <div className="text-3xl font-bold text-blue-400">{stats.count}</div>
            <div className="text-sm text-gray-500 mt-1">収集済み銘柄数</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
            <div className="text-3xl font-bold text-gray-400">
              {stats.bytes > 0 ? `${(stats.bytes / 1024).toFixed(1)} KB` : '—'}
            </div>
            <div className="text-sm text-gray-500 mt-1">ストレージ使用量</div>
          </div>
        </div>

        {/* ナビゲーション */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Link
            href="/score"
            className="bg-red-700 hover:bg-red-600 rounded-xl p-6 transition-colors block"
          >
            <div className="text-lg font-semibold mb-1">スコアリング</div>
            <div className="text-red-200 text-sm">新規上場銘柄のショート機会を5点満点で自動評価</div>
          </Link>
          <Link
            href="/collect"
            className="bg-blue-600 hover:bg-blue-500 rounded-xl p-6 transition-colors block"
          >
            <div className="text-lg font-semibold mb-1">データ収集</div>
            <div className="text-blue-200 text-sm">MEXC APIから新規上場銘柄のKlineデータを取得・保存</div>
          </Link>
          <Link
            href="/backtest"
            className="bg-purple-700 hover:bg-purple-600 rounded-xl p-6 transition-colors block"
          >
            <div className="text-lg font-semibold mb-1">バックテスト</div>
            <div className="text-purple-200 text-sm">SL/TP・エントリータイミングを最適化</div>
          </Link>
        </div>

        {/* 直近の銘柄 */}
        {recentListings.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">直近の収集銘柄</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  <th className="pb-2 pr-6">銘柄</th>
                  <th className="pb-2 pr-6">上場日時</th>
                  <th className="pb-2 text-right">初動ポンプ率</th>
                </tr>
              </thead>
              <tbody>
                {recentListings.map((l) => (
                  <tr key={l.symbol} className="border-b border-gray-800/50">
                    <td className="py-2 pr-6 font-mono text-gray-200">{l.symbol}</td>
                    <td className="py-2 pr-6 text-gray-400">
                      {new Date(l.listingTime).toLocaleString('ja-JP', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 text-right">
                      <span className={l.initialPumpPct >= 30 ? 'text-green-400 font-medium' : 'text-gray-400'}>
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
