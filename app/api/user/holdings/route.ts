import { NextRequest, NextResponse } from 'next/server';

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fromMapFields(fields: Record<string, Record<string, unknown>>) {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('integerValue' in v) obj[k] = Number(v.integerValue);
    else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
    else if ('stringValue' in v) obj[k] = v.stringValue;
    else if ('booleanValue' in v) obj[k] = v.booleanValue;
    else if ('mapValue' in v) {
      const mv = v.mapValue as { fields?: Record<string, Record<string, unknown>> };
      obj[k] = mv.fields ? fromMapFields(mv.fields) : {};
    } else obj[k] = null;
  }
  return obj;
}

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('uid');
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 });

  const res = await fetch(`${BASE}/users/${uid}/data/holdings`, {
    headers: { Authorization: req.headers.get('authorization') ?? '' },
  });

  if (res.status === 404) return NextResponse.json({});
  if (!res.ok) return NextResponse.json({ error: 'fetch failed' }, { status: res.status });

  const data = await res.json();
  return NextResponse.json(fromMapFields(data.fields ?? {}));
}
