// routes/neo4j.route.ts
import express from "express";
import { isAutheticated } from "../middleware/auth";
import {
  getCourseRecommendations,
  getCourseLearningPath,
  getGraphAnalytics,
  addCoursePrerequisite,
  getEnrollmentGraphData,
} from "../controllers/neo4j.controller";

const neo4jRouter = express.Router();

neo4jRouter.get("/recommendations", isAutheticated, getCourseRecommendations);
neo4jRouter.get("/learning-path/:courseId", getCourseLearningPath);
neo4jRouter.get("/graph-stats", getGraphAnalytics);
neo4jRouter.get("/enrollment-graph", getEnrollmentGraphData);
neo4jRouter.post("/prerequisite", isAutheticated, addCoursePrerequisite);

export default neo4jRouter;
