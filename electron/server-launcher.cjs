const path = require("path");
const dotenv = require("dotenv");

// Carrega o .env do diretório da aplicação
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Define as variáveis de ambiente padrão
process.env.NODE_ENV = "production";

// Requer o servidor compilado (auto-executa)
require(path.join(__dirname, "..", "dist", "server.cjs"));
