import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sendStoredAsset, ossReadHeaders } from '../server/asset-storage.js';

const file = new URL('../server/audio/files/e-01-body.mp3', import.meta.url).pathname;
const data = await readFile(file);
const sha = createHash('sha256').update(data).digest('hex');
const env = { OSS_ENABLED: 'true', OSS_ACCESS_KEY_ID: 'test', OSS_ACCESS_KEY_SECRET: 'test-secret' };
const manifest = { bucket: 'test-assets', endpoint: 'oss-cn-shanghai.aliyuncs.com', assets: { 'server/audio/files/e-01-body.mp3': {key: `alsj/assets/v1/${sha}.mp3`, sha256: sha, bytes: data.length} } };

test('OSS signing binds method, time, bucket and exact object', () => {
 const date = 'Sun, 18 Oct 2026 00:00:00 GMT';
 const result = ossReadHeaders({accessId:'test',secret:'secret',bucket:'bucket',key:'a/b.mp3',date,method:'HEAD'});
 assert.equal(result.Authorization, `OSS test:${createHmac('sha1','secret').update(`HEAD\n\n\n${date}\n/bucket/a/b.mp3`).digest('base64')}`);
});

test('private OSS streaming preserves authorization, seeking and local fallback', async t => {
 const app = express(); let calls = 0; let mode = 'success';
 app.get('/asset', async (req,res) => {
  if (req.headers['x-test-auth'] !== 'yes') return res.sendStatus(401);
  res.set({'Content-Type':'audio/mpeg','Cache-Control':'private, no-store'});
  return sendStoredAsset(res,file,{env,manifest,fetcher: async (url, options) => {
   calls++; assert.equal(new URL(url).host,'test-assets.oss-cn-shanghai.aliyuncs.com');
   assert.ok(options.headers.Authorization.startsWith('OSS test:'));
   if (mode === 'fail') throw new Error('unavailable');
   if (options.method === 'HEAD') return new Response(null,{headers:{'content-length':String(data.length)}});
   if (options.headers.range) return new Response(data.subarray(0,16),{status:206,headers:{'content-range':`bytes 0-15/${data.length}`,'content-length':'16','accept-ranges':'bytes'}});
   return new Response(data,{headers:{'content-length':String(data.length)}});
  }});
 });
 const server = app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 t.after(()=>server.close()); const url=`http://127.0.0.1:${server.address().port}/asset`;
 assert.equal((await fetch(url)).status,401); assert.equal(calls,0);
 const headers = {'x-test-auth':'yes'};
 let response = await fetch(url,{headers}); assert.equal(response.headers.get('x-asset-storage'),'oss'); assert.equal(response.headers.get('cache-control'),'private, no-store'); assert.deepEqual(Buffer.from(await response.arrayBuffer()),data);
 response = await fetch(url,{headers:{...headers,range:'bytes=0-15'}}); assert.equal(response.status,206); assert.equal((await response.arrayBuffer()).byteLength,16);
 response = await fetch(url,{method:'HEAD',headers}); assert.equal(response.headers.get('x-asset-storage'),'oss'); assert.equal(response.headers.get('content-length'),String(data.length));
 mode='fail'; response=await fetch(url,{headers}); assert.equal(response.headers.get('x-asset-storage'),'local'); assert.deepEqual(Buffer.from(await response.arrayBuffer()),data);
});

test('direct downloads authorize before redirect and never fetch media through the app', async t => {
 const app=express();let calls=0;
 app.get('/asset',async(req,res)=>{
  if(req.headers['x-test-auth']!=='yes')return res.sendStatus(401);
  return sendStoredAsset(res,file,{env:{...env,OSS_DIRECT_DOWNLOAD:'true'},manifest,fetcher:async()=>{calls++;throw new Error('must not fetch');}});
 });
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const url=`http://127.0.0.1:${server.address().port}/asset`;
 let response=await fetch(url,{redirect:'manual'});assert.equal(response.status,401);assert.equal(response.headers.get('location'),null);
 for(const method of ['GET','HEAD']){
  response=await fetch(url,{method,headers:{'x-test-auth':'yes',Range:'bytes=0-15'},redirect:'manual'});
  assert.equal(response.status,307);assert.equal(response.headers.get('x-asset-storage'),'oss-direct');assert.equal(response.headers.get('cache-control'),'private, no-store');
  const target=new URL(response.headers.get('location'));assert.equal(target.host,'test-assets.oss-cn-shanghai.aliyuncs.com');
  const expires=Number(target.searchParams.get('Expires'));assert.ok(expires>Date.now()/1000+604700&&expires<=Date.now()/1000+604800);
  assert.equal(target.searchParams.get('Signature'),createHmac('sha1',env.OSS_ACCESS_KEY_SECRET).update(`${method}\n\n\n${expires}\n/${manifest.bucket}/${manifest.assets['server/audio/files/e-01-body.mp3'].key}`).digest('base64'));
  assert.ok(!target.href.includes(env.OSS_ACCESS_KEY_SECRET));
 }
 assert.equal(calls,0);
});
