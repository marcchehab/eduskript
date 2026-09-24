// Minimal types for the official pandoc WASM wrapper (npm pandoc-wasm ships none).
// Only what src/lib/script-import/convert-docx.ts uses.
declare module 'pandoc-wasm' {
  export function convert(
    options: Record<string, unknown>,
    stdin: string | null,
    files: Record<string, string | Blob>
  ): Promise<{
    stdout: string
    stderr: string
    warnings: unknown[]
    files: Record<string, string | Blob>
    mediaFiles: Record<string, Blob>
  }>
}
