# ИИ-помощник для плана учебного проекта

Здесь находится Cloudflare Worker-прокси к Gemini API. API-ключ хранится только как секрет Worker и не попадает в браузер.

## 1. Создать ключ Gemini

Создай API-ключ в Google AI Studio: https://aistudio.google.com/apikey . Не добавляй ключ в файлы сайта или GitHub.

## 2. Установить и развернуть Worker

Установи Node.js, затем в папке `worker/` выполни:

```sh
npm install -g wrangler
wrangler login
wrangler secret put GEMINI_API_KEY
wrangler deploy
```

На запрос `GEMINI_API_KEY` вставь ключ из AI Studio. `wrangler.toml` уже задаёт origin GitHub Pages `https://vovagorosov-del.github.io` и модель `gemini-2.5-flash`. Если сайт публикуется с другого домена, измени `ALLOWED_ORIGIN` на точный origin (без пути и завершающего слеша) до deploy.

После публикации Wrangler покажет URL наподобие `https://project-planner-ai.<account>.workers.dev`.

## 3. Подключить помощника на сайте

Открой `assistant.html` и найди `WORKER_URL` в нижнем скрипте. Замени значение `https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev` на URL своего Worker с суффиксом `/api/assistant`, например:

```js
var WORKER_URL = 'https://project-planner-ai.example-account.workers.dev/api/assistant';
```

Сохрани и отправь изменение в GitHub. Страница помощника будет доступна по адресу `https://vovagorosov-del.github.io/site/assistant.html` после публикации GitHub Pages.

## Возможности и ограничения

- Помощник ведёт диалог на русском, задаёт уточняющие вопросы и готовит черновик плана.
- Кнопка «Перенести план» сохраняет результат в том же формате `plan_v1`, который использует основной планировщик, и открывает его на главной странице.
- Диалог передаётся Gemini только при отправке запроса; не вводи персональные, секретные или чувствительные данные.
- Worker проверяет разрешённый origin, размер запроса, формат сообщений и ограничивает время ожидания. Ключ Gemini не раскрывается клиенту.
- Браузер загружает Gemini API через Worker; для загрузки сервиса требуется интернет. Использование API может быть ограничено квотами и тарифами Google.
- Для публичного проекта дополнительно настрой лимиты запросов/rate limiting в Cloudflare, чтобы защитить бюджет API.

Если ассистент не отвечает, проверь URL Worker, `ALLOWED_ORIGIN`, наличие секрета `GEMINI_API_KEY` и журнал Worker в Cloudflare.
