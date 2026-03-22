'use client'

import { useState, useCallback } from 'react'
import { Copy, Check, ArrowRightLeft } from 'lucide-react'

/**
 * Caesar cipher — matches the Python implementation exactly:
 *   neue_position = (ord(buchstabe) - 32 + verschiebung) % 95 + 32
 *
 * Operates on printable ASCII (32–126, 95 characters).
 * JS `%` can return negative values, so we double-mod to stay positive.
 */
function caesarEncrypt(plaintext: string, shift: number): string {
  let ciphertext = ''
  for (const ch of plaintext) {
    const newPos = (((ch.charCodeAt(0) - 32 + shift) % 95) + 95) % 95 + 32
    ciphertext += String.fromCharCode(newPos)
  }
  return ciphertext
}

function caesarDecrypt(ciphertext: string, shift: number): string {
  return caesarEncrypt(ciphertext, -shift)
}

/**
 * Vigenère cipher — matches the Python implementation exactly:
 *   verschiebung = ord(schluessel_buchstabe)
 *   ciphertext += caesar_encrypt(buchstabe, verschiebung)
 */
function vigenereEncrypt(plaintext: string, key: string): string {
  let ciphertext = ''
  for (let i = 0; i < plaintext.length; i++) {
    const shift = key.charCodeAt(i % key.length)
    ciphertext += caesarEncrypt(plaintext[i], shift)
  }
  return ciphertext
}

function vigenereDecrypt(ciphertext: string, key: string): string {
  let plaintext = ''
  for (let i = 0; i < ciphertext.length; i++) {
    const shift = key.charCodeAt(i % key.length)
    plaintext += caesarDecrypt(ciphertext[i], shift)
  }
  return plaintext
}

type Cipher = 'caesar' | 'vigenere'
type Mode = 'encrypt' | 'decrypt'

export function CipherLab() {
  const [cipher, setCipher] = useState<Cipher>('caesar')
  const [mode, setMode] = useState<Mode>('encrypt')
  const [input, setInput] = useState('')
  const [caesarShift, setCaesarShift] = useState(4)
  const [vigenereKey, setVigenereKey] = useState('PYTHON')
  const [copied, setCopied] = useState(false)

  const output = useCallback(() => {
    if (!input) return ''
    if (cipher === 'caesar') {
      return mode === 'encrypt'
        ? caesarEncrypt(input, caesarShift)
        : caesarDecrypt(input, caesarShift)
    }
    // Vigenère needs a non-empty key
    if (!vigenereKey) return ''
    return mode === 'encrypt'
      ? vigenereEncrypt(input, vigenereKey)
      : vigenereDecrypt(input, vigenereKey)
  }, [input, cipher, mode, caesarShift, vigenereKey])

  const result = output()

  const handleCopy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleSwap = () => {
    setInput(result)
    setMode(m => (m === 'encrypt' ? 'decrypt' : 'encrypt'))
  }

  return (
    <div className="max-w-lg mx-auto my-8 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header tabs: cipher selection */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setCipher('caesar')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            cipher === 'caesar'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
        >
          Caesar
        </button>
        <button
          onClick={() => setCipher('vigenere')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            cipher === 'vigenere'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
        >
          Vigenère
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('encrypt')}
            className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
              mode === 'encrypt'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            Verschlüsseln
          </button>
          <button
            onClick={() => setMode('decrypt')}
            className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
              mode === 'decrypt'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            Entschlüsseln
          </button>
        </div>

        {/* Key input */}
        {cipher === 'caesar' ? (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Verschiebung (0–94)
            </label>
            <input
              type="number"
              min={0}
              max={94}
              value={caesarShift}
              onChange={e => setCaesarShift(parseInt(e.target.value) || 0)}
              className="w-full p-2 border border-border rounded bg-background text-foreground text-sm font-mono"
            />
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Schlüssel
            </label>
            <input
              type="text"
              value={vigenereKey}
              onChange={e => setVigenereKey(e.target.value)}
              placeholder="z.B. PYTHON"
              className="w-full p-2 border border-border rounded bg-background text-foreground text-sm font-mono"
            />
          </div>
        )}

        {/* Input */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {mode === 'encrypt' ? 'Klartext' : 'Ciphertext'}
          </label>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={mode === 'encrypt' ? 'Nachricht eingeben…' : 'Ciphertext eingeben…'}
            rows={3}
            className="w-full p-2 border border-border rounded bg-background text-foreground text-sm font-mono resize-y"
          />
        </div>

        {/* Swap button */}
        <div className="flex justify-center">
          <button
            onClick={handleSwap}
            disabled={!result}
            className="p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-30"
            title="Ergebnis als Eingabe übernehmen und Modus wechseln"
          >
            <ArrowRightLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Output */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground">
              {mode === 'encrypt' ? 'Ciphertext' : 'Klartext'}
            </label>
            <button
              onClick={handleCopy}
              disabled={!result}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <div className="w-full p-2 border border-border rounded bg-muted/30 text-foreground text-sm font-mono min-h-[4rem] whitespace-pre-wrap break-all select-all">
            {result || <span className="text-muted-foreground/50">—</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
