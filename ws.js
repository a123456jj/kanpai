// ============================================================
// 零依赖的 WebSocket 实现（服务端）
// 只用 Node 自带的 http + crypto
// ============================================================

const crypto = require("crypto");

const MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + MAGIC).digest("base64");
}

// 解析客户端发来的帧（客户端→服务端：必须带掩码）
function decodeFrames(buf) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset];
    const b1 = buf[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = offset + 2;
    if (len === 126) {
      if (p + 2 > buf.length) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buf.length) break;
      const hi = buf.readUInt32BE(p);
      const lo = buf.readUInt32BE(p + 4);
      len = hi * 4294967296 + lo;
      p += 8;
    }
    let mask = null;
    if (masked) {
      if (p + 4 > buf.length) break;
      mask = buf.slice(p, p + 4);
      p += 4;
    }
    if (p + len > buf.length) break;
    const payload = Buffer.from(buf.slice(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    offset = p + len;

    if (opcode === 0x8) { messages.push({ type: "close" }); continue; }
    if (opcode === 0x9) { messages.push({ type: "ping", data: payload }); continue; }
    if (opcode === 0xa) { messages.push({ type: "pong" }); continue; }
    if (opcode === 0x1) {
      messages.push({ type: "text", data: payload.toString("utf8") });
      continue;
    }
    if (opcode === 0x0) {
      messages.push({ type: "text", data: payload.toString("utf8") });
    }
  }
  return { messages, rest: buf.slice(offset) };
}

// 生成服务端→客户端的帧（不带掩码）
function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

// 把一个 socket 变成 WebSocket 连接
function upgradeSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return null; }

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
  );

  const conn = {
    socket,
    alive: true,
    onMessage: null,
    onClose: null,
    buffer: Buffer.alloc(0),
  };

  socket.on("data", (chunk) => {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    const { messages, rest } = decodeFrames(conn.buffer);
    conn.buffer = rest;
    for (const m of messages) {
      if (m.type === "close") { conn.close(); return; }
      if (m.type === "ping") { socket.write(encodeFrame(m.data.toString("utf8"), 0xa)); continue; }
      if (m.type === "text") {
        if (conn.onMessage) conn.onMessage(m.data);
      }
    }
  });

  socket.on("close", () => { conn.alive = false; if (conn.onClose) conn.onClose(); });
  socket.on("error", () => { conn.alive = false; if (conn.onClose) conn.onClose(); });

  conn.send = (obj) => {
    if (!conn.alive) return;
    try { socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { }
  };
  conn.close = () => {
    if (!conn.alive) return;
    conn.alive = false;
    try { socket.write(encodeFrame("", 0x8)); socket.end(); } catch (e) { }
    if (conn.onClose) conn.onClose();
  };

  return conn;
}

module.exports = { upgradeSocket, encodeFrame, decodeFrames };
