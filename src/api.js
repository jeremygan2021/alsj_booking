export async function api(path, body) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "请求失败");
  return data;
}

export async function inspireCharacter(body, onProgress) {
  const response = await fetch("/api/character/inspire", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "", result;
  const consume = (block) => {
    const line = block.split("\n").find((value) => value.startsWith("data:"));
    if (!line) return;
    const event = JSON.parse(line.slice(5));
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "complete") result = { ...event.character, ...(event.avatar_error ? { avatar_error: event.avatar_error } : {}) };
    else onProgress(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const blocks = pending.replace(/\r\n/g, "\n").split("\n\n");
      pending = blocks.pop();
      for (const block of blocks) consume(block);
      if (done) break;
    }
    if (pending.trim()) consume(pending);
    if (!result) throw new Error("生成连接中断，原有草稿已保留，请重试。");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
