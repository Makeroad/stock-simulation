import { NextRequest, NextResponse } from 'next/server';

const KR_STOCKS = [
  { symbol: '005930.KS', name: '삼성전자' },
  { symbol: '000660.KS', name: 'SK하이닉스' },
  { symbol: '035420.KS', name: 'NAVER' },
  { symbol: '035720.KS', name: '카카오' },
  { symbol: '373220.KS', name: 'LG에너지솔루션' },
  { symbol: '005380.KS', name: '현대차' },
  { symbol: '000270.KS', name: '기아' },
  { symbol: '005490.KS', name: 'POSCO홀딩스' },
  { symbol: '068270.KS', name: '셀트리온' },
  { symbol: '105560.KS', name: 'KB금융' },
  { symbol: '055550.KS', name: '신한지주' },
  { symbol: '006400.KS', name: '삼성SDI' },
  { symbol: '051910.KS', name: 'LG화학' },
  { symbol: '207940.KS', name: '삼성바이오로직스' },
  { symbol: '352820.KS', name: '하이브' },
  { symbol: '259960.KS', name: '크래프톤' },
  { symbol: '323410.KS', name: '카카오뱅크' },
  { symbol: '034020.KS', name: '두산에너빌리티' },
  { symbol: '015760.KS', name: '한국전력' },
  { symbol: '028260.KS', name: '삼성물산' },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.toLowerCase() ?? '';
  const market = searchParams.get('market') ?? 'US';

  if (market === 'KR') {
    const filtered = KR_STOCKS.filter(
      (s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
    return NextResponse.json(filtered);
  }

  // US: Finnhub symbol search
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${apiKey}`
    );
    const data = await res.json();
    const results = (data.result ?? []).slice(0, 10).map((r: { symbol: string; description: string }) => ({
      symbol: r.symbol,
      name: r.description,
    }));
    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
