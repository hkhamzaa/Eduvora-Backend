// services/neo4j.service.ts
import { getNeo4jSession } from "../utils/neo4j";

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
      MERGE (u:User {id: $userId, email: $userEmail})
      MERGE (c:Course {id: $courseId, name: $courseName})
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
// Get course recommendations for a user
// Collaborative filtering: "users like you also took..."
// ─────────────────────────────────────────────
export const getRecommendedCourses = async (
  userId: string,
): Promise<string[]> => {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `
      MATCH (u:User {id: $userId})-[:ENROLLED_IN]->(c:Course)
            <-[:ENROLLED_IN]-(similar:User)-[:ENROLLED_IN]->(rec:Course)
      WHERE NOT (u)-[:ENROLLED_IN]->(rec)
        AND u.id <> similar.id
      RETURN rec.id AS courseId, rec.name AS courseName, COUNT(*) AS score
      ORDER BY score DESC
      LIMIT 6
      `,
      { userId },
    );
    return result.records.map((r) => r.get("courseId"));
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
