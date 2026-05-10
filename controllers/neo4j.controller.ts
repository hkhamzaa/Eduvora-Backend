// controllers/neo4j.controller.ts
import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";  // your existing wrapper
import ErrorHandler from "../utils/ErrorHandler";                   // your existing error class
import {
  getRecommendedCourses,
  getLearningPath,
  getGraphStats,
  setPrerequisite
} from "../services/neo4j.service";
import CourseModel from "../models/course.model";

// GET /api/v1/neo4j/recommendations
export const getCourseRecommendations = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?._id?.toString();
    if (!userId) return next(new ErrorHandler("Not authenticated", 401));

    // Get recommended course IDs from Neo4j
    const recommendedIds = await getRecommendedCourses(userId);

    // Fetch full course documents from MongoDB using those IDs
    const courses = await CourseModel.find({
      _id: { $in: recommendedIds },
    }).select("name thumbnail description ratings purchased price");

    res.status(200).json({
      success: true,
      courses,
      source: "neo4j-graph",
    });
  }
);

// GET /api/v1/neo4j/learning-path/:courseId
export const getCourseLearningPath = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { courseId } = req.params;
    const path = await getLearningPath(courseId);

    res.status(200).json({
      success: true,
      learningPath: path,
    });
  }
);

// GET /api/v1/neo4j/graph-stats  (admin)
export const getGraphAnalytics = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const stats = await getGraphStats();
    res.status(200).json({
      success: true,
      graphStats: stats,
    });
  }
);

// POST /api/v1/neo4j/prerequisite  (admin)
// body: { courseId, prerequisiteCourseId }
export const addCoursePrerequisite = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { courseId, prerequisiteCourseId } = req.body;
    if (!courseId || !prerequisiteCourseId) {
      return next(new ErrorHandler("Both courseId and prerequisiteCourseId are required", 400));
    }
    await setPrerequisite(courseId, prerequisiteCourseId);
    res.status(200).json({
      success: true,
      message: "Prerequisite relationship created in graph",
    });
  }
);