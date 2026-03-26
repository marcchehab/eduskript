/**
 * Safe Exam Browser (SEB) Integration
 *
 * SEB is a lockdown browser that transforms a computer into a secure exam workstation.
 * This module provides utilities for detecting SEB and generating configuration files.
 *
 * @see https://safeexambrowser.org/developer/seb-integration.html
 */

/**
 * Exam settings stored in Page.examSettings JSON field
 */
export interface ExamSettings {
  requireSEB: boolean
  unlockForAll?: boolean
  timeLimitMinutes?: number
  // Future: browserExamKey for full validation
}

/**
 * Check if request is coming from Safe Exam Browser
 * Uses user-agent detection (works with SEB 2.x and 3.x)
 */
export function isSEBRequest(headers: Headers): boolean {
  const userAgent = headers.get('user-agent') || ''

  // SEB adds its identifier to the user agent string
  // Examples:
  // - "Mozilla/5.0 ... SEB/3.4.0"
  // - "Mozilla/5.0 ... SafeExamBrowser"
  return (
    userAgent.includes('SEB/') ||
    userAgent.includes('SafeExamBrowser')
  )
}

/**
 * Parse SEB version from user agent if available
 */
export function getSEBVersion(headers: Headers): string | null {
  const userAgent = headers.get('user-agent') || ''

  // Match patterns like "SEB/3.4.0" or "SEB/2.1.5"
  const match = userAgent.match(/SEB\/(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

/**
 * Generate a SEB configuration file (.seb) with kiosk mode settings
 *
 * The .seb file is an XML plist that configures SEB behavior.
 * Includes iOS-specific settings for Assessment Mode (kiosk mode on iPad).
 *
 * @param examUrl - Full URL to the exam page
 * @param examTitle - Title shown in SEB window
 * @param options - Additional configuration options
 * @param options.isDevelopment - If true, allows self-signed certificates
 * @returns XML string content for .seb file
 */
export function generateSEBConfig(
  examUrl: string,
  examTitle: string,
  options: { isDevelopment?: boolean } = {}
): string {
  const { isDevelopment = false } = options
  // SEB configuration is a plist (XML) format
  // This configuration:
  // - Opens the exam URL in kiosk mode
  // - Enables iOS Assessment Mode (AAC) for iPad lockdown
  // - Restricts navigation and app switching
  // - Only allows access to the exam domain

  // quitURL goes to the API route that clears the session cookie,
  // then redirects to /exam-complete
  const quitUrl = new URL(examUrl)
  quitUrl.pathname = '/api/exams/end-session'
  quitUrl.search = '' // Clear any query params so quit URL is clean

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Exam URL -->
  <key>startURL</key>
  <string>${escapeXml(examUrl)}</string>

  <!-- Window title -->
  <key>browserWindowTitleSuffix</key>
  <string>${escapeXml(examTitle)}</string>

  <!-- Quit handling -->
  <key>quitURL</key>
  <string>${escapeXml(quitUrl.toString())}</string>
  <key>quitURLConfirm</key>
  <true/>
  <key>ignoreExitKeys</key>
  <true/>

  <!-- Quit password enables kiosk/Assessment Mode on iOS -->
  <!-- SHA256 hash of empty string - students cannot quit without navigating to quitURL -->
  <key>hashedQuitPassword</key>
  <string>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</string>

  <!-- Security settings -->
  <key>allowQuit</key>
  <false/>
  <key>allowSwitchToApplications</key>
  <false/>
  <key>allowBrowsingBackForward</key>
  <false/>
  <key>allowReload</key>
  <true/>
  <key>showReloadButton</key>
  <true/>

  <!-- Kiosk mode / Full screen -->
  <key>createNewDesktop</key>
  <true/>
  <key>killExplorerShell</key>
  <false/>
  <key>mainBrowserWindowPositioning</key>
  <integer>1</integer>

  <!-- iOS/iPadOS Kiosk Mode (Assessment Mode / AAC) -->
  <key>mobileAllowSingleAppMode</key>
  <true/>
  <key>mobileAllowPictureInPictureMediaPlayback</key>
  <false/>
  <key>mobileAllowQRCodeConfig</key>
  <false/>
  <key>mobileEnableASAM</key>
  <true/>
  <key>enableAAC</key>
  <true/>
  <key>mobileEnableAAC</key>
  <true/>
  <key>mobileEnableGuidedAccessLinkTransform</key>
  <false/>
  <key>mobileShowSettings</key>
  <false/>
  <key>mobileStatusBarAppearance</key>
  <integer>1</integer>
  <key>mobileStatusBarAppearanceExtended</key>
  <integer>1</integer>
  <key>mobilePreventAutoLock</key>
  <true/>
  <key>enablePrivateClipboard</key>
  <true/>

  <!-- Navigation -->
  <key>enableBrowserWindowToolbar</key>
  <false/>
  <key>hideBrowserWindowToolbar</key>
  <true/>
  <key>showMenuBar</key>
  <false/>
  <key>showTaskBar</key>
  <false/>
  <key>showSideMenu</key>
  <false/>

  <!-- URL filtering - disabled for now, needs proper pattern testing -->
  <key>URLFilterEnable</key>
  <false/>
  <key>URLFilterEnableContentFilter</key>
  <false/>
  <key>URLFilterRules</key>
  <array>
    <!-- Allow all paths on exam domain using regex -->
    <dict>
      <key>action</key>
      <integer>1</integer>
      <key>active</key>
      <true/>
      <key>expression</key>
      <string>${escapeXml(new URL(examUrl).origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}.*</string>
      <key>regex</key>
      <true/>
    </dict>
    <!-- Block everything else -->
    <dict>
      <key>action</key>
      <integer>0</integer>
      <key>active</key>
      <true/>
      <key>expression</key>
      <string>.*</string>
      <key>regex</key>
      <true/>
    </dict>
  </array>

  <!-- Disable copying and printing -->
  <key>allowPrint</key>
  <false/>
  <key>enablePrintScreen</key>
  <false/>
  <key>allowDeveloperConsole</key>
  <false/>
  <key>allowSpellCheck</key>
  <false/>
  <key>allowDictionaryLookup</key>
  <false/>

  <!-- Browser settings -->
  <key>enableJavaScript</key>
  <true/>
  <key>blockPopUpWindows</key>
  <true/>
  <key>allowVideoCapture</key>
  <false/>
  <key>allowAudioCapture</key>
  <false/>

  <!-- SSL/TLS settings -->
  <key>pinEmbeddedCertificates</key>
  <false/>
  <key>sendBrowserExamKey</key>
  <false/>
${isDevelopment ? `  <!-- Development: relaxed TLS settings for ngrok/tunnels -->
  <key>allowAnyTLSVersion</key>
  <true/>
  <key>URLFilterIgnoreTLS</key>
  <true/>
  <!-- Skip ngrok browser warning -->
  <key>sendCustomRequestHeaders</key>
  <array>
    <dict>
      <key>url</key>
      <string>*</string>
      <key>headers</key>
      <dict>
        <key>ngrok-skip-browser-warning</key>
        <string>true</string>
      </dict>
    </dict>
  </array>` : ''}
</dict>
</plist>`
}

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Get MIME type for .seb file download
 */
export function getSEBMimeType(): string {
  return 'application/seb'
}

/**
 * Generate filename for SEB config download
 */
export function getSEBFilename(examTitle: string): string {
  // Sanitize title for filename
  const sanitized = examTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)

  return `${sanitized || 'exam'}.seb`
}
