/**
 * <fullwidth> component — breaks out of #paper's px-48 (192px) padding
 * so children span the full 1280px paper width.
 *
 * Usage in markdown:
 *   <fullwidth>
 *     <img src="wide-image.jpg" />
 *   </fullwidth>
 */
export function Fullwidth({ children, className, ...dataAttrs }: {
  children?: React.ReactNode
  className?: string
  // Editor preview cursor-sync + section attrs survive component substitution.
  'data-source-line-start'?: string
  'data-source-line-end'?: string
  'data-section-id'?: string
}) {
  return (
    <div
      className={className ? `fullwidth ${className}` : 'fullwidth'}
      style={{
        marginLeft: '-192px',
        marginRight: '-192px',
      }}
      {...dataAttrs}
    >
      {children}
    </div>
  )
}
