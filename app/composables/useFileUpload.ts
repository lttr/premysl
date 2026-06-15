interface BlobResult {
  pathname: string
  url?: string
  contentType?: string
  size: number
}

function createObjectUrl(file: File): string {
  return URL.createObjectURL(file)
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

// nuxt-csurf types `csrf`/`headerName` as `any`; expose strictly-typed strings.
function useCsrfHeader(): { name: string; value: string } {
  const result: { csrf: unknown; headerName: unknown } = useCsrf()
  return { name: asString(result.headerName), value: asString(result.csrf) }
}

// Read the auth-utils `loggedIn` ref as a plain boolean getter.
// `useUserSession()` resolves to an unresolved (`error`) type under the lint
// tsconfig, so funnel it through `unknown` before narrowing.
function useLoggedIn(): () => boolean {
  const session: unknown = useUserSession()
  return (): boolean => {
    if (session === null || typeof session !== "object" || !("loggedIn" in session)) {
      return false
    }
    return toValue(session.loggedIn) === true
  }
}

function fileToInput(file: File): HTMLInputElement {
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(file)

  const input = document.createElement("input")
  input.type = "file"
  input.files = dataTransfer.files

  return input
}

function extractErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const data = (error as { data?: unknown }).data
    if (data !== null && typeof data === "object") {
      const message = (data as { message?: unknown }).message
      if (typeof message === "string" && message !== "") return message
    }
    if (error instanceof Error && error.message !== "") return error.message
  }
  return "Upload failed"
}

interface UploadAttachment {
  type: "file"
  mediaType: string
  url: string
}

export interface UseFileUploadWithStatus {
  dropzoneRef: Ref<HTMLDivElement | undefined>
  dragging: Ref<boolean>
  open: () => void
  files: Ref<FileWithStatus[]>
  uploading: ComputedRef<boolean>
  uploadedFiles: ComputedRef<UploadAttachment[]>
  addFiles: (newFiles: File[]) => Promise<void>
  removeFile: (id: string) => void
  clearFiles: () => void
}

function isBlobResult(value: unknown): value is BlobResult {
  return (
    value !== null &&
    typeof value === "object" &&
    "pathname" in value &&
    typeof (value as { pathname: unknown }).pathname === "string"
  )
}

type UploadFn = (input: HTMLInputElement) => Promise<unknown>

// Uploads each file and patches its entry in `files` with the result/error.
function createUploadRunner(
  files: Ref<FileWithStatus[]>,
  upload: UploadFn,
  toast: ReturnType<typeof useToast>,
): (fileWithStatus: FileWithStatus) => Promise<void> {
  return async function uploadOne(fileWithStatus: FileWithStatus): Promise<void> {
    const index = files.value.findIndex((f) => f.id === fileWithStatus.id)
    if (index === -1) return

    const current = files.value[index]
    if (!current) return

    try {
      const input = fileToInput(fileWithStatus.file)
      const response: unknown = await upload(input)
      const candidate: unknown = Array.isArray(response) ? response[0] : response

      if (!isBlobResult(candidate)) {
        throw new Error("Upload failed")
      }

      files.value[index] = {
        ...current,
        status: "uploaded",
        uploadedUrl: candidate.url,
        uploadedPathname: candidate.pathname,
      }
    } catch (error) {
      const errorMessage = extractErrorMessage(error)
      toast.add({
        title: "Upload failed",
        description: errorMessage,
        icon: "i-lucide-alert-circle",
        color: "error",
      })
      files.value[index] = {
        ...current,
        status: "error",
        error: errorMessage,
      }
    }
  }
}

// Revokes the preview URL, drops the entry, and deletes the blob if uploaded.
function createFileRemover(
  files: Ref<FileWithStatus[]>,
  csrfToken: { name: string; value: string },
): (id: string) => void {
  return function removeFile(id: string): void {
    const file = files.value.find((f) => f.id === id)
    if (!file) return

    URL.revokeObjectURL(file.previewUrl)
    files.value = files.value.filter((f) => f.id !== id)

    if (
      file.status === "uploaded" &&
      file.uploadedPathname !== undefined &&
      file.uploadedPathname !== ""
    ) {
      // Build the URL as a plain string: the literal `/api/upload/...` template
      // resolves to the PUT typed-route, which would reject method "DELETE".
      const deleteUrl: string = `/api/upload/${file.uploadedPathname}`
      $fetch(deleteUrl, {
        method: "DELETE",
        headers: { [csrfToken.name]: csrfToken.value },
      }).catch((error: unknown) => {
        console.error("Failed to delete file from blob:", error)
      })
    }
  }
}

export function useFileUploadWithStatus(chatId: string): UseFileUploadWithStatus {
  const files = ref<FileWithStatus[]>([])
  const toast = useToast()
  const isLoggedIn = useLoggedIn()
  const csrfToken = useCsrfHeader()

  const upload: UploadFn = useUpload(`/api/upload/${chatId}`, {
    method: "PUT",
    headers: { [csrfToken.name]: csrfToken.value },
  })

  const uploadOne = createUploadRunner(files, upload, toast)

  async function uploadFiles(newFiles: File[]): Promise<void> {
    if (!isLoggedIn()) {
      return
    }

    const filesWithStatus: FileWithStatus[] = newFiles.map((file) => ({
      file,
      id: crypto.randomUUID(),
      previewUrl: createObjectUrl(file),
      status: "uploading" as const,
    }))

    files.value = [...files.value, ...filesWithStatus]

    await Promise.allSettled(filesWithStatus.map(async (f) => uploadOne(f)))
  }

  const { dropzoneRef, isDragging, open } = useFileUpload({
    accept: FILE_UPLOAD_CONFIG.acceptPattern,
    multiple: true,
    onUpdate: (newFiles: File[]) => {
      void uploadFiles(newFiles)
    },
  })

  const uploading = computed(() => files.value.some((f) => f.status === "uploading"))

  const uploadedFiles = computed<UploadAttachment[]>(() =>
    files.value
      .filter((f) => f.status === "uploaded" && f.uploadedUrl !== undefined && f.uploadedUrl !== "")
      .map((f) => ({
        type: "file" as const,
        mediaType: f.file.type,
        url: f.uploadedUrl ?? "",
      })),
  )

  const removeFile = createFileRemover(files, csrfToken)

  function clearFiles(): void {
    if (files.value.length === 0) return
    for (const fileWithStatus of files.value) {
      URL.revokeObjectURL(fileWithStatus.previewUrl)
    }
    files.value = []
  }

  onUnmounted(() => {
    clearFiles()
  })

  return {
    dropzoneRef,
    dragging: isDragging,
    open,
    files,
    uploading,
    uploadedFiles,
    addFiles: uploadFiles,
    removeFile,
    clearFiles,
  }
}
