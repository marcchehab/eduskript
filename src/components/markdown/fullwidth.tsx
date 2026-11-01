/**
 * <fullwidth> component — breaks out of #paper's padding so children span the
 * full paper width. The negative margins live in globals.css (.fullwidth), as
 * they differ in reflow mode: 192px on the fixed paper, 1.25rem in reflow.
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
      {...dataAttrs}
    >
      {children}
    </div>
  )
}
