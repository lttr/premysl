import type { UIMessage } from "ai"
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  smoothStream,
  stepCountIs,
  streamText,
} from "ai"
import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic"
import { anthropic } from "@ai-sdk/anthropic"
import type { GoogleLanguageModelOptions } from "@ai-sdk/google"
// import { google } from '@ai-sdk/google'
import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai"
import { openai } from "@ai-sdk/openai"

defineRouteMeta({
  openAPI: {
    description: "Chat with AI.",
    tags: ["ai"],
  },
})

const sessionSchema = z.object({
  id: z.string(),
  user: z.object({ id: z.string().optional(), username: z.string().optional() }).optional(),
})

function needsTitle(title: string | null | undefined): boolean {
  return title === null || title === undefined || title === ""
}

async function persistMessages(chatId: string, messages: UIMessage[]): Promise<void> {
  await db
    .insert(schema.messages)
    .values(
      messages.map((message) => ({
        id: message.id,
        chatId,
        role: message.role,
        parts: message.parts,
      })),
    )
    .onConflictDoNothing()
}

// Build the tool set for a request, gating provider-defined web-search tools by
// provider. `provider` is widened to string so future providers (openai/google)
// can be enabled in MODELS without tripping literal-narrowing comparisons.
function buildTools(provider: string | null) {
  return {
    chart: chartTool,
    weather: weatherTool,
    ...(provider === "anthropic" && {
      web_search: anthropic.tools.webSearch_20250305(),
    }),
    ...(provider === "openai" && { web_search: openai.tools.webSearch() }),
    // TODO: enable once AI SDK supports combining provider-defined tools with custom tools
    // ...(provider === "google" && { google_search: google.tools.googleSearch({}) })
  }
}

const PROVIDER_OPTIONS = {
  anthropic: {
    thinking: {
      type: "enabled",
      budgetTokens: 2048,
    },
  } satisfies AnthropicLanguageModelOptions,
  google: {
    thinkingConfig: {
      includeThoughts: true,
      thinkingLevel: "low",
    },
  } satisfies GoogleLanguageModelOptions,
  openai: {
    reasoningEffort: "low",
    reasoningSummary: "detailed",
  } satisfies OpenAILanguageModelResponsesOptions,
}

// Generate and persist a chat title from the first message when one is missing.
async function ensureTitle(
  chatId: string,
  title: string | null | undefined,
  messages: UIMessage[],
): Promise<void> {
  if (!needsTitle(title)) return
  const { text } = await generateText({
    model: resolveModel(TITLE_MODEL),
    system: `You are a title generator for a chat:
        - Generate a short title based on the first user's message
        - The title should be less than 30 characters long
        - The title should be a summary of the user's message
        - Do not use quotes (' or ") or colons (:) or any other punctuation
        - Do not use markdown, just plain text`,
    prompt: JSON.stringify(messages[0]),
  })
  await db.update(schema.chats).set({ title: text }).where(eq(schema.chats.id, chatId))
}

// Persist the latest user message (upserting parts) when continuing a chat.
async function saveLastUserMessage(chatId: string, messages: UIMessage[]): Promise<void> {
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role !== "user" || messages.length <= 1) return
  await db
    .insert(schema.messages)
    .values({
      id: lastMessage.id,
      chatId,
      role: "user",
      parts: lastMessage.parts,
    })
    .onConflictDoUpdate({ target: schema.messages.id, set: { parts: lastMessage.parts } })
}

function buildSystemPrompt(username: string | undefined): string {
  const namePart =
    username !== undefined && username !== "" ? `The user's name is ${username}.` : ""
  return `You are a knowledgeable and helpful AI assistant. ${namePart} Your goal is to provide clear, accurate, and well-structured responses.

**FORMATTING RULES (CRITICAL):**
- ABSOLUTELY NO MARKDOWN HEADINGS: Never use #, ##, ###, ####, #####, or ######
- NO underline-style headings with === or ---
- Use **bold text** for emphasis and section labels instead
- Examples:
  * Instead of "## Usage", write "**Usage:**" or just "Here's how to use it:"
  * Instead of "# Complete Guide", write "**Complete Guide**" or start directly with content
- Start all responses with content, never with a heading

**WEB SEARCH:**
- You have access to a web search tool to find current, up-to-date information
- Only use it when the user explicitly asks about recent events, real-time data, or current facts
- Do NOT search proactively — rely on your knowledge first
- Cite your sources when providing information from web search results

**RESPONSE QUALITY:**
- Be concise yet comprehensive
- Use examples when helpful
- Break down complex topics into digestible parts
- Maintain a friendly, professional tone`
}

export default defineEventHandler(async (event) => {
  const session = sessionSchema.parse(await getUserSession(event))
  const userId = session.user?.id ?? session.id

  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const { model, messages } = await readValidatedBody(event, (data) =>
    z
      .object({
        model: z.string().refine(isModelKey, {
          message: "Invalid model",
        }),
        messages: z.array(z.custom<UIMessage>()),
      })
      .parse(data),
  )

  // model passed isModelKey validation above, so this lookup is always defined.
  const provider = isModelKey(model) ? MODELS[model].provider : null

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
    with: {
      messages: true,
    },
  })
  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  await ensureTitle(id, chat.title, messages)
  await saveLastUserMessage(id, messages)

  const abortController = new AbortController()
  event.node.req.on("close", () => {
    abortController.abort()
  })

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        abortSignal: abortController.signal,
        model: resolveModel(model),
        system: buildSystemPrompt(session.user?.username),
        messages: await convertToModelMessages(messages),
        tools: buildTools(provider),
        providerOptions: PROVIDER_OPTIONS,
        stopWhen: stepCountIs(5),
        experimental_transform: smoothStream(),
      })

      if (needsTitle(chat.title)) {
        writer.write({
          type: "data-chat-title",
          data: { message: "Generating title..." },
          transient: true,
        })
      }

      writer.merge(
        result.toUIMessageStream({
          sendSources: true,
          sendReasoning: true,
        }),
      )
    },
    onFinish: async ({ messages: finishedMessages }) => {
      await persistMessages(chat.id, finishedMessages)
    },
  })

  return createUIMessageStreamResponse({
    stream,
  })
})
