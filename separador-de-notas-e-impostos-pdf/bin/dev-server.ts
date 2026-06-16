import { startServer } from "../server.js";

const isDev = process.env.NODE_ENV !== "production";
startServer(3000, isDev);
