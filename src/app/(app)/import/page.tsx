import type { Metadata } from 'next'
import { ImportUpload } from './import-upload'

export const metadata: Metadata = {
  title: 'Wie sähe mein Skript auf Eduskript aus? | Eduskript',
  description: 'Word-Datei hochladen, ohne Account: in einer Minute als Eduskript-Skript ansehen.',
}

/** Anonymous .docx import — pipeline in src/lib/script-import/. */
export default function ImportPage() {
  return <ImportUpload />
}
