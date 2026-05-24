import { NextRequest, NextResponse } from 'next/server';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

type FsValue =
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FsValue> } };

function toInt(n: number): FsValue { return { integerValue: String(Math.round(n)) }; }
function toDouble(n: number): FsValue { return { doubleValue: n }; }
function toStr(s: string): FsValue { return { stringValue: s }; }

function fromFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('integerValue' in v) obj[k] = Number(v.integerValue);
    else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
    else if ('stringValue' in v) obj[k] = v.stringValue;
    else if ('booleanValue' in v) obj[k] = v.booleanValue;
    else if ('mapValue' in v) obj[k] = fromFields((v as { mapValue: { fields: Record<string, FsValue> } }).mapValue.fields ?? {});
    else obj[k] = null;
  }
  return obj;
}

async function fsGet(path: string, auth: string) {
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: auth } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET failed: ${res.status}`);
  const data = await res.json();
  return fromFields(data.fields ?? {});
}

async function fsPatch(path: string, fields: Record<string, FsValue>, auth: string) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH failed: ${res.status}`);
  return res.json();
}

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    if (symbol.toUpperCase().endsWith('.KS')) {
      // 한국 주식: Yahoo Finance REST API 직접 호출
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    } else {
      // 미국 주식: Finnhub 직접 호출
      const apiKey = process.env.FINNHUB_API_KEY;
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol.toUpperCase()}&token=${apiKey}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.c || null;
    }
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const body = await req.json();
  const { uid, action, symbol, name, market, quantity } = body;
  let price: number = body.price;

  const isMarketOrder = body.isMarketOrder === true;
  if (!uid || !action || !symbol || (!isMarketOrder && !price) || !quantity) {
    return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 });
  }

  // 시장가 주문: 현재가 조회 후 그 가격으로 체결
  // 지정가 주문: 현재가 검증 후 지정가로 체결
  const currentPrice = await fetchCurrentPrice(symbol);

  if (currentPrice === null) {
    return NextResponse.json({ error: '현재가를 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
  }

  // 시장가 주문이면 현재가로 덮어씀
  if (isMarketOrder) {
    price = currentPrice;
  } else {
    // 지정가 검증
    if (action === 'buy' && price < currentPrice) {
      return NextResponse.json({
        error: `현재가 ${market === 'KR' ? '₩' : '$'}${Math.round(currentPrice).toLocaleString()}에 아직 도달하지 않았습니다. 지정가를 현재가 이상으로 입력하거나 예약 주문을 이용해 주세요.`,
      }, { status: 400 });
    }
    if (action === 'sell' && price > currentPrice) {
      return NextResponse.json({
        error: `현재가 ${market === 'KR' ? '₩' : '$'}${Math.round(currentPrice).toLocaleString()}에 아직 도달하지 않았습니다. 지정가를 현재가 이하로 입력하거나 예약 주문을 이용해 주세요.`,
      }, { status: 400 });
    }
  }

  // 프로필 + 보유 주식 조회
  const [profileData, holdingsData] = await Promise.all([
    fsGet(`users/${uid}/data/profile`, auth),
    fsGet(`users/${uid}/data/holdings`, auth),
  ]);

  if (!profileData) return NextResponse.json({ error: '프로필 없음' }, { status: 404 });

  const profile = profileData as { cashKRW: number; cashUSD: number; seedMoneyKRW: number; seedMoneyUSD: number };
  const holdings = (holdingsData ?? {}) as Record<string, { avgPrice: number; quantity: number; name: string; market: string }>;
  const isKRW = market === 'KR';
  const total = price * quantity;

  if (action === 'buy') {
    const cash = isKRW ? profile.cashKRW : profile.cashUSD;
    if (total > cash) return NextResponse.json({ error: '잔액이 부족합니다.' }, { status: 400 });

    const newCash = cash - total;
    const cashField = isKRW ? 'cashKRW' : 'cashUSD';

    // 평균 단가 계산
    const existing = holdings[symbol];
    let newAvg = price;
    let newQty = quantity;
    if (existing) {
      newQty = existing.quantity + quantity;
      newAvg = (existing.avgPrice * existing.quantity + price * quantity) / newQty;
    }

    // 프로필 업데이트
    await fsPatch(`users/${uid}/data/profile`, {
      ...Object.fromEntries(
        Object.entries({ cashKRW: toInt(profile.cashKRW), cashUSD: toDouble(profile.cashUSD), seedMoneyKRW: toInt(profile.seedMoneyKRW), seedMoneyUSD: toDouble(profile.seedMoneyUSD) })
      ),
      [cashField]: isKRW ? toInt(newCash) : toDouble(newCash),
    } as Record<string, FsValue>, auth);

    // 보유 주식 업데이트
    const newHoldingsFields: Record<string, FsValue> = {};
    for (const [sym, h] of Object.entries(holdings)) {
      newHoldingsFields[sym] = {
        mapValue: {
          fields: {
            avgPrice: toDouble(h.avgPrice),
            quantity: toInt(h.quantity),
            name: toStr(h.name),
            market: toStr(h.market),
          },
        },
      };
    }
    newHoldingsFields[symbol] = {
      mapValue: {
        fields: {
          avgPrice: toDouble(newAvg),
          quantity: toInt(newQty),
          name: toStr(name || symbol),
          market: toStr(market),
        },
      },
    };
    await fsPatch(`users/${uid}/data/holdings`, newHoldingsFields, auth);

    return NextResponse.json({ ok: true, newCash: newCash });
  }

  if (action === 'sell') {
    const holding = holdings[symbol];
    if (!holding) return NextResponse.json({ error: '보유 종목이 없습니다.' }, { status: 400 });
    if (quantity > holding.quantity) return NextResponse.json({ error: '보유 수량이 부족합니다.' }, { status: 400 });

    const cash = isKRW ? profile.cashKRW : profile.cashUSD;
    const newCash = cash + total;
    const newQty = holding.quantity - quantity;
    const cashField = isKRW ? 'cashKRW' : 'cashUSD';

    await fsPatch(`users/${uid}/data/profile`, {
      ...Object.fromEntries(
        Object.entries({ cashKRW: toInt(profile.cashKRW), cashUSD: toDouble(profile.cashUSD), seedMoneyKRW: toInt(profile.seedMoneyKRW), seedMoneyUSD: toDouble(profile.seedMoneyUSD) })
      ),
      [cashField]: isKRW ? toInt(newCash) : toDouble(newCash),
    } as Record<string, FsValue>, auth);

    // 보유 주식 업데이트 (0이면 삭제)
    const newHoldingsFields: Record<string, FsValue> = {};
    for (const [sym, h] of Object.entries(holdings)) {
      if (sym === symbol && newQty === 0) continue;
      newHoldingsFields[sym] = {
        mapValue: {
          fields: {
            avgPrice: toDouble(sym === symbol ? h.avgPrice : h.avgPrice),
            quantity: toInt(sym === symbol ? newQty : h.quantity),
            name: toStr(h.name),
            market: toStr(h.market),
          },
        },
      };
    }
    await fsPatch(`users/${uid}/data/holdings`, newHoldingsFields, auth);

    return NextResponse.json({ ok: true, newCash });
  }

  return NextResponse.json({ error: '알 수 없는 action' }, { status: 400 });
}
