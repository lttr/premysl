import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"

// libSQL-native 32-bit float vector column (`F32_BLOB(n)`). Declared so
// `nuxt db generate` emits the right DDL; values are written/read with raw SQL
// (`vector32(?)` / `vector_distance_cos(...)`) since the typed builder can't
// express those functions (ADR 0003).
const float32Vector = (dimensions: number) =>
  customType<{ data: number[]; driverData: Buffer }>({
    dataType() {
      return `F32_BLOB(${dimensions})`
    },
  })

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}

export const users = sqliteTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email").notNull(),
    name: text("name").notNull(),
    avatar: text("avatar").notNull(),
    username: text("username").notNull(),
    provider: text("provider", { enum: ["github"] }).notNull(),
    providerId: text("provider_id").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_provider_id_idx").on(table.provider, table.providerId)],
)

export const usersRelations = relations(users, ({ many }) => ({
  chats: many(chats),
  linkedRepositories: many(linkedRepositories),
}))

export const chats = sqliteTable(
  "chats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title"),
    userId: text("user_id").notNull(),
    visibility: text("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
    // Which retrieval method this chat uses, fixed for its life (GLOSSARY:
    // retrieval mode). Orthogonal to the model key. Defaults to the established
    // grep method; rag is opt-in for evaluation.
    retrievalMode: text("retrieval_mode", { enum: ["grep", "rag"] })
      .notNull()
      .default("grep"),
    ...timestamps,
  },
  (table) => [index("chats_user_id_idx").on(table.userId)],
)

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, {
    fields: [chats.userId],
    references: [users.id],
  }),
  messages: many(messages),
}))

export const messages = sqliteTable(
  "messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: text("parts", { mode: "json" }),
    ...timestamps,
  },
  (table) => [index("messages_chat_id_idx").on(table.chatId)],
)

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
}))

export const linkedRepositories = sqliteTable(
  "linked_repositories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // owner/name — the GitHub identity; keys both this record and the snapshot.
    fullName: text("full_name").notNull(),
    // The branch the snapshot tracks (branch selection is out of scope).
    defaultBranch: text("default_branch").notNull(),
    // On-disk snapshot location under .data/repos/.
    snapshotPath: text("snapshot_path").notNull(),
    // The commit the snapshot was taken at — powers commit-pinned source links.
    commitSha: text("commit_sha").notNull(),
    lastRefreshedAt: integer("last_refreshed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    ...timestamps,
  },
  (table) => [
    index("linked_repositories_user_id_idx").on(table.userId),
    uniqueIndex("linked_repositories_user_full_name_idx").on(table.userId, table.fullName),
  ],
)

export const linkedRepositoriesRelations = relations(linkedRepositories, ({ one, many }) => ({
  user: one(users, {
    fields: [linkedRepositories.userId],
    references: [users.id],
  }),
  chunks: many(repoChunks),
}))

// One retrievable passage of a linked repository's snapshot, for RAG retrieval
// (ADR 0003). Provenance is denormalized so a search builds the commit-pinned
// citation URL without a join. The vector is the chunk's Voyage embedding;
// BM25 lexical scoring lives in the companion `repo_chunks_fts` FTS5 table
// (created in a hand-written migration). Rebuilt wholesale on link/refresh.
export const repoChunks = sqliteTable(
  "repo_chunks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkedRepositoryId: text("linked_repository_id")
      .notNull()
      .references(() => linkedRepositories.id, { onDelete: "cascade" }),
    // owner/name of the source repository — the citation's `repo`.
    repoFullName: text("repo_full_name").notNull(),
    // Commit the snapshot was taken at — pins the citation URL.
    commitSha: text("commit_sha").notNull(),
    // Path of the file inside the repository (forward-slash, snapshot-relative).
    filePath: text("file_path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    // The passage shown to the model; also the FTS5 lexical content.
    content: text("content").notNull(),
    // ISO 8601 last-changed date of the source file, copied from the snapshot's
    // dates manifest at index time so search needs no manifest read (matches the
    // grep snippet's `lastChanged`). Absent when the manifest had no entry.
    lastChanged: text("last_changed"),
    // Voyage `voyage-context-3` embedding (1024 dims).
    embedding: float32Vector(1024)("embedding").notNull(),
    ...timestamps,
  },
  (table) => [
    index("repo_chunks_user_id_idx").on(table.userId),
    index("repo_chunks_linked_repository_id_idx").on(table.linkedRepositoryId),
  ],
)

export const repoChunksRelations = relations(repoChunks, ({ one }) => ({
  linkedRepository: one(linkedRepositories, {
    fields: [repoChunks.linkedRepositoryId],
    references: [linkedRepositories.id],
  }),
}))

export const votes = sqliteTable(
  "votes",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    isUpvoted: integer("is_upvoted", { mode: "boolean" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.messageId] })],
)

export const votesRelations = relations(votes, ({ one }) => ({
  chat: one(chats, {
    fields: [votes.chatId],
    references: [chats.id],
  }),
  message: one(messages, {
    fields: [votes.messageId],
    references: [messages.id],
  }),
}))
