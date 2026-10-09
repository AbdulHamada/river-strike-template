// Guest tokens are HttpOnly cookies. Challenge IDs are invitation links.
// Basic score checks suit friendly competition; they are not cheat-proof adjudication.
const cookieName='river_player';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const tokenPattern=/^[a-f0-9]{64}$/;
const json=(body:unknown,status=200,extra:Record<string,string>={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
class ApiError extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status}}
function check(condition:unknown,message:string,status=400):asserts condition{if(!condition)throw new ApiError(status,message)}
function label(value:unknown,max:number){check(typeof value==='string','اكتب اسمًا صالحًا.');const clean=value.normalize('NFKC').trim().replace(/\s+/g,' ');check(clean.length>=2&&clean.length<=max&&!/[<>\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(clean),'استخدم اسمًا من حرفين إلى '+max+' حرفًا دون رموز تحكّم.');return clean}
async function hash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
function cookie(request:Request){return(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
async function player(request:Request,db:D1Database){const key=cookie(request);if(!tokenPattern.test(key))return null;return db.prepare('SELECT id,name FROM players WHERE token_hash=?').bind(await hash(key)).first<{id:string,name:string}>()}
type Challenge={id:string,title:string,difficulty:string,seed:number,created_at:number};
async function room(db:D1Database,id:unknown){check(typeof id==='string'&&uuid.test(id),'رابط الدعوة غير صالح.',404);const row=await db.prepare('SELECT id,title,difficulty,seed,created_at FROM challenges WHERE id=?').bind(id).first<Challenge>();check(row,'لم نعثر على هذا التحدّي. تحقق من رابط الدعوة.',404);return row}
const publicRoom=(r:Challenge)=>({id:r.id,title:r.title,difficulty:r.difficulty,seed:r.seed,duration:180,createdAt:r.created_at});
async function board(db:D1Database,id:string,mine:string|null){
 const result=await db.prepare(`WITH attempts AS (
 SELECT player_id,score,sector,elapsed_ms,finished_at,ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY score DESC,finished_at ASC,id ASC) AS attempt_rank
 FROM runs WHERE challenge_id=? AND status='finished'), ranked AS (
 SELECT player_id,score,sector,elapsed_ms,finished_at,ROW_NUMBER() OVER(ORDER BY score DESC,finished_at ASC,player_id ASC) AS place FROM attempts WHERE attempt_rank=1)
 SELECT p.name,r.player_id,r.score,r.sector,r.elapsed_ms,r.place FROM ranked r JOIN players p ON p.id=r.player_id WHERE r.place<=50 OR r.player_id=? ORDER BY r.place`).bind(id,mine||'').all<{name:string,player_id:string,score:number,sector:number,elapsed_ms:number,place:number}>();
 const count=await db.prepare("SELECT COUNT(DISTINCT player_id) AS total FROM runs WHERE challenge_id=? AND status='finished'").bind(id).first<{total:number}>();
 return{entries:result.results.map(r=>({name:r.name,tag:r.player_id.slice(0,4),score:r.score,sector:r.sector,seconds:Math.round(r.elapsed_ms/1000),rank:r.place,mine:r.player_id===mine})),players:count?.total||0,updatedAt:Date.now()};
}
export async function handleGame(request:Request,db:D1Database|undefined,now=Date.now()):Promise<Response>{
 try{
  check(db,'خدمة النتائج غير متاحة حاليًا. حاول لاحقًا.',503);
  const url=new URL(request.url),me=await player(request,db);
  if(request.method==='GET'){
   const action=url.searchParams.get('action');
   if(action==='me')return json({player:me?{name:me.name,tag:me.id.slice(0,4)}:null});
   if(action==='challenge'){const r=await room(db,url.searchParams.get('id'));return json({challenge:publicRoom(r),leaderboard:await board(db,r.id,me?.id||null)})}
   throw new ApiError(404,'الطلب غير موجود.');
  }
  check(request.method==='POST','طريقة الطلب غير مدعومة.',405);
  const origin=request.headers.get('origin');check(!origin||origin===url.origin,'هذا الطلب غير مسموح.',403);
  check(request.headers.get('sec-fetch-site')!=='cross-site','هذا الطلب غير مسموح.',403);
  check((request.headers.get('content-type')||'').includes('application/json'),'يلزم إرسال JSON.',415);
  check(Number(request.headers.get('content-length')||0)<=4096,'الطلب كبير جدًا.',413);
  const raw=await request.text();check(raw.length<=4096,'الطلب كبير جدًا.',413);let data:any;try{data=JSON.parse(raw)}catch{throw new ApiError(400,'الطلب غير صالح.')}
  check(data&&typeof data==='object'&&!Array.isArray(data),'الطلب غير صالح.');
  if(data.action==='session'){
   const name=label(data.name,24);
   if(me){await db.prepare('UPDATE players SET name=? WHERE id=?').bind(name,me.id).run();return json({player:{name,tag:me.id.slice(0,4)}})}
   const key=token(),id=crypto.randomUUID();await db.prepare('INSERT INTO players(id,token_hash,name,created_at) VALUES(?,?,?,?)').bind(id,await hash(key),name,now).run();
   return json({player:{name,tag:id.slice(0,4)}},200,{'Set-Cookie':cookieName+'='+key+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000'+(url.protocol==='https:'?'; Secure':'')});
  }
  check(me,'اكتب اسمك أولًا للانضمام.',401);
  if(data.action==='create'){
   const title=label(data.title||'تحدي الأصدقاء',50);check(['easy','normal','hard'].includes(data.difficulty),'اختر مستوى صعوبة صالحًا.');
   const recent=await db.prepare('SELECT COUNT(*) AS total FROM challenges WHERE creator_id=? AND created_at>?').bind(me.id,now-3600000).first<{total:number}>();check((recent?.total||0)<10,'أنشأت عدة تحديات مؤخرًا. حاول لاحقًا.',429);
   const id=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0];await db.prepare('INSERT INTO challenges(id,creator_id,title,difficulty,seed,created_at) VALUES(?,?,?,?,?,?)').bind(id,me.id,title,data.difficulty,seed,now).run();
   return json({challenge:publicRoom({id,title,difficulty:data.difficulty,seed,created_at:now})},201);
  }
  if(data.action==='start'){
   const r=await room(db,data.challengeId);
   const id=crypto.randomUUID();await db.batch([
    db.prepare("UPDATE runs SET status='abandoned',finished_at=? WHERE player_id=? AND status='active'").bind(now,me.id),
    db.prepare('INSERT INTO runs(id,player_id,challenge_id,started_at,status) VALUES(?,?,?,?,?)').bind(id,me.id,r.id,now,'active')]);
   return json({runId:id,challenge:publicRoom(r),startedAt:now},201);
  }
  if(data.action==='finish'){
   check(typeof data.runId==='string'&&uuid.test(data.runId),'المحاولة غير صالحة.');
   const r=await db.prepare('SELECT * FROM runs WHERE id=? AND player_id=?').bind(data.runId,me.id).first<any>();check(r,'لم نعثر على المحاولة.',404);
   const {score,sector,elapsedMs}=data;
   check(Number.isInteger(score)&&score>=0&&Number.isInteger(sector)&&sector>=1&&Number.isInteger(elapsedMs)&&elapsedMs>=0&&elapsedMs<=180100,'نتيجة غير صالحة.');
   if(r.status==='finished'){check(r.score===score&&r.sector===sector&&r.elapsed_ms===elapsedMs,'حُفظت هذه المحاولة بنتيجة أخرى.',409);return json({saved:true,leaderboard:await board(db,r.challenge_id,me.id)})}
   check(r.status==='active','المحاولة مغلقة؛ ابدأ محاولة جديدة.',409);
   check(now-r.started_at<=1800000,'انتهت مهلة حفظ المحاولة. ابدأ محاولة جديدة.',410);
   check(elapsedMs<=now-r.started_at+3000,'زمن المحاولة غير صالح.');
   check(score<=Math.ceil(elapsedMs/1000*500+1500)&&sector<=Math.floor(elapsedMs/1000*.2)+2,'النتيجة خارج حدود المحاولة.');
   await db.prepare("UPDATE runs SET score=?,sector=?,elapsed_ms=?,finished_at=?,status='finished' WHERE id=? AND player_id=? AND status='active'").bind(score,sector,elapsedMs,now,r.id,me.id).run();
   const saved=await db.prepare('SELECT status,score,sector,elapsed_ms FROM runs WHERE id=?').bind(r.id).first<any>();check(saved?.status==='finished'&&saved.score===score&&saved.sector===sector&&saved.elapsed_ms===elapsedMs,'تعارض أثناء حفظ النتيجة. أعد المحاولة.',409);
   return json({saved:true,leaderboard:await board(db,r.challenge_id,me.id)});
  }
  throw new ApiError(404,'الطلب غير موجود.');
 }catch(error){if(error instanceof ApiError)return json({error:error.message},error.status);console.error('Game API failed',error instanceof Error?error.message:'Unknown error');return json({error:'تعذّر الاتصال بلوحة النتائج. حاول مرة أخرى.'},500)}
}
