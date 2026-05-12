// controllers/neo4j.controller.ts
import { Request, Response, NextFunction } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";  // your existing wrapper
import ErrorHandler from "../utils/ErrorHandler";                   // your existing error class
import {
  getRecommendedCourses,
  getLearningPath,
  getGraphStats,
  setPrerequisite,
  getEnrollmentGraph,
} from "../services/neo4j.service";
import CourseModel from "../models/course.model";

// GET /api/v1/neo4j/recommendations
export const getCourseRecommendations = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?._id?.toString();
    if (!userId) return next(new ErrorHandler("Not authenticated", 401));

    // Stable-ordered IDs from Neo4j
    const recommendedIds = await getRecommendedCourses(userId);

    if (recommendedIds.length === 0) {
      return res.status(200).json({ success: true, courses: [], source: "neo4j-graph" });
    }

    // Fetch full course details needed by CourseCard from MongoDB
    const rawCourses = await CourseModel.find({
      _id: { $in: recommendedIds },
    }).select(
      "-courseData.videoUrl -courseData.suggestion -courseData.questions -courseData.links"
    );

    // Re-sort to match Neo4j order (MongoDB $in does not preserve order)
    const courseMap = new Map(
      rawCourses.map((c: any) => [c._id.toString(), c])
    );
    const courses = recommendedIds
      .filter((id) => courseMap.has(id))
      .map((id) => courseMap.get(id));

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

// GET /api/v1/neo4j/enrollment-graph
export const getEnrollmentGraphData = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const edges = await getEnrollmentGraph();
    res.status(200).json({ success: true, enrollmentGraph: edges });
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