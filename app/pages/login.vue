<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const { loggedIn, openInPopup, clear } = useUserSession()

const forbidden = computed(() => route.query.error === "forbidden")

// The owner lands here logged out; once the popup completes a session, send
// them into the app.
watch(loggedIn, (value) => {
  if (value) {
    navigateTo("/")
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-muted">
    <UCard class="w-full max-w-sm">
      <div class="flex flex-col items-center gap-6 text-center">
        <NuxtLink to="/" class="flex items-end gap-0.5">
          <Logo class="h-8 w-auto shrink-0" />
          <span class="text-xl font-bold text-highlighted">Premysl</span>
        </NuxtLink>

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-x"
          title="Not authorized"
          description="This app is restricted to its owner."
        />

        <p v-else class="text-muted text-sm">Sign in to continue.</p>

        <UButton
          label="Login with GitHub"
          icon="i-simple-icons-github"
          color="neutral"
          size="lg"
          block
          @click="openInPopup('/auth/github')"
        />

        <UButton
          v-if="forbidden"
          label="Clear session"
          color="neutral"
          variant="ghost"
          size="sm"
          block
          @click="clear()"
        />
      </div>
    </UCard>
  </div>
</template>
