
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
      mood = "Okay",
      taskProgress = {},
      previousQuotes = []
    } = req.body || {};

    const validMoods = [
      "Very Low",
      "Low",
      "Okay",
      "Good",
      "Very Good"
    ];

    if (!validMoods.includes(mood)) {
      return res.status(400).json({
        error: "Please select a valid mood."
      });
    }

    const moodInstructions = {
      "Very Low": `
The student is feeling VERY LOW.
Be gentle, compassionate, and reassuring.
Acknowledge that difficult days are normal.
Avoid pressure, guilt, or demanding productivity.
Encourage one small and manageable step.
Remind them that their worth is not based on achievements.
`,
      "Low": `
The student is feeling LOW.
Be understanding, warm, and encouraging.
Acknowledge their feelings without dismissing them.
Encourage them to take things one step at a time.
Remind them that progress does not need to be perfect.
`,
      "Okay": `
The student is feeling OKAY.
Provide a positive and balanced message.
Encourage consistency and steady progress.
Remind them that small efforts still matter.
`,
      "Good": `
The student is feeling GOOD.
Be uplifting, motivating, and supportive.
Encourage them to maintain their momentum.
Celebrate their willingness to keep learning.
`,
      "Very Good": `
The student is feeling VERY GOOD.
Be enthusiastic, energetic, and inspiring.
Encourage them to use their positive energy wisely.
Celebrate their optimism and willingness to grow.
`
    };

    const history = Array.isArray(previousQuotes)
      ? previousQuotes
          .filter(q => typeof q === "string")
          .slice(-100)
      : [];

    const prompt = `
You are the motivational companion of StudyQuest,
a gamified study website for students.

Your goal is to provide a personalized motivational
quote and message based on the student's current mood.

STUDENT'S CURRENT FEELING:
${mood}

MOOD-BASED INSTRUCTIONS:
${moodInstructions[mood]}

STUDENT'S STUDY PROGRESS:
- Total tasks: ${taskProgress.total || 0}
- Completed tasks: ${taskProgress.completed || 0}
- Remaining tasks: ${taskProgress.remaining || 0}

Previously displayed quotes today:
${history.map(q => "- " + q).join("\n") || "None"}

IMPORTANT RULES:
1. Generate ONE original motivational quote.
2. Do not repeat or closely imitate previous quotes.
3. Make the quote relevant to the student's selected mood.
4. Keep the quote short, preferably one sentence.
5. Make the accompanying message personal and meaningful.
6. Consider the student's study progress.
7. Never shame students for unfinished tasks.
8. Do not dismiss or minimize negative feelings.
9. Avoid excessive pressure to study or be productive.
10. Keep everything appropriate for students.

Return valid JSON only in this format:

{
  "quote": "Your original motivational quote here",
  "message": "A personalized encouraging message here"
}
`;

    let result = null;
    let duplicate = false;

    const normalize = value =>
      value.toLowerCase().replace(/[^a-z0-9]/g, "");

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" +
          apiKey,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 1,
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini error:", errorText);

        return res.status(response.status).json({
          error: "Gemini could not generate a motivation message."
        });
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      result = JSON.parse(text);

      if (
        typeof result.quote !== "string" ||
        !result.quote.trim()
      ) {
        throw new Error("Invalid quote response.");
      }

      duplicate = history.some(
        oldQuote =>
          normalize(oldQuote) === normalize(result.quote)
      );

      if (!duplicate) break;
    }

    if (duplicate) {
      return res.status(503).json({
        error: "A fresh quote could not be generated. Please try again."
      });
    }

    return res.status(200).json({
      quote: result.quote.trim(),
      message:
        typeof result.message === "string"
          ? result.message.trim()
          : "",
      mood
    });

  } catch (error) {
    console.error("Motivation API error:", error);

    return res.status(500).json({
      error: "Something went wrong while generating motivation."
    });
  }
}
