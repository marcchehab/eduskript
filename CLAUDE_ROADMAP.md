# Permission Management UX & Marketplace Roadmap

## 🎯 Current Status
- ✅ Basic collaboration system (teacher-teacher partnerships)
- ✅ Permission system with `author` and `viewer` levels
- ✅ API endpoints for managing collection/skript authors
- ✅ **No-access-by-default model**: Collaborators only see explicitly shared content

## ✅ COMPLETED: Advanced Page Builder with Permission-Aware Drag-and-Drop

**Status**: ✅ FULLY COMPLETE - Page builder is now production-ready with all features implemented and bugs fixed.

### What Was Built:
- **Advanced Page Builder** (`/dashboard/page-builder`) - Full drag-and-drop interface for organizing public pages
- **Permission-Aware Dragging** - Visual constraints and feedback based on edit/view permissions
- **Content Library** - Shows all accessible collections and skripts with permission indicators
- **Smart Drop Zones** - Collections expand during drag to show internal drop positions
- **Ownership Transfer Model** - Moving content automatically grants edit permissions when needed

### Components Enhanced:
- ✅ `PageBuilderInterface` - Main drag-and-drop orchestrator with permission checks
- ✅ `PageBuilder` - Visual page builder with drop zones and hover states
- ✅ `ContentLibrary` - Content browser with permission filtering and lock icons
- ✅ `DraggableContent` - Items with visual permission indicators (lock icons for view-only)
- ✅ **Permission-Aware APIs** - Enhanced `/api/skripts/move` with automatic permission granting

### Key Features:
- **Visual Permission Feedback**: Lock icons on view-only content, disabled dragging
- **Smart Auto-Expansion**: Collections auto-expand during skript dragging
- **Drop Zone Indicators**: Clear visual feedback for valid/invalid drop targets
- **Permission Enforcement**: "Edit both source and target" model with automatic permission granting
- **Error Messages**: Clear explanations when drops are blocked due to permissions

### ✅ Final Implementation Details:
- **Drag-and-drop reordering**: All reordering persists correctly with proper permission preservation
- **Permission-based UX**: ✅ COMPLETE - Eye icon indicators, proper styling for view-only content
- **Ghost Preview System**: Blue ghost previews for precise visual feedback
- **Bug Fixes Applied**:
  - Fixed permission data loading on page refresh
  - Fixed permission state preservation during skript swapping
  - Fixed edit button URLs to point to correct routes
  - Created dedicated skript editing pages
  - Removed redundant UI elements (duplicate eye icons)
  - Proper 403 error handling for API calls

### 🎨 Drag-and-Drop UX Vocabulary & Implementation
**Essential concepts for maintaining consistent drag-and-drop behavior:**

#### 1. **"Cursor-following square"** 
- **Component**: `DragPreview` in `page-builder-interface.tsx` (lines ~880-920)
- **Purpose**: The rotated, translucent card that follows the mouse cursor during drag
- **Styling**: Blue background (`bg-blue-500/20 border-blue-500/30`) with rotation and shadow
- **Rendered**: Inside `DragOverlay` component

#### 2. **"Ghost-preview-skript"** 
- **Component**: `NestedSkriptItem` and `SortablePageBuilderItem` in `page-builder.tsx` 
- **Purpose**: The actual skript item that becomes blue and translucent in its target position
- **Styling**: `isDragging && "opacity-50 bg-blue-500/20 border-blue-500/30"` (blue tint + opacity)
- **Behavior**: Shows exactly where the item will be placed if dropped

**Key Implementation Details**:
- Both concepts work together: cursor-following + positional ghost preview
- Only skripts get blue ghost styling; collections remain just translucent
- No drop zone indicators - ghost previews provide all visual feedback
- System uses dnd-kit's `DragOverlay` for cursor following and `useSortable` for positional ghosts

## 🚀 Phase 1: Enhanced Permission UX (After Reorder Fix)

