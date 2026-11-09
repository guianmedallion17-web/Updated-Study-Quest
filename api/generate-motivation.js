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
      taskProgress = {},
      previousQuotes = []
    } = req.body || {};

    const history = Array.isArray(previousQuotes)
      ? previousQuotes
          .filter(q => typeof q === "string")
          .slice(-100)
      : [];

    const prompt = `
You are the motivational companion of StudyQuest,
a gamified study website for students.

Generate ONE original, meaningful motivational quote.

Consider the student's progress:
- Total tasks: ${taskProgress.total || 0}
- Completed tasks: ${taskProgress.completed || 0}
- Remaining tasks: ${taskProgress.remaining || 0}

Previously displayed quotes today:
${history.map(q => "- " + q).join("\n") || "None"}

IMPORTANT:
1. Do not repeat or closely imitate any previous quote.
2. Make the quote fresh, encouraging, and meaningful.
3. Keep it short, preferably one sentence.
4. Avoid generic or overly dramatic wording.
5. Make it appropriate for students.
6. Consider the student's progress when choosing the message.
7. Return valid JSON only in this format:

{
  "quote": "Your original motivational quote here",
  "message": "A short encouraging message here"
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
          : ""
    });

  } catch (error) {
    console.error("Motivation API error:", error);

    return res.status(500).json({
      error: "Something went wrong while generating motivation."
    });
  }
}
