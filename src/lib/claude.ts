import Anthropic from "@anthropic-ai/sdk";
import type { AiAnalysisResult, AiLinkSuggestion, TranscriptSegment } from "@/lib/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

function segmentsToText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.order}] ${s.speaker_name_raw || "화자미상"}: ${s.content}`)
    .join("\n");
}

const ANALYSIS_TOOL = {
  name: "record_meeting_analysis",
  description: "회의록 텍스트 분석 결과를 구조화된 형태로 기록합니다.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "회의 전체 요약 (3~6문장)" },
      topics: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      },
      questions: {
        type: "array",
        description: "회의 중 제기된 질의 (담당자에게 확인/답변을 요청한 내용)",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            questioner_name: { type: ["string", "null"], description: "발언 중 언급된 이름 원문" },
            assignee_name: { type: ["string", "null"], description: "@담당자로 지정된 이름 원문" },
            due_date: { type: ["string", "null"], description: "YYYY-MM-DD, 언급 없으면 null" },
            source_segment_order: { type: ["number", "null"] },
          },
          required: ["content", "questioner_name", "assignee_name", "due_date", "source_segment_order"],
        },
      },
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            source_segment_order: { type: ["number", "null"] },
          },
          required: ["title", "content", "source_segment_order"],
        },
      },
      action_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            assignee_names: { type: "array", items: { type: "string" } },
            due_date: { type: ["string", "null"] },
            source_segment_order: { type: ["number", "null"] },
          },
          required: ["title", "description", "assignee_names", "due_date", "source_segment_order"],
        },
      },
    },
    required: ["summary", "topics", "questions", "decisions", "action_items"],
  },
};

export async function analyzeMeetingTranscript(
  segments: TranscriptSegment[],
  meetingTitle: string,
  meetingDate: string
): Promise<AiAnalysisResult> {
  const transcriptText = segmentsToText(segments);

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "record_meeting_analysis" },
    messages: [
      {
        role: "user",
        content:
          `아래는 "${meetingTitle}" (${meetingDate}) 회의의 텍스트 기록입니다. ` +
          `각 줄은 [발언순번] 화자: 내용 형식입니다.\n\n${transcriptText}\n\n` +
          `이 회의 내용을 분석해서 record_meeting_analysis 도구로 결과를 기록하세요. ` +
          `질의는 "~확인 부탁드립니다", "~언제인가요" 처럼 답을 요구하는 발언만 포함하고, ` +
          `담당자가 명시적으로 지정되지 않았으면 assignee_name을 null로 두세요. ` +
          `결정 사항은 회의에서 확정된 내용만, 액션 아이템은 실행할 작업만 포함하세요.`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude 분석 결과를 파싱하지 못했습니다.");
  return toolUse.input as AiAnalysisResult;
}

const LINK_TOOL = {
  name: "record_link_suggestions",
  description: "새 회의 발언과 기존 미답변 질의 사이의 연결 제안을 기록합니다.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question_id: { type: "string" },
            matched_segment_order: { type: "number" },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            reasoning: { type: "string" },
            suggested_answer_content: { type: "string" },
          },
          required: [
            "question_id",
            "matched_segment_order",
            "confidence",
            "reasoning",
            "suggested_answer_content",
          ],
        },
      },
    },
    required: ["suggestions"],
  },
};

/**
 * 19장: 새 회의 발언이 기존 미답변 질의에 대한 답변인지 판단해 연결을 제안합니다.
 * 자동 확정하지 않고 제안만 반환하며, 최종 연결은 사용자가 확인 후 수행합니다.
 */
export async function suggestQuestionLinks(
  openQuestions: { id: string; question_content: string }[],
  newSegments: TranscriptSegment[]
): Promise<AiLinkSuggestion[]> {
  if (openQuestions.length === 0) return [];

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [LINK_TOOL],
    tool_choice: { type: "tool", name: "record_link_suggestions" },
    messages: [
      {
        role: "user",
        content:
          `기존 미답변 질의 목록:\n${openQuestions
            .map((q) => `- id=${q.id}: ${q.question_content}`)
            .join("\n")}\n\n` +
          `새 회의 발언:\n${segmentsToText(newSegments)}\n\n` +
          `새 발언 중 위 질의에 대한 답변으로 보이는 것이 있으면 record_link_suggestions로 기록하세요. ` +
          `확신이 낮으면 confidence를 LOW로 표시하고, 관련 없으면 목록에서 제외하세요.`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) return [];
  return (toolUse.input as { suggestions: AiLinkSuggestion[] }).suggestions;
}
