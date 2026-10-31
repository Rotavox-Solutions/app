// Accounts, station roles and sessions (ADR-0003). Framework-free so the web app, the
// engineer bootstrap and, later, the Runner API all share one implementation; the web
// app adds only the cookie and request glue.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { accountTokens, sessions, stationMembers, stations, users } from "./schema.js";

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// ── Roles ───────────────────────────────────────────────────────────────────────────

export type StationRole = "admin" | "programmer" | "viewer";
export const STATION_ROLES: readonly StationRole[] = ["admin", "programmer", "viewer"];
export const ROLE_LABEL: Record<StationRole, string> = {
  admin: "Station admin",
  programmer: "Programmer",
  viewer: "Viewer",
};
export const ROLE_DESCRIPTION: Record<StationRole, string> = {
  admin: "Everything a programmer can do, plus people and station setup.",
  programmer: "PD or MD: music, logs and changes, and asking the Runner to sync.",
  viewer: "Can look at everything and change nothing.",
};

/**
 * What a role may do at its station. Staff may do all of it at any station, plus the
 * 'staff' permission. Checked on the server for every request; the UI only hides what a
 * person can't use.
 */
export type Permission =
  "view" | "edit_music" | "edit_format" | "edit_logs" | "run_runner" | "manage_station" | "manage_people" | "staff";

const GRANTS: Record<StationRole, readonly Permission[]> = {
  viewer: ["view"],
  programmer: ["view", "edit_music", "edit_format", "edit_logs", "run_runner"],
  admin: ["view", "edit_music", "edit_format", "edit_logs", "run_runner", "manage_station", "manage_people"],
};

export function can(who: { isStaff: boolean; role: StationRole | null }, permission: Permission): boolean {
  if (who.isStaff) return true;
  if (permission === "staff" || !who.role) return false;
  return GRANTS[who.role].includes(permission);
}

// ── Errors ──────────────────────────────────────────────────────────────────────────

export type AccountErrorCode =
  "invalid" | "bad_credentials" | "locked" | "token_invalid" | "email_taken" | "not_found" | "last_admin" | "forbidden";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

// ── Passwords ───────────────────────────────────────────────────────────────────────

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
// N=2^15 costs ~50-100ms per hash; maxmem must cover 128*N*r bytes.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function checkPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password, salt, keylen, { N, r, p, maxmem: 256 * N * r });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const N = Number(n);
  const key = await scrypt(password.slice(0, MAX_PASSWORD_LENGTH), Buffer.from(salt, "base64url"), expected.length, {
    N,
    r: Number(r),
    p: Number(p),
    maxmem: 256 * N * Number(r),
  });
  return timingSafeEqual(key, expected);
}

// Compared against when the email is unknown, so a miss takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;

// ── Tokens ──────────────────────────────────────────────────────────────────────────

/** A random secret for a cookie or a link. Only its hash is ever stored. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ── Sessions ────────────────────────────────────────────────────────────────────────

export const SESSION_DAYS = 30;
const LOCK_AFTER_FAILURES = 10;
const LOCK_MINUTES = 15;
// lastSeenAt is for "signed in from…" views; writing it on every request is waste.
const TOUCH_AFTER_MS = 5 * 60_000;

export type UserRow = typeof users.$inferSelect;
export type PublicUser = Pick<UserRow, "id" | "email" | "name" | "isStaff">;

export interface SessionContext {
  sessionId: string;
  user: PublicUser;
  /** The station this browser is working on; null for staff yet to pick one, or someone with no stations. */
  station: { id: string; name: string; timezone: string; playout: "radiodj" | "file" } | null;
  /** Their role there; null for staff working at a station they aren't a member of. */
  role: StationRole | null;
}

const publicUser = (u: UserRow): PublicUser => ({ id: u.id, email: u.email, name: u.name, isStaff: u.isStaff });

