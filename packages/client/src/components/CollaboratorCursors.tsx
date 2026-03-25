/**
 * CollaboratorCursors Component
 * ==============================
 * 
 * Visual indicators showing where other users are working on the document.
 * Renders colored cursors with user names for each collaborator.
 */

import React, { useMemo } from 'react';
import type { CursorPosition, Collaborator } from '../types/collaboration';
import './CollaboratorCursors.css';

// ============================================
// COMPONENT PROPS
// ============================================

interface CollaboratorCursorsProps {
    cursors: CursorPosition[];
    currentUserId: string | null;
    scale: number;
    offsetX?: number;
    offsetY?: number;
    containerWidth?: number;
    containerHeight?: number;
}

// ============================================
// SINGLE CURSOR COMPONENT
// ============================================

interface SingleCursorProps {
    cursor: CursorPosition;
    scale: number;
    offsetX: number;
    offsetY: number;
}

const SingleCursor: React.FC<SingleCursorProps> = ({
    cursor,
    scale,
    offsetX,
    offsetY,
}) => {
    // Calculate screen position
    const screenX = cursor.x * scale + offsetX;
    const screenY = cursor.y * scale + offsetY;

    // Hide cursor if outside visible area
    if (screenX < 0 || screenY < 0) {
        return null;
    }

    return (
        <div
            className="collaborator-cursor"
            style={{
                transform: `translate(${screenX}px, ${screenY}px)`,
                '--cursor-color': cursor.color,
            } as React.CSSProperties}
        >
            {/* Cursor SVG */}
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className="cursor-svg"
            >
                <path
                    d="M5.5 3.5L18.5 12L11 13.5L8.5 20.5L5.5 3.5Z"
                    fill={cursor.color}
                    stroke="white"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                />
            </svg>

            {/* User name label */}
            <div
                className="cursor-label"
                style={{ backgroundColor: cursor.color }}
            >
                {cursor.userName || 'Anonymous'}
            </div>
        </div>
    );
};

// ============================================
// COLLABORATOR LIST COMPONENT
// ============================================

interface CollaboratorListProps {
    collaborators: Collaborator[];
    currentUserId: string | null;
}

export const CollaboratorList: React.FC<CollaboratorListProps> = ({
    collaborators,
    currentUserId,
}) => {
    // Filter out current user
    const otherCollaborators = useMemo(
        () => collaborators.filter(c => c.id !== currentUserId),
        [collaborators, currentUserId]
    );

    if (otherCollaborators.length === 0) {
        return null;
    }

    return (
        <div className="collaborator-list">
            <div className="collaborator-list-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>{otherCollaborators.length} collaborator{otherCollaborators.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="collaborator-list-items">
                {otherCollaborators.map((collaborator) => (
                    <div key={collaborator.id} className="collaborator-item">
                        <div
                            className="collaborator-avatar"
                            style={{ backgroundColor: collaborator.color }}
                        >
                            {collaborator.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="collaborator-name">{collaborator.name}</span>
                        {collaborator.isOnline && (
                            <span className="online-indicator" title="Online" />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// ============================================
// MAIN CURSORS COMPONENT
// ============================================

export const CollaboratorCursors: React.FC<CollaboratorCursorsProps> = ({
    cursors,
    currentUserId,
    scale,
    offsetX = 0,
    offsetY = 0,
}) => {
    // Filter out current user's cursor
    const otherCursors = useMemo(
        () => cursors.filter(c => c.userId !== currentUserId),
        [cursors, currentUserId]
    );

    if (otherCursors.length === 0) {
        return null;
    }

    return (
        <div className="collaborator-cursors-container">
            {otherCursors.map((cursor) => (
                <SingleCursor
                    key={cursor.userId}
                    cursor={cursor}
                    scale={scale}
                    offsetX={offsetX}
                    offsetY={offsetY}
                />
            ))}
        </div>
    );
};

export default CollaboratorCursors;
