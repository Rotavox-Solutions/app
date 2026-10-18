// box-side MariaDB query helper: node bq.mjs "SQL" -> TSV
import "dotenv/config"; import mysql from "mysql2/promise";
const c = await mysql.createConnection({host:process.env.RADIODJ_DB_HOST,port:+process.env.RADIODJ_DB_PORT,user:process.env.RADIODJ_DB_USER,password:process.env.RADIODJ_DB_PASSWORD,database:process.env.RADIODJ_DB_NAME,multipleStatements:false});
const [rows] = await c.query(process.argv[2]);
if (Array.isArray(rows) && rows.length) { const k=Object.keys(rows[0]); console.log(k.join('\t')); for (const r of rows) console.log(k.map(x=>r[x]).join('\t')); } else console.log(JSON.stringify(rows));
await c.end();
