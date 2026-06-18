// Teste de carregamento Node.js
console.log("🟢 Servidor iniciando...")

const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`📝 Requisição recebida: ${req.url}`);
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end("<h1>Servidor mínimo funcionando</h1>");
});

server.listen(3001, () => {
  console.log("🟢 Servidor rodando em http://localhost:3001");
});