import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
import {createOssDownloadUrl} from '../server/oss-download.js';

test('signed downloads reject arbitrary domains, keys and write methods',()=>{
 const base={bucket:'test-assets',endpoint:'oss-cn-shanghai.aliyuncs.com',accessId:'test',secret:'secret',key:`alsj/assets/v1/${'a'.repeat(64)}.mp3`};
 for(const patch of [{endpoint:'example.com'},{key:'../secret'},{method:'PUT'},{key:'alsj/characters/v1/bad/intro/a.mp3'}])assert.throws(()=>createOssDownloadUrl({...base,...patch}));
});

test('permanent media endpoints authorize ownership and revision before direct redirects',async t=>{
 let reads=0;
 const {app,db}=await createApp({dbPath:':memory:',gmPassword:'test',npcPassword:'test',characterMedia:{enabled:true,directDownload:true,bucket:'test-assets',endpoint:'oss-cn-shanghai.aliyuncs.com',accessId:'id',secret:'secret',fetch:async()=>{reads++;throw new Error('media must bypass app');}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
 for(const id of ['owner','other']){
  await db.prepare('INSERT INTO players(id,name,contact,password) VALUES(?,?,?,?)').run(id,id,id,'unused');
  await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(id,'player',id,Date.now()+600000);
 }
 await db.prepare("INSERT INTO characters(player_id,revision) VALUES('owner',1)").run();
 const owner='a'.repeat(64),hash='b'.repeat(64);
 await db.prepare("INSERT INTO character_recordings(id,player_id,object_key,content_type,status,created_at) VALUES('record','owner',?,'audio/wav','ready',?)").run(`alsj/characters/v1/${owner}/recording/${hash}.wav`,Date.now());
 await db.prepare("INSERT INTO character_voices(player_id,character_revision,job_token,status,audio_object_key,created_at,updated_at) VALUES('owner',1,'test','ready',?,?,?)").run(`alsj/characters/v1/${owner}/intro/${hash}.mp3`,Date.now(),Date.now());
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/api/character/reference-audio/record/audio','/api/character/voice/audio']){
  for(const [id,status] of [['',401],['other',404],['owner',307]]){
   const r=await fetch(base+path,{headers:id?{Cookie:`alaska_session=${id}`}:{},redirect:'manual'});assert.equal(r.status,status);
   if(status===307){assert.equal(new URL(r.headers.get('location')).host,'test-assets.oss-cn-shanghai.aliyuncs.com');assert.equal(r.headers.get('cache-control'),'private, no-store');}
   else assert.equal(r.headers.get('location'),null);
  }
 }
 await db.prepare("UPDATE characters SET revision=2 WHERE player_id='owner'").run();
 assert.equal((await fetch(base+'/api/character/voice/audio',{headers:{Cookie:'alaska_session=owner'},redirect:'manual'})).status,404);
 assert.equal(reads,0);
});
