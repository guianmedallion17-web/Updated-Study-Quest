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
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }

    const {
      question,
      userAnswer,
      correctAnswer,
      explanation
    } = req.body || {};

    if (
      typeof question !== "string" ||
      typeof userAnswer !== "string" ||
      typeof correctAnswer !== "string" ||
      typeof explanation !== "string" ||
      !question.trim() ||
      !userAnswer.trim() ||
      !correctAnswer.trim() ||
      question.length > 2000 ||
      userAnswer.length > 1000 ||
      correctAnswer.length > 1000 ||
      explanation.length > 2000
    ) {
      return res.status(400).json({
        error: "Invalid answer evaluation request."
      });
    }

    const prompt = `
You are evaluating a student's answer to a study question.

QUESTION:
${question}

STUDENT'S ANSWER:
${userAnswer}

EXPECTED ANSWER:
${correctAnswer}

EXPLANATION:
${explanation}

Your task is to determine whether the student's answer is
factually correct and has the same essential meaning as
the expected answer.

EVALUATION RULES:
1. Accept reasonable paraphrases and different wording
   when they express the same correct meaning.
2. Accept equivalent names, abbreviations, units, and
   expressions when they are factually equivalent in context.
3. Ignore harmless differences in capitalization,
   punctuation, spacing, and grammar.
4. Accept additional explanatory wording when it does
   not make the answer incorrect.
5. Do not require the student to use the exact wording
   of the expected answer.
6. Reject answers that are incomplete when an essential
   part of the answer is missing.
7. Reject answers that are related to the topic but
   communicate a different fact or meaning.
8. Do not accept an answer merely because it contains
   some of the correct keywords.
9. Use the question and explanation to understand context.
10. If the answer is ambiguous or you cannot confidently
    establish equivalence, mark it incorrect.

Return JSON only in this exact format:
{
  "correct": true,
  "reason": "Brief explanation"
}

The correct field must be a boolean.
The reason must be short and student-friendly.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
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
      console.error("Answer evaluation error:", data);

      return res.status(502).json({
        error: "Unable to evaluate the answer right now."
      });
    }

    const output =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!output) {
      throw new Error("Empty evaluation response.");
    }

    const result = JSON.parse(output);

    if (typeof result.correct !== "boolean") {
      throw new Error("Invalid evaluation result.");
    }

    return res.status(200).json({
      correct: result.correct,
      reason:
        typeof result.reason === "string"
          ? result.reason.slice(0, 250)
          : ""
    });

  } catch (error) {
    console.error("Arena answer evaluation error:", error);

    return res.status(500).json({
      error: "Unable to evaluate the answer. Please try again."
    });
  }
}
