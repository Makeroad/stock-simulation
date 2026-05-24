import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol.toUpperCase();

  try {
    if (symbol.endsWith('.KS')) {
      // Korean stock via yahoo-finance2
      const yahooFinance = (await import('yahoo-finance2')).default;
      const quote = await yahooFinance.quote(symbol) as Record<string, unknown>;
      return NextResponse.json({
        symbol,
        name: (quote.longName as string) || (quote.shortName as string) || symbol,
        price: (quote.regularMarketPrice as number) ?? 0,
        currency: 'KRW',
      });
    } else {
      // US stock via Finnhub
      const apiKey = process.env.FINNHUB_API_KEY;
      const [quoteRes, profileRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${apiKey}`),
      ]);
      const quoteData = await quoteRes.json();
      const profileData = await profileRes.json();

      if (!quoteData.c || quoteData.c === 0) {
        return NextResponse.json({ error: 'Symbol not found' }, { status: 404 });
      }

      return NextResponse.json({
        symbol,
        name: profileData.name || symbol,
        price: quoteData.c,
        currency: 'USD',
      });
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 });
  }
}
