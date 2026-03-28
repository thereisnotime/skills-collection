import React from 'react';
import { Clock, User, Tag, MoreVertical, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Task, TaskStatus, PRIORITY_CONFIG, TYPE_CONFIG } from './types';

interface TaskCardProps {
  task: Task;
  onClick: (task: Task) => void;
  onMoveTask?: (taskId: string, direction: 'left' | 'right') => void;
}

const COLUMN_ORDER: TaskStatus[] = ['backlog', 'pending', 'in_progress', 'review', 'done'];

export const TaskCard: React.FC<TaskCardProps> = ({ task, onClick, onMoveTask }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityConfig = PRIORITY_CONFIG[task.priority];
  const typeConfig = TYPE_CONFIG[task.type];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter or Space to open task details
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(task);
      return;
    }

    // Shift + Arrow keys to move task between columns
    if (e.shiftKey && onMoveTask) {
      const currentIndex = COLUMN_ORDER.indexOf(task.status);

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        onMoveTask(task.id, 'left');
      } else if (e.key === 'ArrowRight' && currentIndex < COLUMN_ORDER.length - 1) {
        e.preventDefault();
        onMoveTask(task.id, 'right');
      }
    }
  };

  const currentColumnIndex = COLUMN_ORDER.indexOf(task.status);
  const canMoveLeft = currentColumnIndex > 0;
  const canMoveRight = currentColumnIndex < COLUMN_ORDER.length - 1;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group bg-white dark:bg-anthropic-charcoal-light rounded-lg border border-gray-200 dark:border-gray-700 p-4 cursor-pointer hover:border-anthropic-orange dark:hover:border-anthropic-orange hover:shadow-md transition-all duration-200 select-none ${
        isDragging ? 'opacity-50 shadow-lg ring-2 ring-anthropic-orange' : ''
      }`}
      onClick={() => onClick(task)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Task: ${task.title}. Priority: ${task.priority}. Status: ${task.status}. Press Enter to open details. ${canMoveLeft ? 'Shift+Left to move back. ' : ''}${canMoveRight ? 'Shift+Right to move forward.' : ''}`}
    >
      {/* Header with badges */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="p-1 -ml-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-grab active:cursor-grabbing touch-none"
            aria-label="Drag to reorder task"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4 text-gray-400" />
          </button>
          {/* Type badge */}
          <span
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${typeConfig.bgColor} ${typeConfig.color}`}
          >
            {typeConfig.label}
          </span>
          {/* Priority badge */}
          <span
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${priorityConfig.bgColor} ${priorityConfig.color}`}
          >
            {priorityConfig.label}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Menu handler could be added here
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity"
          aria-label="Task options menu"
        >
          <MoreVertical className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Task ID */}
      <div className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-1">
        #{task.id}
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2 line-clamp-2">
        {task.title}
      </h4>

      {/* Description preview */}
      {task.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
            >
              <Tag className="w-3 h-3" />
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          {/* Date */}
          <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
            <Clock className="w-3 h-3" />
            {formatDate(task.updatedAt)}
          </div>
          {/* Estimated hours */}
          {task.estimatedHours && (
            <div className="text-xs text-gray-400 dark:text-gray-500">
              {task.estimatedHours}h
            </div>
          )}
        </div>
        {/* Assignee */}
        {task.assignee && (
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-full bg-anthropic-orange/20 flex items-center justify-center">
              <User className="w-3 h-3 text-anthropic-orange" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskCard;
