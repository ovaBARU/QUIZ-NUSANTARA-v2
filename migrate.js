import fs from 'fs';
import pg from 'pg';
const {Pool}=pg;
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required. Add a PostgreSQL service to Railway.');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
try{const sql=fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8');await pool.query(sql);console.log('RAVIXO database migration completed.');}
catch(err){console.error('RAVIXO migration failed:',err.message);process.exitCode=1;}
finally{await pool.end();}
