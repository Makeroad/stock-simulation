import { NextRequest, NextResponse } from 'next/server';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function authHeader(req: NextRequest) {
  return req.headers.get('authorization') ?? '';
}

function toValue(v: unknown): Record<string, unknown> {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.round(v)) };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { nullValue: null };
}

function fromFields(fields: Record<string, Record<string, unknown>>) {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('integerValue' in v) obj[k] = Number(v.integerValue);
    else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
    else if ('stringValue' in v) obj[k] = v.stringValue;
    else if ('booleanValue' in v) obj[k] = v.booleanValue;
    else obj[k] = null;
  }
  return obj;
}

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const res = await fetch(`${BASE}/users/${uid}/data/profile`, {
    headers: { Authorization: authHeader(req) },
  });

  if (res.status === 404) return NextResponse.json(null);
  if (!res.ok) return NextResponse.json({ error: 'fetch failed' }, { status: res.status });

  const data = await res.json();
  return NextResponse.json(fromFields(data.fields ?? {}));
}

export async function POST(req: NextRequest) {
  const { uid } = await req.json();
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  // 이미 존재하면 스킵
  const check = await fetch(`${BASE}/users/${uid}/data/profile`, {
    headers: { Authorization: authHeader(req) },
  });
  if (check.ok) {
    const data = await check.json();
    return NextResponse.json(fromFields(data.fields ?? {}));
  }

  const profile = {
    fields: {
      seedMoneyKRW: toValue(10000000),
      seedMoneyUSD: toValue(10000),
      cashKRW: toValue(10000000),
      cashUSD: toValue(10000),
    },
  };

  const res = await fetch(`${BASE}/users/${uid}/data/profile`, {
    method: 'PATCH',
    headers: { Authorization: authHeader(req), 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });

  if (!res.ok) return NextResponse.json({ error: 'init failed' }, { status: res.status });
  return NextResponse.json({ seedMoneyKRW: 10000000, seedMoneyUSD: 10000, cashKRW: 10000000, cashUSD: 10000 });
}
