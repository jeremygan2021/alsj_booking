// Browser recordings use a portable, bounded PCM WAV instead of device-specific containers.
export function encodeCharacterRecording(chunks, inputRate) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const source = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { source.set(chunk, offset); offset += chunk.length; }
  const rate = 16000, samples = Math.min(rate * 60, Math.floor(length * rate / inputRate));
  if (samples < rate / 2) throw new Error("录音太短，请至少录半秒后再试。");
  const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
  const text = (at, value) => { for (let i=0;i<value.length;i++) view.setUint8(at+i,value.charCodeAt(i)); };
  text(0,"RIFF");view.setUint32(4,36+samples*2,true);text(8,"WAVE");text(12,"fmt ");view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,samples*2,true);
  for(let i=0;i<samples;i++) {
    const begin=Math.floor(i*inputRate/rate), end=Math.max(begin+1,Math.floor((i+1)*inputRate/rate));
    let sum=0;for(let j=begin;j<Math.min(end,source.length);j++)sum+=source[j];
    const value=Math.max(-1,Math.min(1,sum/(end-begin)));
    view.setInt16(44+i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return new Blob([buffer],{type:"audio/wav"});
}
