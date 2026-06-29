#!/usr/bin/env node

import { startWebServer } from "../src/web-server.mjs";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : undefined;

startWebServer({ port });
