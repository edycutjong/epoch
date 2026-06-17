import { NextResponse } from 'next/server';
import { readDb, writeDb } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const target = await request.json();
    if (!target || !target.id) {
      return NextResponse.json({ error: 'Missing legacy target details' }, { status: 400 });
    }

    const db = readDb();
    // Prevent duplicate entries
    db.legacyTargets = db.legacyTargets.filter((t: any) => t.id !== target.id);
    db.legacyTargets.push(target);
    writeDb(db);

    return NextResponse.json({ success: true, message: `Legacy target seeded: ${target.id}` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
