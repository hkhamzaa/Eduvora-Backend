// utils/neo4j.ts
import neo4j, { Driver } from "neo4j-driver";

let driver: Driver;

export const connectNeo4j = async () => {
  try {
    driver = neo4j.driver(
      process.env.NEO4J_URI as string,
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME as string,
        process.env.NEO4J_PASSWORD as string
      )
    );
    await driver.verifyConnectivity();
    console.log("Neo4j connected successfully");
  } catch (error) {
    console.error("Neo4j connection failed:", error);
    // Note: We do NOT crash the server — Neo4j is additive
    // The rest of your app keeps running even if Neo4j is down
  }
};

export const getNeo4jSession = () => {
  if (!driver) throw new Error("Neo4j driver not initialized");
  return driver.session();
};

export const closeNeo4j = async () => {
  if (driver) await driver.close();
};

export const isNeo4jReady = (): boolean => !!driver;