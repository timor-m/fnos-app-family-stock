#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const storage=mkdtempSync(join(tmpdir(),'stock-mcp-upgrade-'));mkdirSync(join(storage,'db'));
const databasePath=join(storage,'db','family-stock.sqlite');
let old=new DatabaseSync(databasePath),current,backup,child,output='';
try {
 old.exec(readFileSync(new URL('../tests/fixtures/family-stock-v5.sql',import.meta.url),'utf8'));
 old.exec(`INSERT INTO schema_migrations(version) VALUES(5);
 INSERT INTO users(id,display_name) VALUES('local-owner','升级前用户');
 INSERT INTO families(id,name,owner_user_id) VALUES('upgrade-family','保留测试家庭','local-owner');
 INSERT INTO family_members(family_id,user_id,role) VALUES('upgrade-family','local-owner','owner');
 INSERT INTO locations(id,family_id,name) VALUES('upgrade-location','upgrade-family','原有地点');
 INSERT INTO category_templates(id,system_key,name,icon,fields_json) VALUES('upgrade-category','upgrade-test','测试','box','[]');
 INSERT INTO products(id,family_id,category_id,name) VALUES('upgrade-product','upgrade-family','upgrade-category','原有物品');
 INSERT INTO inventory_batches(id,product_id,location_id,current_quantity,unit) VALUES('upgrade-batch','upgrade-product','upgrade-location',7,'件');
 INSERT INTO inventory_transactions(id,family_id,product_id,batch_id,transaction_type,quantity,unit,operator_user_id) VALUES('upgrade-tx','upgrade-family','upgrade-product','upgrade-batch','stock_in',7,'件','local-owner');`);
 assert.equal(old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_grants'").get(),undefined);
 assert.equal(old.prepare('PRAGMA table_info(inventory_batches)').all().some(c=>c.name==='version'),false);
 old.close();old=null;
 const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
 child=spawn(process.execPath,['scripts/start.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',STORAGE_DIR:storage,LOG_DIR:join(storage,'logs'),FNOS_SOCKET_PATH:'',VITE_DEV_SERVER_URL:''},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),15000);const poll=()=>{if(output.includes('Nitro listening')){clearTimeout(timer);resolve();}else if(child.exitCode!==null){clearTimeout(timer);reject(Error(output));}else setTimeout(poll,30);};poll();});
 const base=`http://127.0.0.1:${port}/app/fnos-app-family-stock`;
 const response=await fetch(`${base}/api/about`);assert.equal(response.status,200);const about=await response.json();assert.equal(about.data.database.schemaVersion,6);
 current=new DatabaseSync(databasePath);
 assert.equal(current.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(current.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.equal(current.prepare('SELECT name FROM families WHERE id=?').get('upgrade-family').name,'保留测试家庭');
 assert.equal(current.prepare('SELECT current_quantity,version FROM inventory_batches WHERE id=?').get('upgrade-batch').current_quantity,7);
 assert.equal(current.prepare('SELECT COUNT(*) AS n FROM inventory_transactions WHERE id=?').get('upgrade-tx').n,1);
 assert.equal(current.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,6);
 assert.ok(current.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_grants'").get());
 const backupPath=join(storage,'backups',`before-update-${metadata.version}.sqlite`);assert.ok(existsSync(backupPath));assert.equal(statSync(backupPath).mode&0o777,0o600);
 backup=new DatabaseSync(backupPath);assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.equal(backup.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,5);
 assert.equal(backup.prepare('SELECT current_quantity FROM inventory_batches WHERE id=?').get('upgrade-batch').current_quantity,7);
 assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_grants'").get(),undefined);
 console.log('PASS: real production startup migrates frozen v5 to v6, preserves family/location/inventory/history, verifies foreign keys, and creates a 0600 intact pre-migration backup.');
} catch(error){console.error(error);console.error(output.slice(-3000));process.exitCode=1;}
finally{old?.close();current?.close();backup?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}rmSync(storage,{recursive:true,force:true});}
