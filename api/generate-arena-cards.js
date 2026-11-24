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
- Every question must test a different fact, concept, or learning objective.
- Do not repeat, paraphrase, or closely resemble any previously used question.
- Avoid testing the same concept more than once, even with different wording.
- Prioritize fresh and varied questions whenever the topic is customized.
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
8. Follow the DIFFICULTY INSTRUCTIONS exactly when choosing the question types and number of multiple-choice questions.
9. Do not include duplicate questions within this batch.
10. Return valid JSON only.
11. Use "multiple_choice" for questions with choices.
12. Use "typed" for questions requiring a written answer.
13. For typed questions, options must be an empty array.
14. The answer must match one of the provided options for multiple-choice questions.
15. For typed questions, include an "acceptedAnswers" array containing 2 to 4 reasonable alternative answers that have the same meaning as the correct answer. Do not include answers that are only partially correct or have a different meaning.
16. Prioritize well-established and verifiable facts. Do not invent dates, names, statistics, quotations, or historical events.
17. For uploaded materials, base questions on the actual information provided. Do not add unsupported details or change the meaning of the material.
18. Avoid questions with ambiguous wording or multiple defensible answers.
19. Make sure every explanation supports the given correct answer and does not contradict it.
20. If information is uncertain, incomplete, or conflicting, do not create a question about it.
21. Do not treat an assumption or opinion as an established fact.

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
  "acceptedAnswers": [
    "Equivalent answer 1",
    "Equivalent answer 2",
    "Equivalent answer 3"
  ],
  "explanation": "Brief explanation here."
}
  ]
}
`;

    
let response;
let data;

const models = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash"
];

for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
  const model = models[modelIndex];
  const maxAttempts = modelIndex === 0 ? 3 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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

    data = await response.json();

    if (response.ok) break;

    const retryable = [500, 502, 503, 504].includes(response.status);
    const quotaLimited = response.status === 429;

    if (!retryable && !quotaLimited) {
      console.error("Gemini error:", data);

      return res.status(response.status).json({
        error: "Gemini is temporarily busy. Please try again in a moment."
      });
    }

    if (quotaLimited || attempt === maxAttempts - 1) {
      break;
    }

    await new Promise(resolve =>
      setTimeout(resolve, 5000 * (2 ** attempt))
    );
  }

  if (response.ok) break;

  console.warn(`Model ${model} failed. Trying the next Gemini model.`);
}

if (!response.ok) {
  console.error("All Gemini models failed:", data);

  return res.status(response.status).json({
    error: "Gemini is temporarily busy. Please try again in a moment."
  });
}


    const output =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!output) {
      throw new Error("Empty Gemini response.");
    }

    const parsed = JSON.parse(output);

        const normalizeValidationAnswer = value =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const validCardContent =
      Array.isArray(parsed.cards) &&
      parsed.cards.every(card => {
        if (
          !card ||
          typeof card.question !== "string" ||
          !card.question.trim() ||
          typeof card.answer !== "string" ||
          !card.answer.trim() ||
          typeof card.explanation !== "string" ||
          !card.explanation.trim()
        ) {
          return false;
        }

        if (card.type === "multiple_choice") {
          if (
            difficulty === "hard" ||
            !Array.isArray(card.options) ||
            card.options.length !== 4 ||
            !card.options.every(
              option => typeof option === "string" && option.trim()
            )
          ) {
            return false;
          }

          const normalizedOptions = card.options.map(
            normalizeValidationAnswer
          );

          return (
            new Set(normalizedOptions).size === 4 &&
            normalizedOptions.includes(
              normalizeValidationAnswer(card.answer)
            )
          );
        }

        if (card.type === "typed") {
  if (
    difficulty === "easy" ||
    !Array.isArray(card.options) ||
    card.options.length !== 0 ||
    (card.acceptedAnswers !== undefined &&
      (!Array.isArray(card.acceptedAnswers) ||
       card.acceptedAnswers.length > 4 ||
       !card.acceptedAnswers.every(
         answer => typeof answer === "string" && answer.trim()
       )))
  ) {
    return false;
  }

  return true;
        }

        return false;
      });

        const multipleChoiceCount = Array.isArray(parsed.cards)
      ? parsed.cards.filter(
          card => card.type === "multiple_choice"
        ).length
      : 0;

    const typedCount = Array.isArray(parsed.cards)
      ? parsed.cards.filter(
          card => card.type === "typed"
        ).length
      : 0;
    
    const correctDifficultyFormat =
      difficulty === "easy"
        ? multipleChoiceCount === 10
        : difficulty === "hard"
        ? typedCount === 10
        : multipleChoiceCount === 5 && typedCount === 5;

    if (
      !Array.isArray(parsed.cards) ||
      parsed.cards.length !== 10 ||
      !validCardContent ||
      !correctDifficultyFormat
    ) {
      return res.status(502).json({
        error: "Some generated questions did not pass the quality checks. Please try generating a new set."
      });
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