/** The station a new session starts on: their first membership, alphabetically. */
async function defaultStation(db: Db, user: Pick<UserRow, "id" | "isStaff">): Promise<string | null> {
  const [m] = await db
    .select({ stationId: stationMembers.stationId })
    .from(stationMembers)
    .innerJoin(stations, eq(stations.id, stationMembers.stationId))
    .where(eq(stationMembers.userId, user.id))
    .orderBy(asc(stations.name))
    .limit(1);
  if (m) return m.stationId;
  if (!user.isStaff) return null;
  const all = await db.select({ id: stations.id }).from(stations).limit(2);
  return all.length === 1 ? all[0].id : null;
}

export async function createSession(
  db: Db,
  userId: string,
  stationId?: string | null,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new AccountError("not_found", "no such user");
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    tokenHash: hash,
    userId,
    stationId: stationId ?? (await defaultStation(db, user)),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * The person behind a session cookie, and where they're working. Null when the token is
 * unknown, expired, or the account is disabled. A membership removed since sign-in is
 * noticed here, on the next request, not at the next sign-in.
 */
export async function resolveSession(db: Db, token: string, now: Date = new Date()): Promise<SessionContext | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)));
  if (!row || row.user.disabledAt) return null;
  const { session, user } = row;

  let stationId = session.stationId;
  let role: StationRole | null = null;
  if (stationId) {
    const [m] = await db
      .select({ role: stationMembers.role })
      .from(stationMembers)
      .where(and(eq(stationMembers.stationId, stationId), eq(stationMembers.userId, user.id)));
    role = (m?.role as StationRole | undefined) ?? null;
    if (!m && !user.isStaff) stationId = null;
  }
  if (!stationId) {
    const fallback = await defaultStation(db, user);
    if (fallback !== session.stationId) {
      await db.update(sessions).set({ stationId: fallback }).where(eq(sessions.id, session.id));
      if (fallback) return resolveSession(db, token, now);
    }
  }
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
  }
  const [station] = stationId
    ? await db
        .select({ id: stations.id, name: stations.name, timezone: stations.timezone, playout: stations.playout })
        .from(stations)
        .where(eq(stations.id, stationId))
    : [];
  return { sessionId: session.id, user: publicUser(user), station: station ?? null, role };
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Signs a person out everywhere, optionally keeping the browser they're using. */
export async function endAllSessions(db: Db, userId: string, keepSessionId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(
      keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId),
    );
}

/** Stations this person can switch to: their memberships, or every station for staff. */
export async function listAccessibleStations(
  db: Db,
  user: Pick<PublicUser, "id" | "isStaff">,
): Promise<{ id: string; name: string; role: StationRole | null }[]> {
  const rows = await db
    .select({ id: stations.id, name: stations.name, role: stationMembers.role })
    .from(stations)
    .leftJoin(stationMembers, and(eq(stationMembers.stationId, stations.id), eq(stationMembers.userId, user.id)))
    .where(user.isStaff ? undefined : sql`${stationMembers.userId} IS NOT NULL`)
    .orderBy(asc(stations.name));
  return rows.map((r) => ({ ...r, role: (r.role as StationRole | null) ?? null }));
}

export async function switchStation(db: Db, ctx: SessionContext, stationId: string): Promise<void> {
  const ok = (await listAccessibleStations(db, ctx.user)).some((s) => s.id === stationId);
  if (!ok) throw new AccountError("forbidden", "you don't have access to that station");
  await db.update(sessions).set({ stationId }).where(eq(sessions.id, ctx.sessionId));
}

// ── Signing in ──────────────────────────────────────────────────────────────────────

/** Checks a password, with a lockout after repeated failures. Returns the user to start a session for. */
export async function signIn(db: Db, email: string, password: string, now: Date = new Date()): Promise<PublicUser> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)));
  if (!user || user.disabledAt) {
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(password, await dummyHash);
    throw new AccountError("bad_credentials", "That email and password don't match an account.");
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    throw new AccountError("locked", "Too many wrong passwords. Try again in a few minutes.");
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failures = user.failedLogins + 1;
    await db
      .update(users)
      .set(
        failures >= LOCK_AFTER_FAILURES
          ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
          : { failedLogins: failures },
      )
      .where(eq(users.id, user.id));
    throw new AccountError("bad_credentials", "That email and password don't match an account.");
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
  return publicUser(user);
}

