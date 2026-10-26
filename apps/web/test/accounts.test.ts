import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  acceptInvite,
  AccountError,
  can,
  createInvite,
  createReset,
  createSession,
  hashPassword,
  previewToken,
  removeMember,
  resolveSession,
  revokeInvite,
  setMemberRole,
  signIn,
  stationMembers,
  switchStation,
  useReset,
  users,
  verifyPassword,
  type StationRole,
} from "@rotavox/schema";
import { db } from "../src/lib/db";
import { sameOrigin } from "../src/lib/auth";
import { approveLog, EditRejectedError } from "../src/lib/log-edits";
import { getLogDetail } from "../src/lib/queries";
import { resetDb } from "./helpers/db";
import { seedLog, seedStation } from "./helpers/fixtures";

const PASSWORD = "correct horse battery";

async function rejects(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AccountError && e.code === code);
}

/** A person at a station, made the way the UI makes them: invited, then accepting. */
async function member(stationId: string, email: string, role: StationRole) {
  const { token } = await createInvite(db, { email, stationId, role, createdBy: null });
  const { user } = await acceptInvite(db, token, { name: email.split("@")[0], password: PASSWORD });
  return user;
}

describe("passwords", () => {
  it("verifies its own hash and nothing else", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(PASSWORD + "!", stored)).toBe(false);
    expect(await verifyPassword(PASSWORD, "garbage")).toBe(false);
  });
});

describe("roles", () => {
  it("grants each role its own powers, and staff everything", () => {
    const at = (role: StationRole | null, isStaff = false) => ({ role, isStaff });
    expect(can(at("viewer"), "view")).toBe(true);
    expect(can(at("viewer"), "edit_music")).toBe(false);
    expect(can(at("programmer"), "edit_music")).toBe(true);
    expect(can(at("programmer"), "run_runner")).toBe(true);
    expect(can(at("programmer"), "manage_people")).toBe(false);
    expect(can(at("admin"), "manage_people")).toBe(true);
    expect(can(at("admin"), "staff")).toBe(false);
    expect(can(at(null), "view")).toBe(false);
    expect(can(at(null, true), "manage_station")).toBe(true);
    expect(can(at(null, true), "staff")).toBe(true);
  });
});

