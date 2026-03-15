import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

function resolveDatabaseUrl(databaseUrl: string): string {
    if (
        databaseUrl.startsWith('file:') ||
        databaseUrl.startsWith('libsql:') ||
        databaseUrl.startsWith('http://') ||
        databaseUrl.startsWith('https://')
    ) {
        return databaseUrl;
    }

    return `file:${databaseUrl}`;
}

const client = createClient({ 
    url: resolveDatabaseUrl(env.DATABASE_URL)
});

export const db = drizzle(client, { schema });