export async function changePassword(db: Db, userId: string, current: string, next: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new AccountError("not_found", "no such user");
  if (!(await verifyPassword(current, user.passwordHash))) {
    throw new AccountError("bad_credentials", "Your current password isn't right.");
  }
  const problem = checkPassword(next);
  if (problem) throw new AccountError("invalid", problem);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, userId));
}

export async function renameUser(db: Db, userId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new AccountError("invalid", "Enter a name.");
  await db.update(users).set({ name: trimmed }).where(eq(users.id, userId));
}

// ── Invitations and resets ──────────────────────────────────────────────────────────

export const INVITE_DAYS = 7;
export const RESET_HOURS = 24;

export type AccountTokenRow = typeof accountTokens.$inferSelect;

/**
 * Invites someone to a station with a role, or (stationId null, isStaff) to Rotavox
 * staff. Returns the secret for the link; it is shown once and never stored. Inviting the
 * same email again replaces the earlier invitation.
 */
export async function createInvite(
  db: Db,
  opts: {
    email: string;
    stationId: string | null;
    role: StationRole | null;
    isStaff?: boolean;
    createdBy: string | null;
    now?: Date;
  },
): Promise<{ token: string; invite: AccountTokenRow }> {
  const email = normalizeEmail(opts.email);
  if (!looksLikeEmail(email)) throw new AccountError("invalid", "Enter an email address.");
  const isStaff = opts.isStaff ?? false;
  if (!isStaff && (!opts.stationId || !opts.role || !STATION_ROLES.includes(opts.role))) {
    throw new AccountError("invalid", "An invitation needs a station and a role.");
  }
  if (opts.stationId) {
    const [existing] = await db
      .select({ userId: stationMembers.userId })
      .from(stationMembers)
      .innerJoin(users, eq(users.id, stationMembers.userId))
      .where(and(eq(stationMembers.stationId, opts.stationId), eq(users.email, email)));
    if (existing) throw new AccountError("email_taken", "That person already works at this station.");
  }
  const now = opts.now ?? new Date();
  const { token, hash } = newToken();
  return db.transaction(async (tx) => {
    await tx
      .update(accountTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(accountTokens.purpose, "invite"),
          eq(accountTokens.email, email),
          opts.stationId ? eq(accountTokens.stationId, opts.stationId) : isNull(accountTokens.stationId),
          isNull(accountTokens.usedAt),
          isNull(accountTokens.revokedAt),
        ),
      );
    const [invite] = await tx
      .insert(accountTokens)
      .values({
        purpose: "invite",
        tokenHash: hash,
        email,
        stationId: opts.stationId,
        role: opts.role,
        isStaff,
        createdBy: opts.createdBy,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
      })
      .returning();
    return { token, invite };
  });
}

/** A password-reset link for an existing account. Staff hand these out; there is no email yet. */
export async function createReset(
  db: Db,
  opts: { userId: string; createdBy: string; now?: Date },
): Promise<{ token: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, opts.userId));
  if (!user) throw new AccountError("not_found", "no such user");
  const now = opts.now ?? new Date();
  const { token, hash } = newToken();
  await db.insert(accountTokens).values({
    purpose: "reset",
    tokenHash: hash,
    email: user.email,
    createdBy: opts.createdBy,
    createdAt: now,
    expiresAt: new Date(now.getTime() + RESET_HOURS * 3_600_000),
  });
  return { token };
}

export interface TokenPreview {
  purpose: "invite" | "reset";
  email: string;
  stationName: string | null;
  role: StationRole | null;
  isStaff: boolean;
  /** Whether an account already exists for the email, so the page asks for its password instead. */
  accountExists: boolean;
  invitedBy: string | null;
}

