// showDirectoryPicker is Chromium-only and missing from lib.dom.d.ts, even
// though the FileSystemDirectoryHandle etc. interfaces it returns are present.
interface DirectoryPickerOptions {
  mode?: 'read' | 'readwrite'
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}
