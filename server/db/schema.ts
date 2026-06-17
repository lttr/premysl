import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"

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

export const linkedRepositoriesRelations = relations(linkedRepositories, ({ one }) => ({
  user: one(users, {
    fields: [linkedRepositories.userId],
    references: [users.id],
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
