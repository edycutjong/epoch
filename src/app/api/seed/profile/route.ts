import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { did, profile } = await request.json();
    if (!did || !profile) {
      return NextResponse.json({ error: 'Missing did or profile' }, { status: 400 });
    }

    const db = readDb();
    db.profiles[did] = profile;
    writeDb(db);

    return NextResponse.json({ success: true, message: `Profile seeded for ${did}` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
