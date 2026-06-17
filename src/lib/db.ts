import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'data/db.json');

export interface DbSchema {
  kv: Record<string, string>;
  profiles: Record<string, any>;
  legacyTargets: any[];
  dispatchedNotifications: any[];
}

export function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const activeDid = process.env.DID || 'did:t3n:david123';
    const activeSecret = process.env.T3N_API_KEY || 'DAVID_SECRET_KEY';
    const switchId = activeDid.replace('did:t3n:', '');

    const defaultSwitch = {
      id: switchId,
      gracePeriod: 1209600000, // 14 days
      lastHeartbeat: Date.now(),
      status: 'active',
      beneficiaries: ['{{profile.verified_contacts.email.value}}'],
      otpSecret: activeSecret
    };

    const defaultVault = {
      stashRefs: ['stash-ref-1'],
      encryptedKeys: '0x-ephemeral-ecdh-aes-gcm-key-agreement-vector'
    };

    const initialDb = {
      kv: {
        [`epoch:switch:${switchId}`]: JSON.stringify(defaultSwitch),
        [`epoch:vault:${switchId}`]: JSON.stringify(defaultVault)
      },
      profiles: {
        'did:t3n:david123': {
          first_name: 'David',
          verified_contacts: {
            email: {
              value: 'david@legacy-switch.org'
            }
          }
        },
        ...(activeDid !== 'did:t3n:david123' ? {
          [activeDid]: {
            first_name: 'Terminal 3 User',
            verified_contacts: {
              email: {
                value: 't3user@terminal3.io'
              }
            }
          }
        } : {})
      },
      legacyTargets: [
        {
          id: 'spouse-email',
          host: 'https://payout.sandbox.test',
          path: '/notify',
          method: 'POST',
          template: '{"recipient":"spouse@legacy-switch.org","content":"Sealed message released."}'
        }
      ],
      dispatchedNotifications: []
    };

    fs.writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2));
  }
}


export function readDb(): DbSchema {
  initDb();
  const content = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (e) {
    return { kv: {}, profiles: {}, legacyTargets: [], dispatchedNotifications: [] };
  }
}

export function writeDb(data: DbSchema) {
  initDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function getKv(key: string): string | null {
  const db = readDb();
  return db.kv[key] || null;
}

export function setKv(key: string, value: string): void {
  const db = readDb();
  db.kv[key] = value;
  writeDb(db);
}

export function clearDb(): void {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  initDb();
}

