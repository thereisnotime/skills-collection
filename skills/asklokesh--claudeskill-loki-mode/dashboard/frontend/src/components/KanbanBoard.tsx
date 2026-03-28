import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Search, Filter, RefreshCw, Settings, AlertCircle, Loader2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Task, TaskStatus, COLUMN_CONFIG } from './types';
import { KanbanColumn } from './KanbanColumn';
import { TaskCard } from './TaskCard';
import { TaskModal } from './TaskModal';
import { tasksApi, projectsApi, wsClient, ApiError } from '../api';

interface Project {
  id: number;
  name: string;
}

// Helper to safely parse task ID (handles temp-* IDs for unsaved tasks)
const parseTaskId = (id: string): number | null => {
  if (id.startsWith('temp-')) {
    return null; // Unsaved task
  }
  const numId = parseInt(id, 10);
  return isNaN(numId) ? null : numId;
};

export const KanbanBoard: React.FC = () => {
  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNewTask, setIsNewTask] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // DnD sensors with keyboard support
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch projects on mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const projectList = await projectsApi.list();
        setProjects(projectList.map(p => ({ id: p.id, name: p.name })));

        // Select first project if available
        if (projectList.length > 0 && !currentProjectId) {
          setCurrentProjectId(projectList[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch projects:', err);
        // Create a default project if none exist
        try {
          const newProject = await projectsApi.create({
            name: 'Default Project',
            description: 'Auto-created default project',
          });
          setProjects([{ id: newProject.id, name: newProject.name }]);
          setCurrentProjectId(newProject.id);
        } catch (createErr) {
          setError('Failed to load or create projects');
        }
      }
    };

    fetchProjects();
  }, []);

  // Fetch tasks when project changes
  const fetchTasks = useCallback(async () => {
    if (!currentProjectId) {
      setTasks([]);
      setIsLoading(false);
      return;
    }

    try {
      setError(null);
      const taskList = await tasksApi.list(currentProjectId);
      setTasks(taskList);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Failed to load tasks: ${err.message}`);
      } else {
        setError('Failed to load tasks');
      }
      console.error('Failed to fetch tasks:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId) {
      setIsLoading(true);
      fetchTasks();
    }
  }, [currentProjectId, fetchTasks]);

  // WebSocket connection for real-time updates
  // Backend sends underscore format (task_created) with partial data
  // We refetch to get the full task object
  useEffect(() => {
    wsClient.connect();

    // Refetch tasks on any task change to ensure consistency
    const unsubTaskCreated = wsClient.on('task_created', () => {
      fetchTasks();
    });

    const unsubTaskUpdated = wsClient.on('task_updated', () => {
      fetchTasks();
    });

    const unsubTaskDeleted = wsClient.on('task_deleted', (data) => {
      const taskData = data as { id: number };
      setTasks((prev) => prev.filter((t) => t.id !== String(taskData.id)));
    });

    const unsubTaskMoved = wsClient.on('task_moved', () => {
      fetchTasks();
    });

    return () => {
      unsubTaskCreated();
      unsubTaskUpdated();
      unsubTaskDeleted();
      unsubTaskMoved();
      wsClient.disconnect();
    };
  }, []);

  // Group tasks by status
  const getTasksByStatus = (status: TaskStatus): Task[] => {
    return tasks
      .filter((task) => task.status === status)
      .filter(
        (task) =>
          searchQuery === '' ||
          task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          task.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
  };

  // DnD handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const task = tasks.find((t) => t.id === active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeTask = tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    // Check if dropping over a column
    const overStatus = over.data.current?.status as TaskStatus | undefined;
    if (overStatus && activeTask.status !== overStatus) {
      // Move task to new column (optimistic update)
      setTasks((prev) =>
        prev.map((t) =>
          t.id === active.id
            ? { ...t, status: overStatus, updatedAt: new Date().toISOString() }
            : t
        )
      );
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Determine the target status
    let newStatus: TaskStatus;
    if (over.data.current?.status) {
      newStatus = over.data.current.status as TaskStatus;
    } else {
      // Dropped on another task, get its status
      const overTask = tasks.find((t) => t.id === over.id);
      if (overTask) {
        newStatus = overTask.status;
      } else {
        return;
      }
    }

    // Only make API call if status actually changed and task is saved
    const originalTask = tasks.find((t) => t.id === taskId);
    const numericId = parseTaskId(taskId);
    if (originalTask && originalTask.status !== newStatus && numericId !== null) {
      try {
        const position = getTasksByStatus(newStatus).length;
        await tasksApi.move(numericId, newStatus, position);
      } catch (err) {
        // Revert on error
        if (originalTask) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? originalTask : t))
          );
        }
        setError('Failed to move task');
        console.error('Failed to move task:', err);
      }
    }
  };

  // Keyboard navigation handler for moving tasks between columns
  const handleMoveTask = async (taskId: string, direction: 'left' | 'right') => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Don't allow moving unsaved tasks
    const numericId = parseTaskId(taskId);
    if (numericId === null) return;

    const currentIndex = columns.indexOf(task.status);
    const newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0 || newIndex >= columns.length) return;

    const newStatus = columns[newIndex];
    const originalTask = { ...task };

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus, updatedAt: new Date().toISOString() }
          : t
      )
    );

    // API call
    try {
      const position = getTasksByStatus(newStatus).length;
      await tasksApi.move(numericId, newStatus, position);
    } catch (err) {
      // Revert on error
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? originalTask : t))
      );
      setError('Failed to move task');
      console.error('Failed to move task:', err);
    }
  };

  // Task handlers
  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsNewTask(false);
    setIsModalOpen(true);
  };

  const handleAddTask = (status: TaskStatus) => {
    const newTask: Task = {
      id: `temp-${Date.now()}`,
      title: '',
      description: '',
      status,
      priority: 'medium',
      type: 'feature',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
    };
    setSelectedTask(newTask);
    setIsNewTask(true);
    setIsModalOpen(true);
  };

  const handleSaveTask = async (updatedTask: Task) => {
    if (!currentProjectId) {
      setError('No project selected');
      return;
    }

    try {
      if (isNewTask) {
        const createdTask = await tasksApi.create(updatedTask, currentProjectId);
        setTasks((prevTasks) => [...prevTasks, createdTask]);
      } else {
        const numericId = parseTaskId(updatedTask.id);
        if (numericId === null) {
          setError('Cannot update unsaved task');
          return;
        }
        const savedTask = await tasksApi.update(numericId, updatedTask);
        setTasks((prevTasks) =>
          prevTasks.map((task) => (task.id === updatedTask.id ? savedTask : task))
        );
      }
      setIsModalOpen(false);
      setSelectedTask(null);
      setIsNewTask(false);
    } catch (err) {
      setError(isNewTask ? 'Failed to create task' : 'Failed to update task');
      console.error('Failed to save task:', err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const numericId = parseTaskId(taskId);
    if (numericId === null) {
      // Just remove from local state for unsaved tasks
      setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
      setIsModalOpen(false);
      setSelectedTask(null);
      return;
    }

    try {
      await tasksApi.delete(numericId);
      setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
      setIsModalOpen(false);
      setSelectedTask(null);
    } catch (err) {
      setError('Failed to delete task');
      console.error('Failed to delete task:', err);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchTasks();
  };

  const columns: TaskStatus[] = ['backlog', 'pending', 'in_progress', 'review', 'done'];

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-anthropic-cream dark:bg-anthropic-charcoal flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-anthropic-orange" />
          <p className="text-gray-600 dark:text-gray-400">Loading tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-anthropic-cream dark:bg-anthropic-charcoal">
      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-6 py-3 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-anthropic-charcoal-light border-b border-gray-200 dark:border-gray-700">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  Loki Mode Dashboard
                </h1>
                {/* Project Selector */}
                {projects.length > 0 && (
                  <select
                    value={currentProjectId || ''}
                    onChange={(e) => setCurrentProjectId(parseInt(e.target.value))}
                    className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-anthropic-charcoal border border-gray-200 dark:border-gray-700 rounded-lg focus:border-anthropic-orange focus:ring-1 focus:ring-anthropic-orange focus:outline-none"
                    aria-label="Select project"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Autonomous task management and execution
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search tasks"
                  className="w-64 pl-10 pr-4 py-2 text-sm bg-gray-50 dark:bg-anthropic-charcoal border border-gray-200 dark:border-gray-700 rounded-lg focus:border-anthropic-orange focus:ring-1 focus:ring-anthropic-orange focus:outline-none"
                />
              </div>
              {/* Filter */}
              <button className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                <Filter className="w-4 h-4" />
                Filter
              </button>
              {/* Refresh */}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                aria-label="Refresh tasks"
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              {/* Settings */}
              <button
                className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="Board settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              {/* Add Task */}
              <button
                onClick={() => handleAddTask('backlog')}
                disabled={!currentProjectId}
                className="flex items-center gap-2 px-4 py-2 bg-anthropic-orange hover:bg-anthropic-orange-hover text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                New Task
              </button>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            {columns.map((status) => {
              const count = getTasksByStatus(status).length;
              const config = COLUMN_CONFIG[status];
              return (
                <div key={status} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{config.title}:</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{count}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-2 text-sm ml-auto">
              <span className="text-gray-500 dark:text-gray-400">Total:</span>
              <span className="font-semibold text-anthropic-orange">{tasks.length}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Board */}
      <main className="p-6">
        {!currentProjectId ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <p>No project selected. Create a project to get started.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 overflow-x-auto pb-4">
              {columns.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={getTasksByStatus(status)}
                  onTaskClick={handleTaskClick}
                  onAddTask={handleAddTask}
                  onMoveTask={handleMoveTask}
                />
              ))}
            </div>

            {/* Drag Overlay - shows the dragged item */}
            <DragOverlay>
              {activeTask ? (
                <div className="opacity-80">
                  <TaskCard task={activeTask} onClick={() => {}} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {/* Task Modal */}
      <TaskModal
        task={selectedTask}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedTask(null);
          setIsNewTask(false);
        }}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        isNewTask={isNewTask}
      />
    </div>
  );
};

export default KanbanBoard;
