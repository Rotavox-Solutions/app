// Mirrors the Rotavox M4 clocks into RadioDJ rotations, so AutoDJ (the fail-safe) plays
// the same clock shapes when no Rotavox log is pacing. The weekly "Load Rotation" events
// that pick a rotation per hour are written by the Runner's project_autodj_events job
// (src/autodj-events.ts) from this file's localEvents, because they move with DST.
// Idempotent: rotations are matched by name; existing item rows are rewritten in place
// (the RadioDJ user has no DELETE grant). Formats learned from PD-made examples.
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
  await c.commit();
  console.log(JSON.stringify({ rotations: ids, default: def.ID }));
} catch (e) { await c.rollback(); console.error("ROLLED BACK:", e.message); process.exitCode = 1; }
await c.end();
