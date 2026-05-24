'use client';

import { getDbInstance } from './firebase';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

export interface Holding {
  avgPrice: number;
  quantity: number;
  name: string;
  market: 'US' | 'KR';
}

export interface Transaction {
  symbol: string;
  type: 'buy' | 'sell';
  price: number;
  quantity: number;
  total: number;
  date: string;
}

export interface UserProfile {
  seedMoneyKRW: number;
  seedMoneyUSD: number;
  cashKRW: number;
  cashUSD: number;
  createdAt: unknown;
}

export async function initUserProfile(uid: string) {
  const db = getDbInstance();
  const profileRef = doc(db, 'users', uid, 'data', 'profile');
  const snap = await getDoc(profileRef);
  if (!snap.exists()) {
    await setDoc(profileRef, {
      seedMoneyKRW: 10000000,
      seedMoneyUSD: 10000,
      cashKRW: 10000000,
      cashUSD: 10000,
      createdAt: serverTimestamp(),
    });
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getDbInstance();
  const snap = await getDoc(doc(db, 'users', uid, 'data', 'profile'));
  if (!snap.exists()) return null;
  const data = snap.data();
  // 구버전 단일 cash 필드 호환
  if (data.cashKRW === undefined) {
    const migrated: UserProfile = {
      seedMoneyKRW: 10000000,
      seedMoneyUSD: 10000,
      cashKRW: 10000000,
      cashUSD: 10000,
      createdAt: data.createdAt,
    };
    await setDoc(doc(db, 'users', uid, 'data', 'profile'), migrated);
    return migrated;
  }
  return data as UserProfile;
}

export async function getHoldings(uid: string): Promise<Record<string, Holding>> {
  const db = getDbInstance();
  const snap = await getDoc(doc(db, 'users', uid, 'data', 'holdings'));
  return snap.exists() ? (snap.data() as Record<string, Holding>) : {};
}

export async function buyStock(
  uid: string,
  symbol: string,
  name: string,
  market: 'US' | 'KR',
  price: number,
  quantity: number,
  profile: UserProfile,
  currentHoldings: Record<string, Holding>
) {
  const db = getDbInstance();
  const total = price * quantity;
  const isKRW = market === 'KR';

  const availableCash = isKRW ? profile.cashKRW : profile.cashUSD;
  if (total > availableCash) throw new Error('Insufficient cash');

  const newCash = availableCash - total;
  const cashField = isKRW ? 'cashKRW' : 'cashUSD';

  const existing = currentHoldings[symbol];
  let newHolding: Holding;
  if (existing) {
    const newQty = existing.quantity + quantity;
    const newAvg = (existing.avgPrice * existing.quantity + price * quantity) / newQty;
    newHolding = { avgPrice: newAvg, quantity: newQty, name, market };
  } else {
    newHolding = { avgPrice: price, quantity, name, market };
  }

  const tx: Transaction = {
    symbol, type: 'buy', price, quantity, total,
    date: new Date().toISOString(),
  };

  await updateDoc(doc(db, 'users', uid, 'data', 'profile'), { [cashField]: newCash });
  await setDoc(doc(db, 'users', uid, 'data', 'holdings'), { [symbol]: newHolding }, { merge: true });

  const txRef = doc(db, 'users', uid, 'data', 'transactions');
  const txSnap = await getDoc(txRef);
  const txs = txSnap.exists() ? (txSnap.data().list ?? []) : [];
  await setDoc(txRef, { list: [tx, ...txs] });
}

export async function sellStock(
  uid: string,
  symbol: string,
  market: 'US' | 'KR',
  price: number,
  quantity: number,
  profile: UserProfile,
  currentHoldings: Record<string, Holding>
) {
  const db = getDbInstance();
  const holding = currentHoldings[symbol];
  if (!holding) throw new Error('No holding found');
  if (quantity > holding.quantity) throw new Error('Insufficient holdings');

  const total = price * quantity;
  const isKRW = market === 'KR';
  const cashField = isKRW ? 'cashKRW' : 'cashUSD';
  const currentCash = isKRW ? profile.cashKRW : profile.cashUSD;
  const newCash = currentCash + total;
  const newQty = holding.quantity - quantity;

  const tx: Transaction = {
    symbol, type: 'sell', price, quantity, total,
    date: new Date().toISOString(),
  };

  await updateDoc(doc(db, 'users', uid, 'data', 'profile'), { [cashField]: newCash });

  if (newQty === 0) {
    const holdingsRef = doc(db, 'users', uid, 'data', 'holdings');
    const snap = await getDoc(holdingsRef);
    const data = snap.exists() ? snap.data() : {};
    delete data[symbol];
    await setDoc(holdingsRef, data);
  } else {
    await setDoc(
      doc(db, 'users', uid, 'data', 'holdings'),
      { [symbol]: { ...holding, quantity: newQty } },
      { merge: true }
    );
  }

  const txRef = doc(db, 'users', uid, 'data', 'transactions');
  const txSnap = await getDoc(txRef);
  const txs = txSnap.exists() ? (txSnap.data().list ?? []) : [];
  await setDoc(txRef, { list: [tx, ...txs] });
}
