// TypeScript types for Code Editor (Python, JavaScript, SQL)

export enum RunState {
  STOPPED = 'stopped',
  RUNNING = 'running',
  PAUSED = 'paused',
}

export enum OutputLevel {
  OUTPUT = 'output',
  ERROR = 'error',
  WARNING = 'warning',
}

export interface SqlResultSet {
  columns: string[]
  values: any[][]
}

export interface OutputEntry {
  message: string
  level: OutputLevel
  timestamp: number
  isHtml?: boolean // For rendering matplotlib plots and rich output
  sqlResults?: SqlResultSet[] // For SQL query results
}

export interface PythonFile {
  name: string
  content: string
}

export interface PythonEditorConfig {
  files: PythonFile[]
  activeFileIndex: number
  showTurtle: boolean
  showOutput: boolean
}

// Skulpt type declarations
declare global {
  interface Window {
    Sk: any
  }
}

export interface SkulptError {
  tp$name: string
  toString(): string
}

export interface SkulptConfig {
  output?: (text: string) => void
  inputfun?: (prompt: string) => Promise<string>
  inputfunTakesPrompt?: boolean
  read?: (filename: string) => string
  __future__?: any
  python3?: boolean
  execLimit?: number
}
