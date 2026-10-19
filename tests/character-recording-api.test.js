import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";

function wav() {
  const b=Buffer.alloc(44+32000);b.write("RIFF",0);b.writeUInt32LE(b.length-8,4);b.write("WAVEfmt ",8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write("data",36);b.writeUInt32LE(32000,40);return b;
}
test("角色参考录音先私有存OSS，再转文字；失败可重试且仅所有者播放", async t=>{
  const objects=new Map(),events=[];let failAsr=true;
  const {app,db}=await createApp({dbPath:":memory:",gmPassword:"test",npcPassword:"test",characterMedia:{enabled:true,bucket:"test-character-media",endpoint:"oss-cn-shanghai.aliyuncs.com",accessId:"private-id",secret:"private-secret",fetch:async(url,options)=>{
    if(options.method==="PUT"){events.push("stored");assert.equal(options.headers["x-oss-object-acl"],"private");objects.set(url,Buffer.from(options.body));return new Response("");}return new Response(objects.get(url),{status:objects.has(url)?200:404});
  }},characterTranscription:{apiKey:"private-asr-key",baseUrl:"https://minimax.example/v1",fetch:async(url,options)=>{
    events.push("asr");assert.ok(objects.size>0);assert.ok(options.body instanceof FormData);assert.equal(options.body.get("model"),"asr-1.0");assert.equal((await options.body.get("file").arrayBuffer()).byteLength,wav().length);
    return Response.json(failAsr?{base_resp:{status_code:1008,status_msg:"private-asr-key"}}:{text:"我想扮演一位神秘的庄园修复师，喜欢收集旧唱片。",duration:1});
  }}});
  const server=app.listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(async()=>{await new Promise(r=>server.close(r));await db.close();});
  for(const id of ["record-owner","other-owner"]){await db.prepare("INSERT INTO players(id,name,contact,password) VALUES(?,?,?,?)").run(id,id,id,"unused");await db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(id,"player",id,Date.now()+600000);}
  const request=(path,body,id="record-owner",headers={})=>fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",Cookie:`alaska_session=${id}`,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const response=await request("/character/reference-audio",{data:"data:audio/wav;base64,"+wav().toString("base64")});assert.equal(response.status,200);const saved=await response.json();
  assert.ok(saved.transcription_error);assert.ok(!JSON.stringify(saved).includes("private-"));assert.ok(saved.recording_url);assert.deepEqual(events,["stored","asr"]);
  const recovered=await (await request("/character/inspiration")).json();assert.equal(recovered.reference_recording.recording_id,saved.recording_id);assert.ok(recovered.reference_recording.transcription_error);assert.ok(!JSON.stringify(recovered).includes("object_key"));
  const row=await db.prepare("SELECT * FROM character_recordings WHERE id=?").get(saved.recording_id);assert.match(row.object_key,/^alsj\/characters\/v1\//);assert.equal(row.status,"error");
  assert.equal((await request(saved.recording_url.replace("/api",""),undefined,"other-owner")).status,404);
  const ranged=await request(saved.recording_url.replace("/api",""),undefined,"record-owner",{Range:"bytes=0-43"});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,44);
  failAsr=false;const retried=await(await request(`/character/reference-audio/${saved.recording_id}/transcribe`,{})).json();assert.ok(retried.transcript.includes("旧唱片"));assert.ok(!retried.transcription_error);assert.equal(objects.size,1);
  assert.equal((await request("/character/reference-audio",{data:"data:audio/wav;base64,"+Buffer.from("not audio").toString("base64")})).status,400);
});
