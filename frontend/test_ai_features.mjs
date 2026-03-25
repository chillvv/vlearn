import assert from "node:assert/strict";

const baseURL = process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const model = process.env.QWEN_MODEL || "qwen3.5-flash";
const apiKey = process.env.DASHSCOPE_API_KEY;

function parseSSEPayload(rawText) {
  const lines = rawText.split("\n");
  let content = "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      const deltaContent = parsed?.choices?.[0]?.delta?.content;
      if (deltaContent) content += deltaContent;
    } catch {}
  }
  return content;
}

function parseActionBlock(rawText) {
  const match = rawText.match(/<ACTION>([\s\S]*?)<\/ACTION>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function isOutOfScopeLearningRequest(input) {
  const normalized = String(input || "").trim().toLowerCase();
  const denyKeywords = ["笑话", "天气", "电影", "八卦", "聊天", "闲聊", "段子"];
  return denyKeywords.some((keyword) => normalized.includes(keyword));
}

async function runMockStreamingTest() {
  const mockRaw = [
    'data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}',
    'data: {"choices":[{"delta":{"content":"你"}}]}',
    'data: {"choices":[{"delta":{"content":"好"}}]}',
    "data: [DONE]",
    "",
  ].join("\n");
  const content = parseSSEPayload(mockRaw);
  assert.equal(content, "你好");
}

async function runCopilotContractTest() {
  const sample = `这是你的复习计划。\n<ACTION>\n{"type":"start_review","risk":"low","payload":{"preset":{"scope":"due"}}}\n</ACTION>`;
  const parsed = parseActionBlock(sample);
  assert.equal(parsed.type, "start_review");
  assert.equal(parsed.risk, "low");
  assert.equal(parsed.payload.preset.scope, "due");
  assert.equal(isOutOfScopeLearningRequest("给我讲个笑话"), true);
  assert.equal(isOutOfScopeLearningRequest("帮我复习定语从句"), false);
}

async function runLiveChatTest() {
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      enable_thinking: true,
      messages: [{ role: "user", content: "请用一句中文回答：你是谁？" }],
    }),
  });
  assert.equal(response.ok, true);
  const raw = await response.text();
  const content = parseSSEPayload(raw);
  assert.equal(content.length > 0, true);
}

async function runLiveQuestionGenerationTest() {
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      enable_thinking: true,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content:
            '请生成3道编程练习题，返回纯JSON数组，不要markdown。每项必须包含 question, questionType, options, correctAnswer, analysis 字段。',
        },
      ],
    }),
  });
  assert.equal(response.ok, true);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "";
  const match = text.match(/\[[\s\S]*\]/);
  assert.equal(Boolean(match), true);
  const list = JSON.parse(match[0]);
  assert.equal(Array.isArray(list), true);
  assert.equal(list.length, 3);
  for (const item of list) {
    assert.equal(typeof item.question, "string");
    assert.equal(typeof item.questionType, "string");
    assert.equal(typeof item.correctAnswer, "string");
  }
}

await runMockStreamingTest();
await runCopilotContractTest();
if (!apiKey) {
  console.log("mock test passed; live tests skipped because DASHSCOPE_API_KEY is missing");
  process.exit(0);
}
await runLiveChatTest();
await runLiveQuestionGenerationTest();
console.log("mock and live AI tests passed");
