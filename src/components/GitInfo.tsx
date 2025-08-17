'use client'

import { useState } from 'react'

export function GitInfo() {
  const [isExpanded, setIsExpanded] = useState(false)
  
  const gitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA
  const gitMessage = process.env.NEXT_PUBLIC_GIT_COMMIT_MESSAGE
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
  
  // Don't show anything if no git info is available (development mode)
  if (!gitSha && !gitMessage && !buildTime) {
    return null
  }

  const shortSha = gitSha ? gitSha.substring(0, 7) : 'unknown'
  
  return (
    <div className="fixed bottom-2 right-2 z-50">
      <div 
        className={`
          bg-black/10 dark:bg-white/10 backdrop-blur-sm rounded-lg p-2 text-xs 
          transition-all duration-200 cursor-pointer
          ${isExpanded ? 'min-w-64' : 'w-auto'}
        `}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <div className="space-y-1 text-gray-600 dark:text-gray-400">
            <div className="font-mono">
              <span className="font-semibold">Commit:</span> {shortSha}
            </div>
            {gitMessage && (
              <div className="text-wrap break-words">
                <span className="font-semibold">Message:</span> {gitMessage.trim()}
              </div>
            )}
            {buildTime && (
              <div>
                <span className="font-semibold">Built:</span> {new Date(buildTime).toLocaleString()}
              </div>
            )}
            <div className="text-gray-400 dark:text-gray-500 text-[10px] text-center">
              Click to collapse
            </div>
          </div>
        ) : (
          <div className="text-gray-500 dark:text-gray-400 font-mono hover:text-gray-700 dark:hover:text-gray-300">
            {shortSha}
          </div>
        )}
      </div>
    </div>
  )
}