describe("accounts", () => {
  beforeEach(resetDb);

  it("turns an invitation into an account, a membership and a session at that station", async () => {
    const station = await seedStation({ name: "The BOLT" });
    const { token } = await createInvite(db, { email: "PD@Example.com ", stationId: station.id, role: "programmer", createdBy: null });
    expect(await previewToken(db, token)).toMatchObject({ email: "pd@example.com", stationName: "The BOLT", accountExists: false });

    const { user, stationId } = await acceptInvite(db, token, { name: "Pat", password: PASSWORD });
    const session = await createSession(db, user.id, stationId);
    const ctx = await resolveSession(db, session.token);
    expect(ctx).toMatchObject({ user: { email: "pd@example.com", name: "Pat" }, role: "programmer", station: { name: "The BOLT" } });

    // Single use.
    await rejects(acceptInvite(db, token, { name: "Pat", password: PASSWORD }), "token_invalid");
    expect(await previewToken(db, token)).toBeNull();
  });

  it("rejects a short password and a missing name", async () => {
    const station = await seedStation();
    const { token } = await createInvite(db, { email: "a@example.com", stationId: station.id, role: "viewer", createdBy: null });
    await rejects(acceptInvite(db, token, { name: "A", password: "short" }), "invalid");
    await rejects(acceptInvite(db, token, { name: " ", password: PASSWORD }), "invalid");
  });

  it("makes someone who already has an account prove it to join another station", async () => {
    const a = await seedStation({ name: "A" });
    const b = await seedStation({ name: "B" });
    const pat = await member(a.id, "pat@example.com", "admin");
    const { token } = await createInvite(db, { email: "pat@example.com", stationId: b.id, role: "viewer", createdBy: null });
    expect((await previewToken(db, token))?.accountExists).toBe(true);
    await rejects(acceptInvite(db, token, { password: "not the password" }), "bad_credentials");
    await acceptInvite(db, token, { password: PASSWORD });
    const rows = await db.select().from(stationMembers).where(eq(stationMembers.userId, pat.id));
    expect(rows.map((r) => r.role).sort()).toEqual(["admin", "viewer"]);
  });

  it("refuses withdrawn, replaced and expired invitations", async () => {
    const station = await seedStation();
    const first = await createInvite(db, { email: "x@example.com", stationId: station.id, role: "viewer", createdBy: null });
    const second = await createInvite(db, { email: "x@example.com", stationId: station.id, role: "admin", createdBy: null });
    await rejects(acceptInvite(db, first.token, { name: "X", password: PASSWORD }), "token_invalid");

    await revokeInvite(db, station.id, second.invite.id);
    await rejects(acceptInvite(db, second.token, { name: "X", password: PASSWORD }), "token_invalid");

    const old = await createInvite(db, {
      email: "y@example.com",
      stationId: station.id,
      role: "viewer",
      createdBy: null,
      now: new Date(Date.now() - 8 * 86_400_000),
    });
    await rejects(acceptInvite(db, old.token, { name: "Y", password: PASSWORD }), "token_invalid");
  });

  it("locks an account after ten wrong passwords", async () => {
    const station = await seedStation();
    await member(station.id, "pd@example.com", "programmer");
    await rejects(signIn(db, "nobody@example.com", PASSWORD), "bad_credentials");
    for (let i = 0; i < 10; i++) await rejects(signIn(db, "pd@example.com", "wrong password!"), "bad_credentials");
    await rejects(signIn(db, "pd@example.com", PASSWORD), "locked");
    // The lock lifts after 15 minutes.
    await expect(signIn(db, "PD@example.com", PASSWORD, new Date(Date.now() + 16 * 60_000))).resolves.toMatchObject({
      email: "pd@example.com",
    });
  });

  it("ends a session on expiry, on disabling, and drops a station the person was removed from", async () => {
    const station = await seedStation();
    const admin = await member(station.id, "admin@example.com", "admin");
    const pd = await member(station.id, "pd@example.com", "programmer");
    const { token } = await createSession(db, pd.id);
    expect((await resolveSession(db, token))?.station?.id).toBe(station.id);
    expect(await resolveSession(db, token, new Date(Date.now() + 31 * 86_400_000))).toBeNull();

    await removeMember(db, station.id, pd.id);
    const after = await resolveSession(db, token);
    expect(after).toMatchObject({ station: null, role: null });

    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, admin.id));
    const adminSession = await createSession(db, admin.id);
    expect(await resolveSession(db, adminSession.token)).toBeNull();
  });

  it("always leaves a station with a station admin", async () => {
    const station = await seedStation();
    const admin = await member(station.id, "admin@example.com", "admin");
    const pd = await member(station.id, "pd@example.com", "programmer");
    await rejects(setMemberRole(db, station.id, admin.id, "viewer"), "last_admin");
    await rejects(removeMember(db, station.id, admin.id), "last_admin");
    await setMemberRole(db, station.id, pd.id, "admin");
    await setMemberRole(db, station.id, admin.id, "viewer");
  });

  it("only lets someone switch to a station they have", async () => {
    const a = await seedStation({ name: "A" });
    const b = await seedStation({ name: "B" });
    const pd = await member(a.id, "pd@example.com", "programmer");
    const ctx = (await resolveSession(db, (await createSession(db, pd.id)).token))!;
    await rejects(switchStation(db, ctx, b.id), "forbidden");

    const { token } = await createInvite(db, { email: "staff@example.com", stationId: null, role: null, isStaff: true, createdBy: null });
    const { user: staff } = await acceptInvite(db, token, { name: "Staff", password: PASSWORD });
    const staffCtx = (await resolveSession(db, (await createSession(db, staff.id)).token))!;
    // Staff with no membership start on no station when there is more than one.
    expect(staffCtx.station).toBeNull();
    await switchStation(db, staffCtx, b.id);
    expect(await resolveSession(db, (await createSession(db, staff.id, b.id)).token)).toMatchObject({
      station: { id: b.id },
      role: null,
      user: { isStaff: true },
    });
  });

  it("resets a password once and signs the account out everywhere", async () => {
    const station = await seedStation();
    const pd = await member(station.id, "pd@example.com", "programmer");
    const staffInvite = await createInvite(db, { email: "s@example.com", stationId: null, role: null, isStaff: true, createdBy: null });
    const { user: staff } = await acceptInvite(db, staffInvite.token, { name: "S", password: PASSWORD });
    const old = await createSession(db, pd.id);

    const { token } = await createReset(db, { userId: pd.id, createdBy: staff.id });
    await useReset(db, token, "a brand new passphrase");
    expect(await resolveSession(db, old.token)).toBeNull();
    await rejects(useReset(db, token, "another new passphrase"), "token_invalid");
    await expect(signIn(db, "pd@example.com", "a brand new passphrase")).resolves.toBeTruthy();
  });
});

describe("station scoping", () => {
  beforeEach(resetDb);

  it("treats another station's log as not found", async () => {
    const mine = await seedStation({ name: "Mine" });
    const theirs = await seedStation({ name: "Theirs" });
    const log = await seedLog(theirs.id);
    expect(await getLogDetail(mine.id, log.id)).toBeNull();
    await expect(approveLog(mine.id, log.id)).rejects.toThrow(EditRejectedError);
    await expect(approveLog(theirs.id, log.id)).resolves.toBeTruthy();
  });
});

describe("request guards", () => {
  const req = (method: string, headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method, headers });

  it("refuses a state-changing request from another origin", () => {
    expect(sameOrigin(req("POST", { origin: "http://localhost:3000", host: "localhost:3000" }))).toBe(true);
    expect(sameOrigin(req("POST", { origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(sameOrigin(req("GET", { origin: "https://evil.example", host: "localhost:3000" }))).toBe(true);
  });

  it("puts every API route behind a guard, and only sign-in routes in public", () => {
    const root = path.resolve(__dirname, "../src/app/api");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : f === "route.ts" ? [p] : [];
      });
    const routes = walk(root);
    expect(routes.length).toBeGreaterThan(20);
    for (const file of routes) {
      const src = readFileSync(file, "utf8");
      const rel = path.relative(root, file);
      // Every exported handler is built by a guard, never a bare function.
      expect(src, rel).not.toMatch(/export (async )?function (GET|POST|PUT|PATCH|DELETE)/);
      expect(src, rel).toMatch(/export const (GET|POST|PUT|PATCH|DELETE) = (stationRoute|userRoute|publicRoute|runnerRoute)/);
      if (/publicRoute\(/.test(src)) expect(rel.startsWith("auth/"), rel).toBe(true);
      if (/runnerRoute\(/.test(src)) expect(rel.startsWith("runner/v1/"), rel).toBe(true);
    }
  });
});
