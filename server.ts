import { v2 as cloudinary } from "cloudinary";
import http from "http";
import mongoose from "mongoose";
import connectDB from "./utils/db";
import { initSocketServer } from "./socketServer";
import { app } from "./app";
import { connectNeo4j, isNeo4jReady } from "./utils/neo4j";
import { syncAllToNeo4j } from "./services/neo4j.service";
require("dotenv").config();

const server = http.createServer(app);

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_SECRET_KEY,
});

initSocketServer(server);

server.listen(process.env.PORT, async () => {
  console.log(`Server is connected with port ${process.env.PORT}`);

  // Neo4j must be ready before the sync can run
  await connectNeo4j();

  // Register listener BEFORE connectDB fires so the 'open' event is never missed
  mongoose.connection.once("open", async () => {
    if (!isNeo4jReady()) {
      console.warn("Neo4j not available — skipping startup sync");
      return;
    }
    try {
      await syncAllToNeo4j();
    } catch {
      console.error("Startup Neo4j sync failed — server continues");
    }
  });

  connectDB(); // has internal retry loop; triggers 'open' when MongoDB connects
});
