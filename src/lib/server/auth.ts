import { db } from './db';
import { sessions, users } from './db/schema';
import { eq } from 'drizzle-orm';

export function generateSessionToken() {
    return crypto.randomUUID();
}

export async function createSession(token: string, userId: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days
    await db.insert(sessions).values({
        id: token,
        userId,
        expiresAt: Math.floor(expiresAt.getTime() / 1000)
    });
    return { id: token, userId, expiresAt };
}

export async function validateSessionToken(token: string) {
    const result = await db
        .select({ user: users, session: sessions })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, token));
        
    if (result.length === 0) return { session: null, user: null };
    
    const { user, session } = result[0];
    const now = Math.floor(Date.now() / 1000);
    
    if (now >= session.expiresAt) {
        await db.delete(sessions).where(eq(sessions.id, session.id));
        return { session: null, user: null };
    }
    
    // Extend session a bit if it's close to expiring (within 15 days)
    if (session.expiresAt - now < 15 * 24 * 60 * 60) {
        const newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 30);
        session.expiresAt = Math.floor(newExpiresAt.getTime() / 1000);
        await db.update(sessions).set({ expiresAt: session.expiresAt }).where(eq(sessions.id, session.id));
    }
    
    return { session, user };
}

export async function invalidateSession(token: string) {
    await db.delete(sessions).where(eq(sessions.id, token));
}
