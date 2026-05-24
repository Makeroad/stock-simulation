import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();

  try {
    if (symbol.endsWith('.KS')) {
      // 한국 주식: Yahoo Finance REST API 직접 호출
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        next: { revalidate: 60 },
      });

      if (!res.ok) {
        return NextResponse.json({ error: '시세 조회 실패' }, { status: 502 });
      }

      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) {
        return NextResponse.json({ error: '종목을 찾을 수 없습니다' }, { status: 404 });
      }

      return NextResponse.json({
        symbol,
        name: meta.longName || meta.shortName || symbol,
        price: meta.regularMarketPrice ?? meta.previousClose ?? 0,
        currency: 'KRW',
      });
    } else {
      // 미국 주식: Finnhub API
      const apiKey = process.env.FINNHUB_API_KEY;
      const [quoteRes, profileRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`),
      ]);
      const quoteData = await quoteRes.json();
      const profileData = await profileRes.json();

      if (!quoteData.c || quoteData.c === 0) {
        return NextResponse.json({ error: '종목을 찾을 수 없습니다' }, { status: 404 });
      }

      return NextResponse.json({
        symbol,
        name: profileData.name || symbol,
        price: quoteData.c,
        currency: 'USD',
      });
    }
  } catch (err) {
    console.error('Quote error:', err);
    return NextResponse.json({ error: '시세 조회 중 오류가 발생했습니다' }, { status: 500 });
  }
}
