// Servidor mínimo para testar carregamento do frontend
const express = require('express');
const path = require('path');

const app = express();
const port = 3001;
const distPath = path.join(__dirname, 'dist');

// Serve static files
app.use(express.static(distPath));

// All other routes serve the frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor mínimo rodando em http://localhost:${port}`);
});