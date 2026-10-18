// Mirrors the Rotavox M4 clocks into RadioDJ rotations + weekly "Load Rotation" events,
// so AutoDJ (the fail-safe) follows the same hour plan when no Rotavox log is pacing.
// Idempotent: rotations/events are matched by name; existing item rows are rewritten in
// place (the RadioDJ user has no DELETE grant). Formats learned from PD-made examples.
import "dotenv/config"; import mysql from "mysql2/promise"; import { readFileSync } from "node:fs";
const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const c = await mysql.createConnection({host:process.env.RADIODJ_DB_HOST,port:+process.env.RADIODJ_DB_PORT,user:process.env.RADIODJ_DB_USER,password:process.env.RADIODJ_DB_PASSWORD,database:process.env.RADIODJ_DB_NAME});
await c.beginTransaction();
try {
  async function writeRotation(pID, items) {
    const [have] = await c.query("SELECT ID FROM rotations_list WHERE pID=? ORDER BY ord, ID", [pID]);
    for (let i = 0; i < items.length; i++) {
      const [cat, sub, rep] = items[i];
      if (i < have.length) {
        await c.query("UPDATE rotations_list SET catID=?, subID=?, genID=0, mood='---', gender='---', language='---', start_type=0, end_type=0, selType=0, sweeper=0, repeatRule=?, ord=?, data='', track_separation=0, artist_separation=0, title_separation=0, album_separation=0 WHERE ID=?", [cat, sub, rep, i, have[i].ID]);
      } else {
        await c.query("INSERT INTO rotations_list (pID,catID,subID,genID,mood,gender,language,start_type,end_type,selType,sweeper,repeatRule,ord,data,track_separation,artist_separation,title_separation,album_separation,advanced) VALUES (?,?,?,0,'---','---','---',0,0,0,0,?,?,'',0,0,0,0,'')", [pID, cat, sub, rep, i]);
      }
    }
    if (have.length > items.length) throw new Error(`rotation ${pID} has ${have.length} rows > ${items.length}; cannot shrink without DELETE`);
  }
  const ids = {};
  for (const [name, items] of Object.entries(plan.rotations)) {
    let [[r]] = await c.query("SELECT ID FROM rotations WHERE name=?", [name]);
    if (!r) { const [res] = await c.query("INSERT INTO rotations (name) VALUES (?)", [name]); r = { ID: res.insertId }; }
    ids[name] = r.ID; await writeRotation(r.ID, items);
  }
  const [[def]] = await c.query("SELECT ID FROM rotations WHERE name='Default'");
  await writeRotation(def.ID, plan.default);
  // Events: the PD's example (ID 1) is reused for the first one.
  const [existing] = await c.query("SELECT ID, name FROM events WHERE type=1 AND data LIKE 'Load Rotation|%' ORDER BY ID");
  const spare = existing.filter(e => !e.name.startsWith("BOLT ")).map(e => e.ID);
  let n = 0;
  for (const e of plan.events) {
    const hh = String(e.hour).padStart(2, "0");
    const name = `${e.rot} ${hh}:00 UTC`;
    const day = "&" + e.days.join("&");
    const data = `Load Rotation|${ids[e.rot]}|${e.rot}`;
    const [[row]] = await c.query("SELECT ID FROM events WHERE name=?", [name]);
    const id = row?.ID ?? spare.shift();
    if (id) await c.query("UPDATE events SET type=1, time=?, name=?, day=?, hours='&', data=?, enabled=1, catID=1, smart=0, grouped=0 WHERE ID=?", [`${hh}:00:00`, name, day, data, id]);
    else await c.query("INSERT INTO events (type,time,name,day,hours,data,enabled,catID,smart,grouped) VALUES (1,?,?,?,'&',?,1,1,0,0)", [`${hh}:00:00`, name, day, data]);
    n++;
  }
  await c.commit();
  console.log(JSON.stringify({ rotations: ids, default: def.ID, events: n }));
} catch (e) { await c.rollback(); console.error("ROLLED BACK:", e.message); process.exitCode = 1; }
await c.end();
