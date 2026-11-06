'use client'

/**
 * LayerVisibilityContext
 *
 * Exposes the annotation layer's visibility state to child components
 * (sticky notes, etc.) so all content types can respond
 * to layer show/hide toggles in the toolbar.
 *
 * Provided by AnnotationLayer, which owns the visibility state.
 */

import { createContext, useContext } from 'react'

interface LayerVisibilityContextValue {
  isLayerVisible: (layerId: string) => boolean
}

const LayerVisibilityContext = createContext<LayerVisibilityContextValue>({
  isLayerVisible: () => true,
})

export const LayerVisibilityProvider = LayerVisibilityContext.Provider

export const useLayerVisibility = () => useContext(LayerVisibilityContext)
