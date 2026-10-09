import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';import assert from 'node:assert/strict';
import {handleGame} from '../app/server/game-api.ts';
const sqlite=new DatabaseSync(':memory:');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8'));
const db={prepare(sql){let args=[];return{bind(...a){args=a;return this},async first(){return sqlite.prepare(sql).get(...args)||null},async all(){return{results:sqlite.prepare(sql).all(...args)}},async run(){return{meta:sqlite.prepare(sql).run(...args)}}}},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
let now=100000;const cookies={};
async function api(who,data,extra={}){const get=typeof data==='string';const response=await handleGame(new Request('https://game.test/api/game'+(get?'?'+data:''),{method:get?'GET':'POST',headers:{'Content-Type':'application/json',Origin:'https://game.test',...(cookies[who]?{Cookie:cookies[who]}:{}),...extra},body:get?undefined:JSON.stringify(data)}),db,now);const set=response.headers.get('set-cookie');if(set){assert(set.includes('HttpOnly'));assert(set.includes('Secure'));cookies[who]=set.split(';')[0]}return{status:response.status,body:await response.json()}}
assert.equal((await api('a',{action:'create',title:'friends',difficulty:'normal'})).status,401);
assert.equal((await api('a',{action:'session',name:'<script>'})).status,400);
assert.equal((await api('a',{action:'session',name:'أحمد'})).status,200);assert.equal((await api('b',{action:'session',name:'ليلى'})).status,200);
const created=await api('a',{action:'create',title:'تحدي الأصدقاء',difficulty:'normal'});assert.equal(created.status,201);const id=created.body.challenge.id;
assert.equal((await api('b','action=challenge&id='+id)).body.leaderboard.players,0);
async function attempt(who,score,challengeId=id){const started=await api(who,{action:'start',challengeId});assert.equal(started.status,201);now+=10000;const payload={action:'finish',runId:started.body.runId,score,sector:1,elapsedMs:10000};const finished=await api(who,payload);assert.equal(finished.status,200);return{payload,board:finished.body.leaderboard}}
const a1=await attempt('a',1000);await attempt('b',2000);const lower=await attempt('b',500);assert.equal(lower.board.entries[0].score,2000);assert.equal(lower.board.players,2);assert.equal(lower.board.entries.length,2);
const higher=await attempt('a',3000);assert.equal(higher.board.entries[0].name,'أحمد');await attempt('a',40);const tied=await attempt('b',3000);assert.equal(tied.board.entries[0].name,'أحمد');
assert.equal((await api('a',a1.payload)).status,200);assert.equal((await api('a',{...a1.payload,score:900})).status,409);assert.equal((await api('b',a1.payload)).status,404);
assert.equal((await api('a',{action:'start',challengeId:id},{Origin:'https://other.test'})).status,403);
const invalid=await api('a',{action:'start',challengeId:id});assert.equal((await api('a',{action:'finish',runId:invalid.body.runId,score:999999999,sector:1,elapsedMs:0})).status,400);
// More than the former 120-per-hour limit: all attempts can start, and only the best counts.
for(let i=0;i<130;i++){const start=await api('a',{action:'start',challengeId:id});assert.equal(start.status,201);now+=1;assert.equal((await api('a',{action:'finish',runId:start.body.runId,score:0,sector:1,elapsedMs:0})).status,200)}
const repeated=(await api('a','action=challenge&id='+id)).body.leaderboard;assert.equal(repeated.entries.length,2);assert.equal(repeated.entries[0].score,3000);assert.equal(repeated.players,2);
const second=(await api('b',{action:'create',title:'مجموعة أخرى',difficulty:'easy'})).body.challenge.id;assert.equal((await api('b','action=challenge&id='+second)).body.leaderboard.players,0);await attempt('b',123,second);assert.equal((await api('a','action=challenge&id='+id)).body.leaderboard.entries[0].score,3000);
const old=await api('a',{action:'start',challengeId:id});now+=1800001;assert.equal((await api('a',{action:'finish',runId:old.body.runId,score:10,sector:1,elapsedMs:100})).status,410);
assert.equal((await api('a','action=challenge&id=invalid')).status,404);
sqlite.close();console.log('PASS: two players, persistent shared ranking, unlimited retries (130 in an hour), best-only scores, tie order, separate invitations, session cookies, replay idempotence, ownership, invalid scores, CSRF and expiry.');
