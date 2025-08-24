// Type definitions for better-sqlite3
declare module 'better-sqlite3' {
  interface Database {
    prepare(sql: string): Statement;
    close(): void;
    pragma(pragma: string, options?: { simple?: boolean }): any;
  }

  interface Statement {
    all(...params: any[]): any[];
    get(...params: any[]): any;
    run(...params: any[]): { changes: number; lastInsertRowid: number };
  }
}

export interface DeviceRow {
  id: string;
  meta?: string;
  [key: string]: unknown;
}

export interface DeviceMeta {
  uuid?: string;
  [key: string]: unknown;
}

export type DB = any; // Using any as a fallback for Database type

export function openDb(file: string): DB | null {
  try {
    const db = new (require('better-sqlite3').default)(file);
    db.pragma('journal_mode = WAL');
    return db as unknown as DB;
  } catch (error) {
    console.error('Failed to open database:', error);
    return null;
  }
}