async function liveToken(db: Db | Tx, token: string, now: Date) {
  const [row] = await db
    .select()
    .from(accountTokens)
    .where(
      and(
        eq(accountTokens.tokenHash, hashToken(token)),
        isNull(accountTokens.usedAt),
        isNull(accountTokens.revokedAt),
        gt(accountTokens.expiresAt, now),
      ),
    );
  return row ?? null;
}

/** What a link is for, so its page can say so. Null for one that's used, revoked or expired. */
export async function previewToken(db: Db, token: string, now: Date = new Date()): Promise<TokenPreview | null> {
  const row = await liveToken(db, token, now);
  if (!row) return null;
  const [[station], [existing], [inviter]] = await Promise.all([
    row.stationId ? db.select({ name: stations.name }).from(stations).where(eq(stations.id, row.stationId)) : [],
    db.select({ id: users.id }).from(users).where(eq(users.email, row.email)),
    row.createdBy ? db.select({ name: users.name }).from(users).where(eq(users.id, row.createdBy)) : [],
  ]);
  return {
    purpose: row.purpose as "invite" | "reset",
    email: row.email,
    stationName: station?.name ?? null,
    role: (row.role as StationRole | null) ?? null,
    isStaff: row.isStaff,
    accountExists: Boolean(existing),
    invitedBy: inviter?.name ?? null,
  };
}

/**
 * Uses an invitation. A new person sets their name and password; someone who already has
 * an account proves it with their password. Either way they end up a member, and the
 * caller starts their session at the invited station.
 */
export async function acceptInvite(
  db: Db,
  token: string,
  form: { name?: string; password: string },
  now: Date = new Date(),
): Promise<{ user: PublicUser; stationId: string | null }> {
  return db.transaction(async (tx) => {
    const invite = await liveToken(tx, token, now);
    if (!invite || invite.purpose !== "invite") {
      throw new AccountError(
        "token_invalid",
        "This invitation has been used, withdrawn or has expired. Ask for a new one.",
      );
    }
    let [user] = await tx.select().from(users).where(eq(users.email, invite.email));
    if (user) {
      if (!(await verifyPassword(form.password, user.passwordHash))) {
        throw new AccountError("bad_credentials", "That isn't the password for this account.");
      }
      if (invite.isStaff && !user.isStaff) {
        [user] = await tx.update(users).set({ isStaff: true }).where(eq(users.id, user.id)).returning();
      }
    } else {
      const name = form.name?.trim();
      if (!name) throw new AccountError("invalid", "Enter your name.");
      const problem = checkPassword(form.password);
      if (problem) throw new AccountError("invalid", problem);
      [user] = await tx
        .insert(users)
        .values({
          email: invite.email,
          name,
          passwordHash: await hashPassword(form.password),
          isStaff: invite.isStaff,
          createdAt: now,
        })
        .returning();
    }
    if (invite.stationId && invite.role) {
      await tx
        .insert(stationMembers)
        .values({ stationId: invite.stationId, userId: user.id, role: invite.role, createdAt: now })
        .onConflictDoUpdate({ target: [stationMembers.stationId, stationMembers.userId], set: { role: invite.role } });
    }
    await tx.update(accountTokens).set({ usedAt: now }).where(eq(accountTokens.id, invite.id));
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
    return { user: publicUser(user), stationId: invite.stationId };
  });
}

/** Uses a reset link: sets the new password and signs the account out everywhere else. */
export async function useReset(db: Db, token: string, password: string, now: Date = new Date()): Promise<PublicUser> {
  const problem = checkPassword(password);
  if (problem) throw new AccountError("invalid", problem);
  return db.transaction(async (tx) => {
    const reset = await liveToken(tx, token, now);
    if (!reset || reset.purpose !== "reset") {
      throw new AccountError("token_invalid", "This reset link has been used or has expired. Ask for a new one.");
    }
    const [user] = await tx
      .update(users)
      .set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(users.email, reset.email))
      .returning();
    if (!user) throw new AccountError("token_invalid", "The account for this link no longer exists.");
    await tx.update(accountTokens).set({ usedAt: now }).where(eq(accountTokens.id, reset.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    return publicUser(user);
  });
}

export async function revokeInvite(db: Db, stationId: string, inviteId: string, now: Date = new Date()): Promise<void> {
  const rows = await db
    .update(accountTokens)
    .set({ revokedAt: now })
    .where(and(eq(accountTokens.id, inviteId), eq(accountTokens.stationId, stationId), isNull(accountTokens.usedAt)))
    .returning({ id: accountTokens.id });
  if (rows.length === 0) throw new AccountError("not_found", "no such invitation");
}

// ── People at a station ─────────────────────────────────────────────────────────────

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: StationRole;
  isStaff: boolean;
  lastLoginAt: Date | null;
  disabled: boolean;
}

