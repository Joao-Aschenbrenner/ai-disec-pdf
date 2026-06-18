import { startServer } from "../server.js";
import dotenv from "dotenv";

dotenv.config();

const isDev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3001", 10);
startServer(port, isDev);
