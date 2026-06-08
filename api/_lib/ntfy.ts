export async function sendNtfy({
  title,
  message,
  priority,
}: {
  title: string
  message: string
  priority: 'default' | 'high'
}): Promise<void> {
  const url = process.env.NTFY_URL
  if (!url || !url.startsWith('https://')) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        // HTTP headers must be ASCII-only — emoji cause ByteString errors on Vercel
        'Title': title.replace(/[^\x20-\x7E]/g, '').slice(0, 100),
        'Priority': priority,
      },
      body: message.slice(0, 500),
      signal: controller.signal,
    })
  } catch (err) {
    console.error(
      '[ntfy] send error:',
      (err instanceof Error ? err.message : 'unknown').slice(0, 120),
    )
  } finally {
    clearTimeout(timer)
  }
}
