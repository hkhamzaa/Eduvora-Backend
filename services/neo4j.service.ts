// services/neo4j.service.ts
import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../utils/neo4j";
import UserModel from "../models/user.model";
import CourseModel from "../models/course.model";
import OrderModel from "../models/order.Model";

// ─────────────────────────────────────────────
// Called when a user enrolls in a course
// ─────────────────────────────────────────────
export const createEnrollmentRelation = async (
  userId: string,
  courseId: string,
  courseName: string,
  userEmail: string,
) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MERGE (u:User {id: $userId})
      SET u.email = $userEmail
      MERGE (c:Course {id: $courseId})
      SET c.name = $courseName
      MERGE (u)-[r:ENROLLED_IN]->(c)
      SET r.enrolledAt = datetime()
      `,
      { userId, courseId, courseName, userEmail },
    );
  } catch (err) {
    console.error("Neo4j createEnrollmentRelation error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Called when a course is created
// ─────────────────────────────────────────────
export const createCourseNode = async (
  courseId: string,
  courseName: string,
  category: string,
  level: string,
) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MERGE (c:Course {id: $courseId})
      SET c.name = $courseName, c.category = $category, c.level = $level
      MERGE (cat:Category {name: $category})
      MERGE (c)-[:BELONGS_TO]->(cat)
      `,
      { courseId, courseName, category, level },
    );
  } catch (err) {
    console.error("Neo4j createCourseNode error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Called when a course is edited
// ─────────────────────────────────────────────
export const updateCourseNode = async (
  courseId: string,
  courseName: string,
  category: string,
  level: string,
) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MERGE (c:Course {id: $courseId})
      SET c.name = $courseName, c.category = $category, c.level = $level
      MERGE (cat:Category {name: $category})
      MERGE (c)-[:BELONGS_TO]->(cat)
      `,
      { courseId, courseName, category, level },
    );
  } catch (err) {
    console.error("Neo4j updateCourseNode error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Called when a course is deleted
// DETACH DELETE removes the node AND all its
// relationships (enrollments, prerequisites)
// ─────────────────────────────────────────────
export const deleteCourseNode = async (courseId: string) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MATCH (c:Course {id: $courseId})
      DETACH DELETE c
      `,
      { courseId },
    );
  } catch (err) {
    console.error("Neo4j deleteCourseNode error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Called when a user completes a course
// ─────────────────────────────────────────────
export const markCourseCompleted = async (userId: string, courseId: string) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MATCH (u:User {id: $userId})-[r:ENROLLED_IN]->(c:Course {id: $courseId})
      SET r.completed = true, r.completedAt = datetime()
      `,
      { userId, courseId },
    );
  } catch (err) {
    console.error("Neo4j markCourseCompleted error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Get recommended courses — stable deterministic
// order (sorted by course id so the order never
// changes between page loads unless new courses
// are added). userId is kept for future
// collaborative-filtering upgrade.
// ─────────────────────────────────────────────
export const getRecommendedCourses = async (
  _userId: string,
): Promise<string[]> => {
  const session = getNeo4jSession();
  try {
    const countResult = await session.run(
      `MATCH (c:Course) RETURN COUNT(c) AS total`,
    );
    const totalCourses = countResult.records[0].get("total").toNumber();
    const limit = Math.max(1, Math.round(totalCourses * 0.3));

    const result = await session.run(
      `
      MATCH (c:Course)
      RETURN c.id AS courseId
      LIMIT $limit
      `,
      { limit: neo4j.int(limit) },
    );
    const ids = result.records.map((r) => r.get("courseId"));

    const mongoCourses = await CourseModel.find(
      { _id: { $in: ids } },
      { purchased: 1 },
    ).lean();
    mongoCourses.sort((a: any, b: any) => (b.purchased ?? 0) - (a.purchased ?? 0));
    return mongoCourses.map((c: any) => c._id.toString());
  } catch (err) {
    console.error("Neo4j getRecommendedCourses error:", err);
    return [];
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Set prerequisite relationship between courses
// ─────────────────────────────────────────────
export const setPrerequisite = async (
  courseId: string,
  prerequisiteCourseId: string,
) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MATCH (c:Course {id: $courseId})
      MATCH (pre:Course {id: $prerequisiteCourseId})
      MERGE (pre)-[:IS_PREREQUISITE_OF]->(c)
      `,
      { courseId, prerequisiteCourseId },
    );
  } catch (err) {
    console.error("Neo4j setPrerequisite error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Get learning path for a course (all prerequisites)
// ─────────────────────────────────────────────
export const getLearningPath = async (courseId: string) => {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `
      MATCH path = (start:Course)-[:IS_PREREQUISITE_OF*]->(target:Course {id: $courseId})
      RETURN [node IN nodes(path) | {id: node.id, name: node.name}] AS learningPath
      ORDER BY length(path) ASC
      LIMIT 1
      `,
      { courseId },
    );
    if (result.records.length === 0) return [];
    return result.records[0].get("learningPath");
  } catch (err) {
    console.error("Neo4j getLearningPath error:", err);
    return [];
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Get graph stats (for analytics / admin panel)
// ─────────────────────────────────────────────
export const getGraphStats = async () => {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `
      MATCH (u:User) WITH COUNT(u) AS totalUsers
      MATCH (c:Course) WITH totalUsers, COUNT(c) AS totalCourses
      OPTIONAL MATCH ()-[r:ENROLLED_IN]->()
      RETURN totalUsers, totalCourses, COUNT(r) AS totalEnrollments
      `,
    );
    const record = result.records[0];
    return {
      totalUsers: record.get("totalUsers").toNumber(),
      totalCourses: record.get("totalCourses").toNumber(),
      totalEnrollments: record.get("totalEnrollments").toNumber(),
    };
  } catch (err) {
    console.error("Neo4j getGraphStats error:", err);
    return null;
  } finally {
    await session.close();
  }
};
export const createUserNode = async (userId: string, email: string) => {
  const session = getNeo4jSession();
  try {
    await session.run(
      `
      MERGE (u:User {id: $userId})
      SET u.email = $email
      `,
      { userId, email },
    );
  } catch (err) {
    console.error("Neo4j createUserNode error:", err);
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Full sync: wipe Neo4j and rebuild from MongoDB.
// Source of truth for enrollments is the Order
// collection — NOT user.courses.
// ─────────────────────────────────────────────
export const syncAllToNeo4j = async (): Promise<void> => {
  const session = getNeo4jSession();
  try {
    // 1. Wipe everything
    await session.run("MATCH (n) DETACH DELETE n");

    // 2. Rebuild User nodes (id only as MERGE key)
    const users = await UserModel.find({}, "_id email").lean();
    for (const user of users) {
      await session.run(
        `MERGE (u:User {id: $userId}) SET u.email = $email`,
        { userId: user._id.toString(), email: user.email }
      );
    }

    // 3. Rebuild Course nodes + Category nodes + BELONGS_TO
    const courses = await CourseModel.find({}, "_id name categories level").lean();
    for (const course of courses) {
      await session.run(
        `
        MERGE (c:Course {id: $courseId})
        SET c.name = $name, c.category = $category, c.level = $level
        MERGE (cat:Category {name: $category})
        MERGE (c)-[:BELONGS_TO]->(cat)
        `,
        {
          courseId: course._id.toString(),
          name: course.name,
          category: (course as any).categories ?? "General",
          level: course.level ?? "Beginner",
        }
      );
    }

    // 4. Rebuild ENROLLED_IN from Orders only
    const orders = await OrderModel.find({}, "userId courseId").lean();
    for (const order of orders) {
      if (!order.userId || !order.courseId) continue;
      await session.run(
        `
        MATCH (u:User   {id: $userId})
        MATCH (c:Course {id: $courseId})
        MERGE (u)-[r:ENROLLED_IN]->(c)
        SET r.enrolledAt = coalesce(r.enrolledAt, datetime())
        `,
        { userId: order.userId.toString(), courseId: order.courseId.toString() }
      );
    }

    console.log(
      `Neo4j sync complete — ${users.length} users, ${courses.length} courses, ${orders.length} enrollments`
    );
  } catch (err) {
    console.error("Neo4j syncAllToNeo4j error:", err);
    throw err;
  } finally {
    await session.close();
  }
};

// ─────────────────────────────────────────────
// Return all User→Course enrollment edges for
// the admin dashboard live graph.
// ─────────────────────────────────────────────
export interface EnrollmentEdge {
  userId: string;
  userEmail: string;
  courseId: string;
  courseName: string;
}

export const getEnrollmentGraph = async (): Promise<EnrollmentEdge[]> => {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `
      MATCH (u:User)-[:ENROLLED_IN]->(c:Course)
      RETURN u.id       AS userId,
             u.email    AS userEmail,
             c.id       AS courseId,
             c.name     AS courseName
      ORDER BY c.name
      `
    );
    return result.records.map((r) => ({
      userId:     r.get("userId"),
      userEmail:  r.get("userEmail"),
      courseId:   r.get("courseId"),
      courseName: r.get("courseName"),
    }));
  } catch (err) {
    console.error("Neo4j getEnrollmentGraph error:", err);
    return [];
  } finally {
    await session.close();
  }
};