### 1. Access Management Dashboard
- **Collection-level permission overview** showing who has access to what
- **Bulk permission assignment** - easily give collaborators access to multiple skripts
- **Visual permission matrix** - clear grid showing users vs. content permissions
- **"Share with Collaborators" quick actions**

### 2. Enhanced Permission Widgets
- **Quick-add interface** in collection view to give collaborators skript access
- **Permission level selectors** with clear descriptions:
  - **View Only** - Can read and use exercises
  - **Co-Author** - Can edit content
  - **No Access** - Cannot see this content (default)
- **Batch operations** for managing multiple skript permissions at once

### 3. Streamlined Collaboration Flow
- **"Share Content" shortcuts** from collection/skript views
- **Permission change notifications** when access is granted/revoked
- **Content sharing history** showing what's been shared with whom
- **My Shared Content** view for collaborators to see what others have shared with them

### UI Components Needed:
- `CollectionAccessManager` component
- `PermissionMatrix` component  
- `BulkPermissionAssigner` component
- `ShareContentModal` component
- `SharedWithMeView` component

## 🏪 Phase 2: Marketplace Foundation

### Extended Permission Model
```
Current: author | viewer
Future:  author | co-author | customer | viewer | none
```

**Permission Definitions**:
- **`author`** - Original creator, full control, can sell/transfer
- **`co-author`** - Can edit, share revenue, cannot sell without agreement
- **`customer`** - Purchased access, can use but not edit
- **`viewer`** - Free preview access
- **`none`** - No access (default for all relationships)

### User Relationship Types
```
Current: collaborator (teacher partnerships)
Future:  collaborator | customer | subscriber
```

### Database Schema Extensions Needed:
- `Purchase` model for customer transactions
- `License` model for content licensing
- `RevenueShare` model for co-author earnings
- Extended `permission` enum values

## 🔄 Phase 3: Advanced Features

### Revenue Sharing
- **Automatic splits** for co-authored content
- **Transparent earnings dashboard**
- **Collaboration agreements** and contracts

### Subscription Models  
- **Creator catalog access** - subscribe to a teacher's full content
- **Tiered access levels** (basic/premium)
- **Educational institution licensing**

### Analytics & Insights
- **Content usage analytics** for creators
- **Student progress tracking** for customers
- **Revenue reporting and tax integration**

## 🔒 Security Model: No-Access-By-Default + Ownership Transfer

**Key Principle**: Being a "collaborator" only establishes a relationship - it does NOT grant content access.

**Permission Structure**:
- Junction tables manage permissions: `CollectionAuthor`, `SkriptAuthor`, `PageAuthor`
- `permission = "author"` = edit rights (can modify content)
- `permission = "viewer"` = view rights (read-only access)

**Drag-and-Drop Permission Model**:
- **"Ownership Transfer"** approach (like Google Drive/Dropbox)
- Moving requires edit permissions on BOTH source AND target
- Users automatically get edit rights on moved content if they don't have them
- View-only content cannot be dragged (prevents content theft)

**Access Flow**:
1. Teachers become "collaborators" (partnership established)
2. Content owners explicitly share specific collections/skripts
3. Collaborators can only see content they've been given access to
4. When moving content, automatic permission granting ensures proper ownership
5. Default permission for new content: `none` (no access)

**Benefits**:
- ✅ Privacy by default
- ✅ Granular control over content sharing
- ✅ Secure content movement with automatic permission management
- ✅ Clear audit trail of what's been shared and moved
- ✅ Scalable for marketplace (customers only see purchased content)

## 📝 Implementation Priority

1. **Immediate**: Build access management dashboard for existing collaborators
2. **Next**: Add bulk permission assignment tools
3. **Then**: Create marketplace foundation (customer relationships)
4. **Future**: Advanced analytics and revenue sharing

---
*Last updated: 2025-08-23*
*Current Focus: Advanced page builder with permission-aware drag-and-drop complete. Ready for Phase 1 permission UX enhancements.*