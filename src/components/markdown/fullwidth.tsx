/**
 * <fullwidth> component — breaks out of #paper's px-48 (192px) padding
 * so children span the full 1280px paper width.
 *
 * Usage in markdown:
 *   <fullwidth>
 *     <img src="wide-image.jpg" />
 *   </fullwidth>
 */
export function Fullwidth({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={className ? `fullwidth ${className}` : 'fullwidth'}
      style={{
        marginLeft: '-192px',
        marginRight: '-192px',
      }}
    >
      {children}
    </div>
  )
}
