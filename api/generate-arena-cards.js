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
  sourceMode = "all",
  materials = [],
  topic = "",
  difficulty = "medium",
  previousQuestions = []
} = req.body || {};

    const validMaterials = Array.isArray(materials)
      ? materials
          .filter(m =>
            m &&
            typeof m.title === "string" &&
            typeof m.content === "string"
          )
          .slice(0, 20)
      : [];

    const lessonContent = validMaterials.map((m, i) => `
FILE ${i + 1}: ${m.title}
${m.content.slice(0, 12000)}
`).join("\n\n");

    const history = Array.isArray(previousQuestions)
      ? previousQuestions
          .filter(q => typeof q === "string")
          .slice(-200)
      : [];
const prompt = `
    SOURCE INSTRUCTIONS:
${sourceMode === "files"
  ? "- Generate all 10 questions using ONLY the uploaded study materials."
  : sourceMode === "general"
  ? "- Generate all 10 questions using general knowledge. Do not use uploaded materials or custom topics."
  : sourceMode === "custom"
  ? `- Generate all 10 questions about this topic: ${topic}.`
  : `- Create a balanced mix of questions from uploaded materials, general knowledge, and the custom topic when provided.
- Distribute questions as evenly as possible among the available sources.
- Custom topic: ${topic || "None provided."}`
}

QUESTION REQUIREMENTS:
- Generate exactly 10 unique study flashcards.
- Use only the sources allowed by the selected source mode.
DIFFICULTY INSTRUCTIONS:
${difficulty === "easy"
  ? `- All 10 questions must be multiple-choice.
- Each question must have exactly 4 options.
- Include only 1 correct answer.`
  : difficulty === "hard"
  ? `- All 10 questions must require students to type their own answers.
- Do not provide answer choices or hints.`
  : `- Generate exactly 5 multiple-choice questions and 5 questions requiring typed answers.
- Each multiple-choice question must have exactly 4 options.
- Include only 1 correct answer per multiple-choice question.`
}

UPLOADED STUDY MATERIALS:
${sourceMode === "general" || sourceMode === "custom"
  ? "Do not use uploaded study materials."
  : lessonContent || "No study materials have been uploaded."
}

CUSTOM TOPIC:
${sourceMode === "custom" || sourceMode === "all"
  ? topic || "No custom topic provided."
  : "Not applicable."
}
PREVIOUSLY USED QUESTIONS:
${history.map(q => "- " + q).join("\n") || "None"}

IMPORTANT RULES:
1. Every question must be different.
2. Never repeat or closely rephrase a previously used question.
3. Randomize the subjects and topics.
4. Use information from ALL provided files.
5. General knowledge questions should cover varied topics such as science, history, geography, technology, culture, and everyday knowledge.
6. Keep answers accurate, clear, and student-friendly.
7. Each card must contain one question, one concise answer, and a short explanation.
8. Do not create multiple-choice questions.
9. Do not include duplicate questions within this batch.
10. Return valid JSON only.
11. Use "multiple_choice" for questions with choices.
12. Use "typed" for questions requiring a written answer.
13. For typed questions, options must be an empty array.
14. The answer must match one of the provided options for multiple-choice questions.

Required format:
{
  "cards": [
    {
      "type": "multiple_choice",
      "question": "Question here?",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": "Correct option here",
      "explanation": "Brief explanation here."
    },
    {
      "type": "typed",
      "question": "Question here?",
      "options": [],
      "answer": "Correct answer here",
      "explanation": "Brief explanation here."
    }
  ]
}
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
            temperature: 1,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);

      return res.status(response.status).json({
        error: data.error?.message ||
          "Gemini could not generate flashcards."
      });
    }

    const output =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!output) {
      throw new Error("Empty Gemini response.");
    }

    const parsed = JSON.parse(output);

    if (
      !Array.isArray(parsed.cards) ||
      parsed.cards.length !== 10 ||
      !parsed.cards.every(card =>
        typeof card.question === "string" &&
        card.question.trim() &&
        typeof card.answer === "string" &&
        card.answer.trim() &&
        typeof card.explanation === "string"
      )
    ) {
      throw new Error("Invalid flashcard format.");
    }

    const normalize = value =>
      value.toLowerCase().replace(/[^a-z0-9]/g, "");

    const used = new Set(history.map(normalize));
    const batch = new Set();

    const uniqueCards = parsed.cards.filter(card => {
      const key = normalize(card.question);

      if (used.has(key) || batch.has(key)) return false;

      batch.add(key);
      return true;
    });

    if (uniqueCards.length < 10) {
      return res.status(503).json({
        error: "Some questions were repeated. Please generate a fresh set."
      });
    }

    // Shuffle the cards before sending them.
    for (let i = uniqueCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [uniqueCards[i], uniqueCards[j]] =
        [uniqueCards[j], uniqueCards[i]];
    }

    return res.status(200).json({
      cards: uniqueCards
    });

  } catch (error) {
    console.error("Quiz Arena error:", error);

    return res.status(500).json({
      error: "Unable to generate flashcards. Please try again."
    });
  }
}
