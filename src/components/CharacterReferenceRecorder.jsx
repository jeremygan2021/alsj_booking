import React, { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "../api";
import { Button } from "./ui";
import { encodeCharacterRecording } from "../character-recording";

export default function CharacterReferenceRecorder({ disabled, value, onChange, onTranscript, onBusyChange }) {
  const [recording, setRecording] = useState(false), [starting,setStarting]=useState(false), [working, setWorking] = useState(false), [seconds,setSeconds]=useState(0), [error,setError]=useState("");
  const alive=useRef(true),resources=useRef(null), chunks=useRef([]), timer=useRef(null), audio=useRef(null), stopRef=useRef(null);
  const clean=()=>{clearInterval(timer.current); const r=resources.current;resources.current=null;
    if(r){r.processor.onaudioprocess=null;r.processor.disconnect();r.input.disconnect();r.silence.disconnect();r.stream.getTracks().forEach(track=>track.stop());r.context.close().catch(()=>{});}
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clean();audio.current?.pause();};},[]);
  useEffect(()=>{onBusyChange?.(recording||working||starting||value?.status === "transcribing");},[recording,working,starting,value?.status]);
  const recognize=async(blob)=>{
    setWorking(true);setError("");
    try {
      let result;
      if(!blob && value?.id) result=await api(`/character/reference-audio/${value.id}/transcribe`,{});
      else {
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("录音读取失败，请重新录制"));reader.readAsDataURL(blob);});
        result=await api("/character/reference-audio",{data});
      }
      onChange({id:result.recording_id,url:result.recording_url,transcript:result.transcript||"",status:result.status,error:result.transcription_error||""});
      if(result.transcript)onTranscript(result.transcript);
      if(result.transcription_error)setError(result.transcription_error);
    }catch(failure){setError(failure.message||"录音识别失败，请重试");}
    finally{setWorking(false);}
  };
  const stop=async()=>{
    const r=resources.current;if(!r)return;
    const rate=r.context.sampleRate;clean();setRecording(false);
    try {await recognize(encodeCharacterRecording(chunks.current,rate));}
    catch(failure){setError(failure.message);}
  };stopRef.current=stop;
  const start=async()=>{
    if(disabled||working||recording||starting)return;setError("");
    if(!navigator.mediaDevices?.getUserMedia || !(window.AudioContext||window.webkitAudioContext)){setError("当前浏览器不支持录音，请使用手机系统浏览器，或直接填写灵感。");return;}
    let stream,context;
    setStarting(true);
    try {
      context=new(window.AudioContext||window.webkitAudioContext)();await context.resume();
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true},video:false});
      if(!alive.current){stream.getTracks().forEach(track=>track.stop());await context.close();return;}
      const input=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1),silence=context.createGain();silence.gain.value=0;
      chunks.current=[];resources.current={stream,context,input,processor,silence};
      processor.onaudioprocess=event=>chunks.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      input.connect(processor);processor.connect(silence);silence.connect(context.destination);
      setRecording(true);setSeconds(0);const began=Date.now();
      timer.current=setInterval(()=>{const elapsed=Math.floor((Date.now()-began)/1000);setSeconds(elapsed);if(elapsed>=60)stopRef.current?.();},250);
    }catch {stream?.getTracks().forEach(track=>track.stop());context?.close().catch(()=>{});if(alive.current)setError("麦克风未开启，请在浏览器设置中允许录音，或直接填写灵感。");}
    finally{if(alive.current)setStarting(false);}
  };
  return <section className="character-reference" aria-label="语音角色灵感">
    <p className="muted">也可以说说想扮演的人物。最多录60秒，转成文字后可修改，再生成角色。</p>
    <Button kind="ghost compact" onClick={recording?stop:start} disabled={disabled||working||starting}>
      {recording?<Square size={16}/>:<Mic size={16}/>} {recording?`停止并转文字 · ${seconds}秒`:working?"正在保存录音并转文字…":starting?"正在开启麦克风…":"录下角色灵感"}
    </Button>
    {recording&&<p role="status">正在录音，最长60秒。</p>}
    {!recording&&!working&&value?.status === "transcribing"&&<p role="status">录音已保存，正在转成文字…</p>}
    {value?.url&&<audio ref={audio} controls preload="none" src={value.url} aria-label="试听角色灵感录音"/>}
    {(error||value?.error)&&<p className="form-error" role="alert">{error||value.error}</p>}
    {(error||value?.error)&&value?.id&&!recording&&!working&&<Button kind="ghost compact" onClick={()=>recognize()} disabled={disabled}>重试识别录音</Button>}
  </section>;
}
