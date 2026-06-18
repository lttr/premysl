import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"

// Test-only seed: build a fixture linked-repository snapshot on disk and record
// it for the current (test-login) user, so grep-mode chat runs fully offline
// without the GitHub link/refresh flow. Fails closed via fakeExternalsEnabled
// (NUXT_FAKE_EXTERNALS=1, never in production). Never wire this into the UI.
//
// A shortcut for step 1 of the offline-test-fakes spec; the GitHub fake (step 2)
// now makes the real link flow offline too, so this only saves a round trip.
// Note: it does NOT build the RAG index — use the link flow for RAG fixtures.
// The fixture tree, repo identity, and dates are shared with the GitHub fake.

export default defineEventHandler(async (event) => {
  if (!fakeExternalsEnabled()) {
    throw createError({ statusCode: 404, statusMessage: "Not Found" })
  }
  const { id: userId } = await requireRequestUser(event)

  // Idempotent: reuse the fixture repo if it is already linked for this user.
  const existing = await db.query.linkedRepositories.findFirst({
    where: () =>
      and(
        eq(schema.linkedRepositories.userId, userId),
        eq(schema.linkedRepositories.fullName, FAKE_REPO_FULL_NAME),
      ),
  })
  if (existing) return toLinkedRepo(existing)

  const id = crypto.randomUUID()
  const snapshotPath = snapshotPathFor(id)

  await mkdir(snapshotPath, { recursive: true })
  const dates: Record<string, string> = {}
  await Promise.all(
    Object.entries(FAKE_FIXTURE_FILES).map(async ([rel, content]) => {
      const target = join(snapshotPath, rel)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
      dates[rel] = FAKE_COMMIT_DATE
    }),
  )
  await writeFile(join(snapshotPath, DATES_MANIFEST), JSON.stringify(dates))

  const [row] = await db
    .insert(schema.linkedRepositories)
    .values({
      id,
      userId,
      fullName: FAKE_REPO_FULL_NAME,
      defaultBranch: FAKE_DEFAULT_BRANCH,
      snapshotPath,
      commitSha: FAKE_COMMIT_SHA,
    })
    .returning()
  if (!row) {
    await deleteSnapshotDir(snapshotPath)
    throw createError({ statusCode: 500, statusMessage: "Failed to seed fixture repository" })
  }
  return toLinkedRepo(row)
})
