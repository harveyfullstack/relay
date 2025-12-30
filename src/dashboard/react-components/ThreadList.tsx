/**
 * ThreadList Component
 *
 * Displays a list of active threads in the sidebar with unread indicators.
 */

import React from 'react';
import type { ThreadInfo } from './hooks/useMessages';

export interface ThreadListProps {
  threads: ThreadInfo[];
  currentThread?: string | null;
  onThreadSelect: (threadId: string) => void;
  /** Total unread count for the threads section header badge */
  totalUnreadCount?: number;
}

export function ThreadList({
  threads,
  currentThread,
  onThreadSelect,
  totalUnreadCount = 0,
}: ThreadListProps) {
  if (threads.length === 0) {
    return null;
  }

  return (
    <div className="px-2 py-2">
      {/* Section Header */}
      <div className="flex items-center justify-between px-2 py-1.5 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Threads
        </span>
        {totalUnreadCount > 0 && (
          <span className="min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold bg-accent-cyan text-bg-deep rounded-full px-1.5 animate-pulse">
            {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
          </span>
        )}
      </div>

      {/* Thread Items */}
      <div className="space-y-0.5">
        {threads.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            isSelected={currentThread === thread.id}
            onClick={() => onThreadSelect(thread.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface ThreadItemProps {
  thread: ThreadInfo;
  isSelected: boolean;
  onClick: () => void;
}

function ThreadItem({ thread, isSelected, onClick }: ThreadItemProps) {
  const hasUnread = thread.unreadCount > 0;
  const timestamp = formatRelativeTime(thread.lastMessage.timestamp);

  return (
    <button
      className={`
        w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-all duration-150 cursor-pointer border-none
        ${isSelected
          ? 'bg-accent-cyan/20 border-l-2 border-l-accent-cyan'
          : 'bg-transparent hover:bg-bg-hover/50'
        }
      `}
      onClick={onClick}
    >
      {/* Thread Icon */}
      <div className={`
        shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
        ${hasUnread ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-bg-tertiary text-text-muted'}
      `}>
        <ThreadIcon />
      </div>

      {/* Thread Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`
            text-sm truncate
            ${hasUnread ? 'font-semibold text-text-primary' : 'text-text-secondary'}
          `}>
            {thread.name}
          </span>
          {hasUnread && (
            <span className="shrink-0 min-w-[16px] h-[16px] flex items-center justify-center text-[9px] font-bold bg-accent-cyan text-bg-deep rounded-full px-1">
              {thread.unreadCount > 99 ? '99+' : thread.unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="truncate">{thread.participants.slice(0, 2).join(', ')}</span>
          {thread.participants.length > 2 && (
            <span>+{thread.participants.length - 2}</span>
          )}
          <span className="text-text-dim">·</span>
          <span>{timestamp}</span>
        </div>
      </div>
    </button>
  );
}

function formatRelativeTime(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ThreadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
