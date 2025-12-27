'use client'

import { useEffect, useState } from 'react'

/**
 * ModCalc - Power Mod Calculator
 * Calculates g^k mod n = K using BigInt for large number support.
 * Color-coded inputs: basis (orange), exponent (green), modulus (purple), result (dark green)
 */
export function ModCalc() {
  const [base, setBase] = useState(5)
  const [exponent, setExponent] = useState(3)
  const [modulus, setModulus] = useState(23)
  const [result, setResult] = useState(10)
  const [nonsense, setNonsense] = useState(false)

  useEffect(() => {
    if (!isNaN(base) && !isNaN(exponent) && modulus && modulus !== 0) {
      setNonsense(false)
      try {
        const b = BigInt(base)
        const e = BigInt(exponent)
        const m = BigInt(modulus)
        const res = b ** e % m
        setResult(Number(res))
      } catch {
        setNonsense(true)
      }
    } else {
      setNonsense(true)
    }
  }, [base, exponent, modulus])

  return (
    <div className="max-w-[400px] mx-auto my-8 p-5 bg-neutral-100 dark:bg-neutral-800 rounded-xl shadow-lg">
      <h2 className="text-center text-xl font-extrabold mb-5">
        Power Mod Calculator
      </h2>

      {/* Formula with variable names */}
      <div className="text-center text-2xl my-4">
        <span className="text-orange-500">g</span>
        <sup className="text-green-500">k</sup> mod{' '}
        <span className="text-violet-500">n</span> ={' '}
        <span className="text-emerald-700 dark:text-emerald-500">K</span>
      </div>

      {/* Live calculation */}
      <div className="relative">
        <div className={`text-center text-xl sm:text-2xl my-4 transition-opacity ${nonsense ? 'opacity-10' : ''}`}>
          <span className="text-orange-500">
            {isNaN(base) ? 'g' : base}
          </span>
          <sup className="text-green-500">
            {isNaN(exponent) ? 'k' : exponent}
          </sup>{' '}
          mod{' '}
          <span className="text-violet-500">
            {isNaN(modulus) ? 'n' : modulus}
          </span>{' '}
          = <span className="text-emerald-700 dark:text-emerald-500 font-bold">{result}</span>
        </div>

        {nonsense && (
          <div className="absolute top-2 w-full text-center font-bold text-red-500 hover:text-red-600">
            Let's try not to break maths 😬👍
          </div>
        )}
      </div>

      {/* Inputs */}
      <div className="space-y-4 mt-6">
        <div>
          <label className="block mb-1 text-orange-500 font-medium">Basis g</label>
          <input
            type="number"
            value={base}
            onChange={e => setBase(parseInt(e.target.value))}
            className="w-full p-2.5 border border-border rounded bg-background text-foreground text-base"
          />
        </div>
        <div>
          <label className="block mb-1 text-green-500 font-medium">Exponent k</label>
          <input
            type="number"
            value={exponent}
            onChange={e => setExponent(parseInt(e.target.value))}
            className="w-full p-2.5 border border-border rounded bg-background text-foreground text-base"
          />
        </div>
        <div>
          <label className="block mb-1 text-violet-500 font-medium">Modulus n</label>
          <input
            type="number"
            value={modulus}
            onChange={e => setModulus(parseInt(e.target.value))}
            className="w-full p-2.5 border border-border rounded bg-background text-foreground text-base"
          />
        </div>
      </div>
    </div>
  )
}
