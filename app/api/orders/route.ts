import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

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

async function getOrderList(uid: string, auth: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${BASE}/users/${uid}/data/pendingOrders`, { headers: { Authorization: auth } });
  if (res.status === 404) return [];
  if (!res.ok) return [];
  const data = await res.json();
  const arr = data.fields?.list as FsValue | undefined;
  if (!arr || !('arrayValue' in arr)) return [];
  return (arr.arrayValue.values ?? []).map(v => fromFsValue(v)) as Record<string, unknown>[];
}

async function saveOrderList(uid: string, auth: string, list: Record<string, unknown>[]) {
  const fields: Record<string, FsValue> = {
    list: { arrayValue: { values: list.map(o => orderToFsMap(o)) } },
  };
  await fetch(`${BASE}/users/${uid}/data/pendingOrders`, {
    method: 'PATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

// GET: 예약 주문 목록
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });
  const auth = req.headers.get('authorization') ?? '';
  const list = await getOrderList(uid, auth);
  const now = new Date().toISOString();
  return NextResponse.json(list.filter(o => (o.expiresAt as string) > now));
}

// POST: 예약 주문 생성
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const body = await req.json();
  const { uid, symbol, name, market, type, limitPrice, quantity, expiry } = body;

  const now = new Date();
  let expiresAt: Date;
  if (expiry === 'today') {
    expiresAt = new Date(now);
    expiresAt.setHours(23, 59, 59, 999);
  } else if (expiry === '1week') {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  const order = {
    id: randomUUID(),
    symbol, name, market, type, limitPrice, quantity,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  };

  const list = await getOrderList(uid, auth);
  list.push(order);
  await saveOrderList(uid, auth, list);
  return NextResponse.json({ ok: true, order });
}

// DELETE: 예약 주문 취소
export async function DELETE(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const { uid, orderId } = await req.json();
  const list = await getOrderList(uid, auth);
  await saveOrderList(uid, auth, list.filter(o => o.id !== orderId));
  return NextResponse.json({ ok: true });
}
