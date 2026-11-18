export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const {
      taskTitle = "",
      lessonText = "",
      previousTasks = []
    } = req.body || {};

    if (
      typeof taskTitle !== "string" ||
      typeof lessonText !== "string" ||
      lessonText.trim().length < 150
    ) {
      return res.status(400).json({
        error: "Invalid task information."
      });
    }

    if (!Array.isArray(previousTasks)) {
      return res.status(400).json({
        error: "Invalid previous task records."
      });
    }

    if (previousTasks.length === 0) {
      return res.status(200).json({
        isDuplicate: false,
        reason: "No previous tasks to compare."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    const validPreviousTasks = previousTasks
      .filter(task =>
        task &&
        typeof task.title === "string" &&
        typeof task.lesson === "string"
      )
      .slice(-15)
      .map((task, index) => ({
        taskNumber: index + 1,
        title: task.title.slice(0, 300),
        lesson: task.lesson.slice(0, 5000)
      }));

    const prompt = `
You are the duplicate-task detection system for StudyQuest.

Your job is to identify students who repeatedly submit the same
learning task to gain duplicate rewards by changing its title.

CURRENT SUBMISSION:
Title: ${taskTitle.slice(0, 300)}

Lesson content:
${lessonText.slice(0, 12000)}

PREVIOUSLY ACCEPTED TASKS:
${JSON.stringify(validPreviousTasks)}

ANALYSIS RULES:

1. Compare the actual lesson content, concepts, learning objectives,
   and purpose of the current submission with previous submissions.

2. Do not rely only on the task title. Students may change titles
   to disguise repeated submissions.

3. If the student changes the title but submits substantially the
   same task with the same learning objective, classify it as a duplicate.

4. Reusing the same lesson material is NOT automatically a duplicate.
   A genuinely different learning objective or task purpose may be allowed.

5. Do not classify a task as different merely because its title
   contains extra words, numbers, or minor wording changes.

6. If the lesson content is substantially the same and the new title
   only disguises the previous task, classify it as a duplicate.

7. Be careful with false positives. If the task has a clearly
   different learning objective, allow it.

Return JSON only in this exact format:

{
  "isDuplicate": true,
  "reason": "Brief explanation."
}

The isDuplicate value must be either true or false.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Task duplicate detection error:", data);

      return res.status(503).json({
        error: "AI duplicate detection is temporarily unavailable. Please try again."
      });
    }

    const output =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!output) {
      throw new Error("Empty Gemini response.");
    }

    const result = JSON.parse(output);

    if (
      typeof result.isDuplicate !== "boolean" ||
      typeof result.reason !== "string"
    ) {
      throw new Error("Invalid duplicate detection response.");
    }

    return res.status(200).json({
      isDuplicate: result.isDuplicate,
      reason: result.reason
    });

  } catch (error) {
    console.error("Task detection error:", error);

    return res.status(500).json({
      error: "Unable to check this task. Please try again."
    });
  }
}
