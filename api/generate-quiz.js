
export default async function handler(req, res) {
  // Allow requests from your StudyQuest website
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { lessonText, taskTitle } = req.body || {};

    if (!lessonText || lessonText.trim().length < 150) {
      return res.status(400).json({
        error: "Please provide enough lesson content."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    const prompt = `
Create exactly 10 multiple-choice questions based ONLY on the lesson below.

Task title: ${taskTitle || "Study Lesson"}

Requirements:
- Each question must have exactly 4 options.
- Only one correct answer per question.
- Make questions clear and student-friendly.
- Include a short explanation for each answer.
- Return valid JSON only.

Required JSON format:
{
  "questions": [
    {
      "question": "Question here?",
      "options": ["A", "B", "C", "D"],
      "answerIndex": 0,
      "explanation": "Explanation here."
    }
  ]
}

Lesson:
${lessonText.slice(0, 30000)}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
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
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(502).json({
        error: "Gemini could not generate the quiz."
      });
    }

    const output = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!output) {
      throw new Error("Empty Gemini response.");
    }

    const parsed = JSON.parse(output);

    if (!Array.isArray(parsed.questions) ||
        parsed.questions.length !== 10 ||
        !parsed.questions.every(q =>
          typeof q.question === "string" &&
          Array.isArray(q.options) &&
          q.options.length === 4 &&
          Number.isInteger(q.answerIndex) &&
          q.answerIndex >= 0 &&
          q.answerIndex <= 3
        )) {
      throw new Error("Invalid quiz format.");
    }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Unable to generate the quiz. Please try again."
    });
  }
}
