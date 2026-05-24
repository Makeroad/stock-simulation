import { NextRequest, NextResponse } from 'next/server';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

type FsValue =
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields: Record<string, FsValue> } };

function toInt(n: number): FsValue { return { integerValue: String(Math.round(n)) }; }
function toDouble(n: number): FsValue { return { doubleValue: n }; }
function toStr(s: string): FsValue { return { stringValue: s }; }

function fromFsValue(v: FsValue): unknown {
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFsValue);
  if ('mapValue' in v) {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) obj[k] = fromFsValue(val);
    return obj;
  }
  return null;
}

function orderToFsMap(o: Record<string, unknown>): FsValue {
  return {
    mapValue: {
      fields: {
        id: toStr(o.id as string),
        symbol: toStr(o.symbol as string),
        name: toStr(o.name as string),
        market: toStr(o.market as string),
        type: toStr(o.type as string),
        limitPrice: toDouble(o.limitPrice as number),
        quantity: toInt(o.quantity as number),
        expiresAt: toStr(o.expiresAt as string),
        createdAt: toStr(o.createdAt as string),
      },
    },
  };
}

async function fsGet(path: string, auth: string) {
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: auth } });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = await res.json();
  const fields = data.fields ?? {};
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromFsValue(v as FsValue);
  return obj;
}

async function fsPatch(path: string, fields: Record<string, FsValue>, auth: string) {
  await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function fetchPrice(symbol: string): Promise<number | null> {
  try {
    if (symbol.toUpperCase().endsWith('.KS')) {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (!res.ok) return null;
      const d = await res.json();
      return d?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    } else {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol.toUpperCase()}&token=${process.env.FINNHUB_API_KEY}`
      );
      if (!res.ok) return null;
      const d = await res.json();
      return d.c || null;
    }
  } catch { return null; }
}

// POST /api/orders/process?uid=xxx
// 대시보드 로드 시 호출 — 만료되지 않은 예약 주문 중 체결 가능한 것 처리
export async function POST(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });
  const auth = req.headers.get('authorization') ?? '';

  // 예약 주문 목록 조회
  const ordersDoc = await fetch(`${BASE}/users/${uid}/data/pendingOrders`, { headers: { Authorization: auth } });
  if (!ordersDoc.ok) return NextResponse.json({ filled: [] });

  const ordersData = await ordersDoc.json();
  const arr = ordersData.fields?.list as FsValue | undefined;
  if (!arr || !('arrayValue' in arr)) return NextResponse.json({ filled: [] });

  const allOrders = ((arr.arrayValue.values ?? []).map(v => fromFsValue(v))) as Record<string, unknown>[];
  const now = new Date().toISOString();

  // 만료 안된 것만
  const active = allOrders.filter(o => (o.expiresAt as string) > now);
  const expired = allOrders.filter(o => (o.expiresAt as string) <= now);

  if (active.length === 0) {
    // 만료 정리만
    if (expired.length > 0) {
      await fsPatch(`users/${uid}/data/pendingOrders`, {
        list: { arrayValue: { values: [] } },
      }, auth);
    }
    return NextResponse.json({ filled: [], expired: expired.length });
  }

  // 프로필 + 보유 주식 조회
  const [profileData, holdingsData] = await Promise.all([
    fsGet(`users/${uid}/data/profile`, auth),
    fsGet(`users/${uid}/data/holdings`, auth),
  ]);
  if (!profileData) return NextResponse.json({ filled: [] });

  let profile = profileData as { cashKRW: number; cashUSD: number; seedMoneyKRW: number; seedMoneyUSD: number };
  const holdings = (holdingsData ?? {}) as Record<string, { avgPrice: number; quantity: number; name: string; market: string }>;

  const filled: string[] = [];
  const remaining: Record<string, unknown>[] = [];

  // 심볼별 현재가 캐시 (중복 API 호출 방지)
  const priceCache: Record<string, number | null> = {};

  for (const order of active) {
    const { id, symbol, type, limitPrice, quantity, market, name } = order as {
      id: string; symbol: string; type: 'buy' | 'sell';
      limitPrice: number; quantity: number; market: 'US' | 'KR'; name: string;
    };

    if (!(symbol in priceCache)) {
      priceCache[symbol] = await fetchPrice(symbol);
    }
    const currentPrice = priceCache[symbol];
    if (currentPrice === null) { remaining.push(order); continue; }

    const isKRW = market === 'KR';
    const shouldFill =
      (type === 'buy' && currentPrice <= limitPrice) ||
      (type === 'sell' && currentPrice >= limitPrice);

    if (!shouldFill) { remaining.push(order); continue; }

    // 체결 처리
    if (type === 'buy') {
      const total = limitPrice * quantity;
      const cash = isKRW ? profile.cashKRW : profile.cashUSD;
      if (total > cash) { remaining.push(order); continue; } // 잔액 부족 → 유지

      const newCash = cash - total;
      const cashField = isKRW ? 'cashKRW' : 'cashUSD';
      profile = { ...profile, [cashField]: newCash };

      const existing = holdings[symbol];
      if (existing) {
        const newQty = existing.quantity + quantity;
        holdings[symbol] = { ...existing, quantity: newQty, avgPrice: (existing.avgPrice * existing.quantity + limitPrice * quantity) / newQty };
      } else {
        holdings[symbol] = { avgPrice: limitPrice, quantity, name, market };
      }
    } else {
      const holding = holdings[symbol];
      if (!holding || holding.quantity < quantity) { remaining.push(order); continue; }

      const total = limitPrice * quantity;
      const isKRW2 = holding.market === 'KR';
      const cashField = isKRW2 ? 'cashKRW' : 'cashUSD';
      const cash = isKRW2 ? profile.cashKRW : profile.cashUSD;
      profile = { ...profile, [cashField]: cash + total };

      const newQty = holding.quantity - quantity;
      if (newQty === 0) delete holdings[symbol];
      else holdings[symbol] = { ...holding, quantity: newQty };
    }
    filled.push(id);
  }

  if (filled.length === 0 && expired.length === 0) {
    return NextResponse.json({ filled: [] });
  }

  // Firestore 업데이트
  const profileFields: Record<string, FsValue> = {
    cashKRW: toInt(profile.cashKRW),
    cashUSD: toDouble(profile.cashUSD),
    seedMoneyKRW: toInt(profile.seedMoneyKRW),
    seedMoneyUSD: toDouble(profile.seedMoneyUSD),
  };
  const holdingsFields: Record<string, FsValue> = {};
  for (const [sym, h] of Object.entries(holdings)) {
    holdingsFields[sym] = { mapValue: { fields: {
      avgPrice: toDouble(h.avgPrice), quantity: toInt(h.quantity),
      name: toStr(h.name), market: toStr(h.market),
    }}};
  }

  await Promise.all([
    fsPatch(`users/${uid}/data/profile`, profileFields, auth),
    fsPatch(`users/${uid}/data/holdings`, holdingsFields, auth),
    fsPatch(`users/${uid}/data/pendingOrders`, {
      list: { arrayValue: { values: remaining.map(o => orderToFsMap(o)) } },
    }, auth),
  ]);

  return NextResponse.json({ filled, expired: expired.length });
}
