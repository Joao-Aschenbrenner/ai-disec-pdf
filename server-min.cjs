// Servidor mínimo
const express = require('express');
const path = require('path');

const app = express();
const distPath = path.join(__dirname, 'dist');

app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

console.log('Frontend deve estar em http://localhost:3001');
app.listen(3001);