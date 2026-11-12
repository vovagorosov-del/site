const SYSTEM_INSTRUCTION = `Ты — доброжелательный ИИ-наставник для школьников и студентов, который помогает самостоятельно составить план учебного проекта. Общайся на русском языке, ясно и поддерживающе, задавай по одному уточняющему вопросу за раз. Не выполняй проект за ученика: помогай ему подумать, предлагай варианты и объясняй решения. Не придумывай факты о школе, сроках и ресурсах. Когда информации достаточно или пользователь просит готовый план, сформируй полный черновик плана. Верни только JSON по указанной схеме. В reply пиши короткий полезный ответ или следующий вопрос. В plan включай только сведения, которые пользователь сообщил или явно согласовал; неизвестное помечай как требующее уточнения. answers должен содержать ровно 7 строк, соответствующих вопросам: цель/проблема, аудитория, результат, что изучить/использовать, критерии успеха, риски и решения, время/нагрузка. stages — список из 3–8 разумных этапов с названиями и конкретными задачами/сроками; не выдумывай календарные даты, если их не сообщил пользователь.`;

const MAX_BODY_BYTES = 16_000;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_OUTPUT_TOKENS = 1_800;

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin && origin === allowedOrigin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers });
}

function validPlan(plan) {
  return plan && typeof plan === "object" &&
    typeof plan.title === "string" && typeof plan.subject === "string" &&
    typeof plan.idea === "string" && Array.isArray(plan.answers) &&
    plan.answers.length === 7 && plan.answers.every((item) => typeof item === "string") &&
    Array.isArray(plan.stages) && plan.stages.length >= 2 && plan.stages.length <= 10 &&
    plan.stages.every((stage) => stage && typeof stage.title === "string" && typeof stage.details === "string");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigin = (env.ALLOWED_ORIGIN || "").replace(/\/$/, "");
    const headers = corsHeaders(origin, allowedOrigin);

    if (request.method === "OPTIONS") {
      if (!origin || origin !== allowedOrigin) return new Response(null, { status: 403, headers });
      return new Response(null, { status: 204, headers });
    }
    if (origin !== allowedOrigin) return json({ error: "Этот источник не разрешён." }, 403, headers);
    if (new URL(request.url).pathname !== "/api/assistant") return json({ error: "Маршрут не найден." }, 404, headers);
    if (request.method !== "POST") return json({ error: "Используй POST-запрос." }, 405, headers);
    if (!env.GEMINI_API_KEY) return json({ error: "Сервер не настроен: добавьте секрет GEMINI_API_KEY." }, 503, headers);

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) return json({ error: "Сообщение слишком большое." }, 413, headers);

    let body;
    try {
      const rawBody = await request.text();
      if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return json({ error: "Сообщение слишком большое." }, 413, headers);
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "Не удалось прочитать запрос." }, 400, headers);
    }

    if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > MAX_MESSAGES) {
      return json({ error: "Отправь от 1 до 12 сообщений." }, 400, headers);
    }
    const messages = body.messages;
    if (messages.some((item) => !item || !["user", "model"].includes(item.role) || typeof item.text !== "string" || !item.text.trim() || item.text.length > MAX_MESSAGE_CHARS)) {
      return json({ error: "Проверь сообщения: текст должен содержать до 2000 символов." }, 400, headers);
    }
    if (messages[0].role !== "user" || messages.filter((item) => item.role === "user").length < 1) {
      return json({ error: "Начни диалог с сообщения пользователя." }, 400, headers);
    }

    const contents = messages.map((item) => ({
      role: item.role,
      parts: [{ text: item.text }]
    }));
    const model = /^[a-zA-Z0-9._-]{1,80}$/.test(env.GEMINI_MODEL || "") ? env.GEMINI_MODEL : "gemini-2.5-flash";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const apiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents,
            generationConfig: {
              temperature: 0.65,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  reply: { type: "STRING" },
                  plan: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      subject: { type: "STRING" },
                      idea: { type: "STRING" },
                      answers: { type: "ARRAY", items: { type: "STRING" } },
                      stages: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: { title: { type: "STRING" }, details: { type: "STRING" } },
                          required: ["title", "details"]
                        }
                      }
                    },
                    required: ["title", "subject", "idea", "answers", "stages"]
                  }
                },
                required: ["reply", "plan"]
              }
            }
          })
        }
      );
      if (!apiResponse.ok) {
        console.error("Gemini API returned status", apiResponse.status);
        return json({ error: apiResponse.status === 429 ? "Сейчас много запросов. Попробуй немного позже." : "ИИ временно не смог ответить. Попробуй ещё раз." }, 502, headers);
      }
      const result = await apiResponse.json();
      const generatedText = result?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (!generatedText) return json({ error: "ИИ вернул пустой ответ. Попробуй ещё раз." }, 502, headers);

      let answer;
      try { answer = JSON.parse(generatedText); } catch {
        return json({ error: "Не удалось обработать ответ ИИ. Попробуй ещё раз." }, 502, headers);
      }
      if (typeof answer.reply !== "string" || !validPlan(answer.plan)) {
        return json({ error: "ИИ вернул ответ в неожиданном формате. Попробуй ещё раз." }, 502, headers);
      }
      return json({ reply: answer.reply.slice(0, 3_000), plan: answer.plan }, 200, headers);
    } catch (error) {
      if (error?.name === "AbortError") return json({ error: "Ответ занял слишком много времени. Попробуй ещё раз." }, 504, headers);
      console.error("Assistant request failed", error);
      return json({ error: "Не удалось связаться с ИИ. Проверь соединение и попробуй ещё раз." }, 502, headers);
    } finally {
      clearTimeout(timeout);
    }
  }
};