export async function listMembers(db: Db, stationId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: stationMembers.role,
      isStaff: users.isStaff,
      lastLoginAt: users.lastLoginAt,
      disabledAt: users.disabledAt,
    })
    .from(stationMembers)
    .innerJoin(users, eq(users.id, stationMembers.userId))
    .where(eq(stationMembers.stationId, stationId))
    .orderBy(asc(users.name));
  return rows.map(({ disabledAt, ...r }) => ({ ...r, role: r.role as StationRole, disabled: disabledAt != null }));
}

export async function listPendingInvites(db: Db, stationId: string, now: Date = new Date()) {
  return db
    .select({
      id: accountTokens.id,
      email: accountTokens.email,
      role: accountTokens.role,
      createdAt: accountTokens.createdAt,
      expiresAt: accountTokens.expiresAt,
      invitedBy: users.name,
    })
    .from(accountTokens)
    .leftJoin(users, eq(users.id, accountTokens.createdBy))
    .where(
      and(
        eq(accountTokens.stationId, stationId),
        eq(accountTokens.purpose, "invite"),
        isNull(accountTokens.usedAt),
        isNull(accountTokens.revokedAt),
        gt(accountTokens.expiresAt, now),
      ),
    )
    .orderBy(asc(accountTokens.email));
}

/** A station must always keep a station admin, or nobody there could manage its people. */
async function assertAnotherAdmin(tx: Tx, stationId: string, userId: string) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(stationMembers)
    .where(
      and(eq(stationMembers.stationId, stationId), eq(stationMembers.role, "admin"), ne(stationMembers.userId, userId)),
    );
  if (Number(row?.n ?? 0) === 0) {
    throw new AccountError(
      "last_admin",
      "Every station needs at least one station admin. Make someone else an admin first.",
    );
  }
}

export async function setMemberRole(db: Db, stationId: string, userId: string, role: StationRole): Promise<void> {
  if (!STATION_ROLES.includes(role)) throw new AccountError("invalid", "unknown role");
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(stationMembers)
      .where(and(eq(stationMembers.stationId, stationId), eq(stationMembers.userId, userId)))
      .for("update");
    if (!m) throw new AccountError("not_found", "that person doesn't work at this station");
    if (m.role === "admin" && role !== "admin") await assertAnotherAdmin(tx, stationId, userId);
    await tx
      .update(stationMembers)
      .set({ role })
      .where(and(eq(stationMembers.stationId, stationId), eq(stationMembers.userId, userId)));
  });
}

export async function removeMember(db: Db, stationId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(stationMembers)
      .where(and(eq(stationMembers.stationId, stationId), eq(stationMembers.userId, userId)))
      .for("update");
    if (!m) throw new AccountError("not_found", "that person doesn't work at this station");
    if (m.role === "admin") await assertAnotherAdmin(tx, stationId, userId);
    await tx
      .delete(stationMembers)
      .where(and(eq(stationMembers.stationId, stationId), eq(stationMembers.userId, userId)));
  });
}

// ── Staff ───────────────────────────────────────────────────────────────────────────

export async function listStaff(db: Db): Promise<PublicUser[]> {
  const rows = await db.select().from(users).where(eq(users.isStaff, true)).orderBy(asc(users.name));
  return rows.map(publicUser);
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(users);
  return Number(row?.n ?? 0);
}
