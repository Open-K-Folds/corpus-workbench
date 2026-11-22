'use strict';
const http = require('node:http');

// A single local llama-server with its already loaded model. Never follow redirects.
function queryModel(prompt, request = http.request) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({messages: [{role: 'user', content: prompt}], max_tokens: 384, temperature: 0.2, stream: false});
    const call = request({
      hostname: '127.0.0.1', port: 8080, path: '/v1/chat/completions', method: 'POST', agent: false,
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)},
    }, response => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error('The local model returned HTTP ' + response.statusCode + '. Check your llama-server.'));
        return;
      }
      let bytes = 0;
      const chunks = [];
      response.on('error', () => reject(new Error('The local model response was interrupted.')));
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) {
          reject(new Error('The model reply exceeded the response limit.'));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const model = json.model, reply = json.choices?.[0]?.message?.content;
          if (typeof model !== 'string' || !model.trim() || model.length > 256 ||
              typeof reply !== 'string' || !reply.trim() || reply.length > 8000) throw new Error();
          resolve({model, reply});
        } catch { reject(new Error('The local model returned an unreadable reply or model identity.')); }
      });
    });
    const timeout = setTimeout(() => { reject(new Error('The local model timed out.')); call.destroy(); }, 120000);
    call.once('close', () => clearTimeout(timeout));
    call.once('error', () => reject(new Error('Cannot reach llama-server on 127.0.0.1:8080. Start it with your local model, or paste a reply.')));
    call.end(payload);
  });
}
module.exports = {queryModel};
