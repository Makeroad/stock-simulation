'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { getAuthInstance } from '@/lib/firebase';

interface QuoteResult { symbol: string; name: string; price: number; currency: string; }
interface SearchResult { symbol: string; name: string; }
interface Holding { avgPrice: number; quantity: number; name: string; market: 'US' | 'KR'; }
interface UserProfile { cashKRW: number; cashUSD: number; seedMoneyKRW: number; seedMoneyUSD: number; }
interface HoldingWithPrice extends Holding { symbol: string; currentPrice: number | null; pnlPct: number | null; }

function fmtKRW(n: number) { return '₩' + Math.round(n).toLocaleString('ko-KR'); }
function fmtUSD(n: number) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt(n: number, isKRW: boolean) { return isKRW ? fmtKRW(n) : fmtUSD(n); }

async function getToken(): Promise<string> {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const token = await user.getIdToken();
  return `Bearer ${token}`;
}

async function apiGet(url: string) {
  const auth = await getToken();
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`API 오류 ${res.status}`);
  return res.json();
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [holdingsWithPrice, setHoldingsWithPrice] = useState<HoldingWithPrice[]>([]);
  const [market, setMarket] = useState<'US' | 'KR'>('US');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedStock, setSelectedStock] = useState<QuoteResult | null>(null);
  const [buyQty, setBuyQty] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [tradeMsg, setTradeMsg] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [tradeLoading, setTradeLoading] = useState(false);

  const loadUserData = useCallback(async (uid: string) => {
    const [p, h] = await Promise.all([
      apiGet(`/api/user/profile?uid=${uid}`),
      apiGet(`/api/user/holdings?uid=${uid}`),
    ]);
    // 프로필 없으면 초기화
    if (!p) {
      const auth = await getToken();
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      const newP = await res.json();
      setProfile(newP);
      setHoldings({});
      return { p: newP, h: {} as Record<string, Holding> };
    }
    setProfile(p);
    setHoldings(h ?? {});
    return { p, h: h ?? {} };
  }, []);

  const fetchHoldingPrices = useCallback(async (h: Record<string, Holding>) => {
    const symbols = Object.keys(h);
    if (symbols.length === 0) { setHoldingsWithPrice([]); return; }
    const results = await Promise.all(symbols.map(async (sym) => {
      try {
        const res = await fetch(`/api/quote/${encodeURIComponent(sym)}`);
        const data = await res.json();
        const currentPrice: number | null = data.price ?? null;
        const pnlPct = currentPrice !== null ? ((currentPrice - h[sym].avgPrice) / h[sym].avgPrice) * 100 : null;
        return { symbol: sym, ...h[sym], currentPrice, pnlPct };
      } catch {
        return { symbol: sym, ...h[sym], currentPrice: null, pnlPct: null };
      }
    }));
    setHoldingsWithPrice(results);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(getAuthInstance(), async (u) => {
      if (!u) { router.push('/login'); return; }
      setUser(u);
      try {
        const { h } = await loadUserData(u.uid);
        await fetchHoldingPrices(h);
      } catch (err: unknown) {
        setLoadError('데이터를 불러오지 못했습니다: ' + (err instanceof Error ? err.message : ''));
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [router, loadUserData, fetchHoldingPrices]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setQuoteLoading(true); setSelectedStock(null); setTradeMsg(''); setTradeError('');
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&market=${market}`);
      setSearchResults(await res.json());
    } catch { setTradeError('검색 실패'); }
    finally { setQuoteLoading(false); }
  }

  async function handleSelectStock(sym: string) {
    setQuoteLoading(true); setSearchResults([]); setSearchQuery(sym);
    setBuyQty(''); setBuyPrice(''); setSellQty(''); setSellPrice('');
    setTradeMsg(''); setTradeError('');
    try {
      const data = await fetch(`/api/quote/${encodeURIComponent(sym)}`).then(r => r.json());
      if (data.error) { setTradeError('시세 조회 실패: ' + data.error); return; }
      setSelectedStock(data);
      setBuyPrice(String(data.price));
      setSellPrice(String(data.price));
    } catch { setTradeError('시세 조회 실패'); }
    finally { setQuoteLoading(false); }
  }

  async function handleTrade(action: 'buy' | 'sell') {
    if (!user || !selectedStock) return;
    const qty = parseInt(action === 'buy' ? buyQty : sellQty);
    const price = parseFloat(action === 'buy' ? buyPrice : sellPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      setTradeError('수량 또는 가격을 올바르게 입력해 주세요.'); return;
    }
    setTradeLoading(true); setTradeMsg(''); setTradeError('');
    try {
      const auth = await getToken();
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid, action,
          symbol: selectedStock.symbol,
          name: selectedStock.name,
          market, price, quantity: qty,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setTradeError(data.error ?? '거래 실패'); return; }
      const { h } = await loadUserData(user.uid);
      await fetchHoldingPrices(h);
      setTradeMsg(`${selectedStock.symbol} ${qty.toLocaleString()}주 ${action === 'buy' ? '매수' : '매도'} 완료`);
      if (action === 'buy') setBuyQty(''); else setSellQty('');
    } catch (err: unknown) {
      setTradeError(err instanceof Error ? err.message : '거래 실패');
    } finally { setTradeLoading(false); }
  }

  const isKRWstock = selectedStock?.currency === 'KRW';
  const currentHolding = selectedStock ? holdings[selectedStock.symbol] : null;
  const displayId = user?.email?.replace('@stockapp.local', '') ?? '';
  const krwHoldingValue = holdingsWithPrice.filter(h => h.market === 'KR').reduce((s, h) => s + (h.currentPrice ?? h.avgPrice) * h.quantity, 0);
  const usdHoldingValue = holdingsWithPrice.filter(h => h.market === 'US').reduce((s, h) => s + (h.currentPrice ?? h.avgPrice) * h.quantity, 0);

  if (loading) return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
      <div className="text-green-400 text-sm tracking-widest animate-pulse">불러오는 중...</div>
    </div>
  );

  if (loadError) return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-red-400 text-sm mb-4">{loadError}</div>
        <button onClick={() => window.location.reload()} className="text-xs text-gray-400 border border-[#2a2a2a] px-4 py-2 rounded hover:border-gray-500">새로고침</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-3 md:p-6">
      <div className="max-w-6xl mx-auto">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6 border-b border-[#1f1f1f] pb-4">
          <div>
            <div className="text-green-400 text-lg font-bold tracking-widest">▶ 주식 터미널</div>
            <div className="text-gray-600 text-xs">{displayId}</div>
          </div>
          <button onClick={() => signOut(getAuthInstance()).then(() => router.push('/login'))}
            className="text-xs text-gray-500 hover:text-red-400 border border-[#2a2a2a] hover:border-red-900 px-3 py-1.5 rounded transition-colors">
            로그아웃
          </button>
        </div>

        {/* 자산 요약 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: '🇰🇷 보유 현금', value: fmtKRW(profile?.cashKRW ?? 0) },
            { label: '🇺🇸 보유 현금', value: fmtUSD(profile?.cashUSD ?? 0) },
            { label: 'KR 평가금액', value: fmtKRW(krwHoldingValue) },
            { label: 'US 평가금액', value: fmtUSD(usdHoldingValue) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#141414] border border-[#1f1f1f] rounded p-3">
              <div className="text-gray-500 text-xs mb-1">{label}</div>
              <div className="text-white text-sm font-bold">{value}</div>
            </div>
          ))}
        </div>

        {/* 시장 선택 + 검색 */}
        <div className="bg-[#141414] border border-[#1f1f1f] rounded p-4 mb-4">
          <div className="flex gap-2 mb-4">
            {(['US', 'KR'] as const).map(m => (
              <button key={m} onClick={() => { setMarket(m); setSelectedStock(null); setSearchResults([]); setSearchQuery(''); }}
                className={`px-4 py-1.5 rounded text-xs border transition-colors ${market === m ? 'bg-blue-600 border-blue-600 text-white' : 'border-[#2a2a2a] text-gray-500 hover:text-gray-300'}`}>
                {m === 'US' ? '🇺🇸 미국' : '🇰🇷 한국'}
              </button>
            ))}
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder={market === 'US' ? '티커 또는 회사명 (AAPL, Tesla...)' : '종목명 또는 코드 (삼성전자, 005930...)'}
              className="flex-1 bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500 placeholder-gray-700" />
            <button type="submit" disabled={quoteLoading}
              className="bg-green-600 hover:bg-green-500 disabled:bg-green-900 text-black font-bold px-4 py-2 rounded text-xs transition-colors">
              {quoteLoading ? '...' : '검색'}
            </button>
          </form>
          {searchResults.length > 0 && (
            <div className="mt-2 border border-[#2a2a2a] rounded overflow-hidden">
              {searchResults.map(r => (
                <button key={r.symbol} onClick={() => handleSelectStock(r.symbol)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1a1a1a] border-b border-[#1a1a1a] last:border-0 transition-colors">
                  <span className="text-green-400 font-mono mr-2">{r.symbol}</span>
                  <span className="text-gray-400">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 시세 + 매매 */}
        {selectedStock && (
          <div className="bg-[#141414] border border-[#1f1f1f] rounded p-4 mb-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-green-400 font-bold text-lg font-mono">{selectedStock.symbol}</div>
                <div className="text-gray-400 text-sm">{selectedStock.name}</div>
              </div>
              <div className="text-right">
                <div className="text-white text-xl font-bold">{fmt(selectedStock.price, isKRWstock)}</div>
                <div className="text-gray-500 text-xs">{selectedStock.currency}</div>
              </div>
            </div>
            <div className="text-gray-600 text-xs mb-4">
              사용 가능: {isKRWstock ? fmtKRW(profile?.cashKRW ?? 0) : fmtUSD(profile?.cashUSD ?? 0)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 매수 */}
              <div className="border border-[#2a2a2a] rounded p-3">
                <div className="text-green-400 text-xs mb-3 font-bold">▲ 매수</div>
                <div className="space-y-2">
                  <div>
                    <label className="text-gray-600 text-xs block mb-1">수량</label>
                    <input type="number" min="1" value={buyQty} onChange={e => setBuyQty(e.target.value)}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500" placeholder="0" />
                  </div>
                  <div>
                    <label className="text-gray-600 text-xs block mb-1">지정가</label>
                    <input type="number" min="0" step="any" value={buyPrice} onChange={e => setBuyPrice(e.target.value)}
                      className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500" />
                  </div>
                  {buyQty && buyPrice && <div className="text-gray-500 text-xs">합계: {fmt(parseFloat(buyPrice) * parseInt(buyQty), isKRWstock)}</div>}
                  <button onClick={() => handleTrade('buy')} disabled={tradeLoading}
                    className="w-full bg-green-600 hover:bg-green-500 disabled:bg-green-900 disabled:text-green-800 text-black font-bold py-2 rounded text-xs transition-colors">
                    {tradeLoading ? '처리 중...' : '매수'}
                  </button>
                </div>
              </div>

              {/* 매도 */}
              {currentHolding ? (
                <div className="border border-[#2a2a2a] rounded p-3">
                  <div className="text-red-400 text-xs mb-3 font-bold">▼ 매도</div>
                  <div className="text-gray-500 text-xs mb-2">보유: {currentHolding.quantity.toLocaleString()}주 · 평균 {fmt(currentHolding.avgPrice, isKRWstock)}</div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-gray-600 text-xs block mb-1">수량</label>
                      <input type="number" min="1" max={currentHolding.quantity} value={sellQty} onChange={e => setSellQty(e.target.value)}
                        className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-500" placeholder="0" />
                    </div>
                    <div>
                      <label className="text-gray-600 text-xs block mb-1">지정가</label>
                      <input type="number" min="0" step="any" value={sellPrice} onChange={e => setSellPrice(e.target.value)}
                        className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-red-500" />
                    </div>
                    {sellQty && sellPrice && <div className="text-gray-500 text-xs">합계: {fmt(parseFloat(sellPrice) * parseInt(sellQty), isKRWstock)}</div>}
                    <button onClick={() => handleTrade('sell')} disabled={tradeLoading}
                      className="w-full bg-red-700 hover:bg-red-600 disabled:bg-red-950 disabled:text-red-900 text-white font-bold py-2 rounded text-xs transition-colors">
                      {tradeLoading ? '처리 중...' : '매도'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border border-[#1f1f1f] rounded p-3 flex items-center justify-center text-gray-700 text-xs">보유 종목 없음</div>
              )}
            </div>

            {tradeMsg && <div className="mt-3 text-green-400 text-xs border border-green-900 bg-green-950/30 rounded px-3 py-2">✓ {tradeMsg}</div>}
            {tradeError && <div className="mt-3 text-red-400 text-xs border border-red-900 bg-red-950/30 rounded px-3 py-2">✗ {tradeError}</div>}
          </div>
        )}

        {/* 포트폴리오 */}
        <div className="bg-[#141414] border border-[#1f1f1f] rounded">
          <div className="px-4 py-3 border-b border-[#1f1f1f]">
            <span className="text-gray-400 text-xs">포트폴리오</span>
            {holdingsWithPrice.length > 0 && <span className="text-gray-600 text-xs ml-2">({holdingsWithPrice.length}개 종목)</span>}
          </div>
          {holdingsWithPrice.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-700 text-sm">보유 종목 없음</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#1a1a1a]">
                    {['종목', '종목명', '평균단가', '수량', '현재가', '수익률'].map((h, i) => (
                      <th key={h} className={`px-4 py-2 text-gray-600 font-normal ${i === 0 ? 'text-left' : i === 1 ? 'text-left hidden md:table-cell' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdingsWithPrice.map(h => (
                    <tr key={h.symbol} onClick={() => { setMarket(h.market); handleSelectStock(h.symbol); }}
                      className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] cursor-pointer transition-colors">
                      <td className="px-4 py-3 text-green-400 font-mono font-bold">{h.symbol}</td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{h.name}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{fmt(h.avgPrice, h.market === 'KR')}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{h.quantity.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{h.currentPrice !== null ? fmt(h.currentPrice, h.market === 'KR') : '—'}</td>
                      <td className={`px-4 py-3 text-right font-bold ${h.pnlPct === null ? 'text-gray-600' : h.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {h.pnlPct === null ? '—' : `${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
